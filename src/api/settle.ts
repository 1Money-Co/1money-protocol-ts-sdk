import { API_VERSION } from '@/api/constants';
import { get } from '@/client';
import {
  assertTransactionHash,
  TransactionLockedError,
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from './errors';
import { ownMember, readProblem } from './problem';
import { sendAuthorized } from './submit';

import type { SubmitOutcome } from './classify';
import type { TransactionReceipt } from './transactions/types';
import type { AuthorizedTxV2 } from '@/signing/v2';

export interface SettleOptions {
  // Send k+1 goes out `resendIntervalMs * k` after send k:
  // the node's own retry gate (70 s = 60 s duplicate cache
  // + 10 s publish queue).
  resendIntervalMs?: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  deadlineMs?: number;
  // The wait after a lookup answered 429 or retry_later.
  throttleBackoffMs?: number;
  signal?: AbortSignal;
}

export interface SettledTransaction {
  transactionHash: string;
  // Read `success`: a hold debit (reserve claim,
  // clawback from a hold) can execute and still fail.
  receipt: TransactionReceipt;
}

export interface SettleObservation {
  // 1-based; a gap at the start of the list shows how many
  // of the oldest observations were dropped.
  seq: number;
  elapsedMs: number;
  request: 'send' | 'receipt' | 'lookup';
  result:
    | 'accepted'
    | 'rejected'
    | 'locked'
    | 'unknown'
    | 'found'
    | 'not_found'
    | 'throttled'
    | 'failed';
  status?: number;
  // The body's `action` value as sent.
  action?: unknown;
  problemType?: string;
}

export const SETTLE_DEFAULTS = {
  resendIntervalMs: 70_000,
  pollIntervalMs: 1_000,
  maxPollIntervalMs: 10_000,
  deadlineMs: 900_000,
  throttleBackoffMs: 60_000
} as const;

const MAX_OBSERVATIONS = 200;

// setTimeout fires at once for a longer delay.
const MAX_TIMER_MS = 2_147_483_647;

type ResolvedOptions = {
  -readonly [K in keyof typeof SETTLE_DEFAULTS]: number;
} & Pick<SettleOptions, 'signal'>;

// Injectable so that tests can drive a 15-minute schedule
// without real time.
export interface SettleDeps {
  send(authorized: AuthorizedTxV2): Promise<SubmitOutcome>;
  receipt(hash: string): Promise<unknown>;
  lookup(hash: string): Promise<unknown>;
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

function sameHash(value: unknown, hash: string) {
  return (
    typeof value === 'string' &&
    value.toLowerCase() === hash.toLowerCase()
  );
}

// Found only when the returned hash is this transaction's
// hash: a resolved error value, or a proxy page with a 200
// status, must never read as found.
function isReceiptFor(
  value: unknown,
  hash: string
): value is TransactionReceipt {
  return sameHash(
    ownMember(value, 'transaction_hash'),
    hash
  );
}

function isTransactionFor(
  value: unknown,
  hash: string
): boolean {
  return sameHash(ownMember(value, 'hash'), hash);
}

// The body of a read error: `data` of a ParsedError, or
// the value itself.
function bodyOf(value: unknown): unknown {
  return typeof ownMember(value, 'status') ===
    'number' && ownMember(value, 'name') !== undefined
    ? ownMember(value, 'data')
    : value;
}

// A rate-limit answer proves nothing about the
// transaction: the firewall's 429, or the node's own
// `retry_later`.
function isThrottled(value: unknown): boolean {
  return (
    ownMember(value, 'status') === 429 ||
    readProblem(bodyOf(value)).action === 'retry_later'
  );
}

function resolveOptions(
  options: SettleOptions = {}
): ResolvedOptions {
  const resolved: ResolvedOptions = {
    ...SETTLE_DEFAULTS,
    signal: options.signal
  };
  for (const key of Object.keys(
    SETTLE_DEFAULTS
  ) as (keyof typeof SETTLE_DEFAULTS)[]) {
    const value = options[key];
    if (value === undefined) continue;
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      (key !== 'deadlineMs' &&
        key !== 'resendIntervalMs' &&
        value > MAX_TIMER_MS)
    ) {
      throw new Error(
        `[1Money SDK]: settle option ${key} must be a finite number greater than 0 (a wait at most ${MAX_TIMER_MS} ms), received ${String(value)}.`
      );
    }
    resolved[key] = value;
  }
  return resolved;
}

class ObservationLog {
  private seq = 0;
  public readonly entries: SettleObservation[] = [];

  public constructor(
    private readonly start: number,
    private readonly now: () => number
  ) {}

  public add(
    request: SettleObservation['request'],
    result: SettleObservation['result'],
    detail: {
      status?: number;
      action?: unknown;
      problemType?: string;
    } = {}
  ): void {
    this.seq += 1;
    const entry: SettleObservation = {
      seq: this.seq,
      elapsedMs: this.now() - this.start,
      request,
      result
    };
    if (detail.status !== undefined) {
      entry.status = detail.status;
    }
    if (detail.action !== undefined) {
      entry.action = detail.action;
    }
    if (detail.problemType !== undefined) {
      entry.problemType = detail.problemType;
    }
    this.entries.push(entry);
    if (this.entries.length > MAX_OBSERVATIONS) {
      this.entries.shift();
    }
  }

  public addSend(outcome: SubmitOutcome): void {
    switch (outcome.kind) {
      case 'accepted':
        this.add('send', 'accepted');
        return;
      case 'locked':
        this.add('send', 'locked', {
          status: outcome.status,
          action: 'in_progress',
          problemType: outcome.problemType
        });
        return;
      default:
        this.add('send', outcome.kind, {
          status: outcome.status,
          action: outcome.action,
          problemType: outcome.problemType
        });
    }
  }

  public addRead(
    request: 'receipt' | 'lookup',
    value: unknown,
    found: boolean
  ): void {
    if (found) {
      this.add(request, 'found');
      return;
    }
    const status = ownMember(value, 'status');
    const p = readProblem(bodyOf(value));
    this.add(request, readResult(value, status), {
      status:
        typeof status === 'number' ? status : undefined,
      action: p.actionRaw,
      problemType: p.problemType
    });
  }
}

// A read that is not found proves nothing either way; the
// result only tells the caller why: rate-limited, not
// found (404), or failed (any other answer with a status,
// such as a 5xx or a network error).
function readResult(
  value: unknown,
  status: unknown
): SettleObservation['result'] {
  if (isThrottled(value)) return 'throttled';
  return typeof status === 'number' && status !== 404
    ? 'failed'
    : 'not_found';
}

type HeldState = 'locked' | 'unknown';

// What a send proves. Proof only gets stronger: locked
// never goes back to unknown, and a rejected resend says
// nothing about the earlier sends.
function stateAfterSend(
  outcome: SubmitOutcome,
  state: HeldState,
  hash: string
): HeldState {
  if (outcome.kind === 'accepted') {
    assertTransactionHash(hash, outcome.serverHash);
    return 'locked';
  }
  return outcome.kind === 'locked' ? 'locked' : state;
}

function stateError(
  state: HeldState,
  hash: string,
  observations: readonly SettleObservation[]
): Error {
  return state === 'locked'
    ? new TransactionLockedError(hash, {
        observations: [...observations]
      })
    : new TransactionOutcomeUnknownError(hash, {
        observations: [...observations]
      });
}

// The settle engine. `start` is 'clean' when H was never
// sent (submitAndSettle) and 'sent' when the caller sent it
// before (settle). It only ever resends the caller's
// signed bytes; it never builds or signs a transaction.
export async function runSettle(
  authorized: AuthorizedTxV2,
  start: 'clean' | 'sent',
  settleOptions: SettleOptions | undefined,
  deps: SettleDeps
): Promise<SettledTransaction> {
  // Checked before any request.
  const options = resolveOptions(settleOptions);
  const hash = authorized.transactionHash;
  const t0 = deps.now();
  const log = new ObservationLog(t0, deps.now);
  let state: HeldState = 'unknown';
  let sends = 0;
  let lastSend = t0;
  let poll = options.pollIntervalMs;

  const aborted = () => options.signal?.aborted === true;
  const elapsed = () => deps.now() - t0;
  // The node's retry gate: send k+1 is due
  // `resendIntervalMs * k` after send k.
  const nextSendAt = () =>
    sends === 0
      ? t0
      : lastSend + options.resendIntervalMs * sends;
  const send = async (): Promise<SubmitOutcome> => {
    const outcome = await deps.send(authorized);
    sends += 1;
    lastSend = deps.now();
    log.addSend(outcome);
    return outcome;
  };

  if (start === 'clean') {
    if (aborted()) {
      throw new Error(
        '[1Money SDK]: submitAndSettle was aborted before its first send; the transaction was not sent.'
      );
    }
    const outcome = await send();
    // The only send of H: a rejection proves no effect.
    if (outcome.kind === 'rejected') {
      throw new TransactionSubmissionError(
        outcome.status,
        outcome.data,
        outcome.nodeMessage,
        {
          action: outcome.action,
          problemType: outcome.problemType
        }
      );
    }
    state = stateAfterSend(outcome, state, hash);
  }

  for (;;) {
    if (aborted()) {
      throw stateError(state, hash, log.entries);
    }

    const receipt = await deps.receipt(hash);
    if (isReceiptFor(receipt, hash)) {
      log.addRead('receipt', receipt, true);
      return { transactionHash: hash, receipt };
    }
    log.addRead('receipt', receipt, false);
    // The last poll runs at the deadline itself.
    if (elapsed() >= options.deadlineMs) {
      throw stateError(state, hash, log.entries);
    }
    let throttled = isThrottled(receipt);

    if (state === 'unknown' && !throttled) {
      const transaction = await deps.lookup(hash);
      const found = isTransactionFor(transaction, hash);
      log.addRead('lookup', transaction, found);
      if (found) state = 'locked';
      throttled = isThrottled(transaction);
    }

    if (!aborted() && deps.now() >= nextSendAt()) {
      state = stateAfterSend(await send(), state, hash);
    }

    let wait: number;
    if (throttled) {
      wait = options.throttleBackoffMs;
      poll = options.maxPollIntervalMs;
    } else {
      wait = poll;
      poll = Math.min(
        poll * 2,
        options.maxPollIntervalMs
      );
    }
    // Wake for the next resend and for the deadline, so
    // that neither a long poll nor a back-off moves them.
    const now = deps.now();
    try {
      await deps.sleep(
        Math.max(
          0,
          Math.min(
            wait,
            nextSendAt() - now,
            t0 + options.deadlineMs - now
          )
        ),
        options.signal
      );
    } catch {
      throw stateError(state, hash, log.entries);
    }
  }
}

const TRANSACTIONS_PREFIX = `/${API_VERSION}/transactions`;

// A read error resolves (global onError) or rejects; both
// are returned as the value, so the engine sees the same
// thing either way.
async function readValue(url: string): Promise<unknown> {
  try {
    return await get<'custom', unknown>(url, {
      withCredentials: false
    });
  } catch (caught) {
    return caught;
  }
}

function sleep(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, {
      once: true
    });
  });
}

const defaultDeps: SettleDeps = {
  send: sendAuthorized,
  receipt: hash =>
    readValue(
      `${TRANSACTIONS_PREFIX}/receipt/by_hash?hash=${hash}`
    ),
  lookup: hash =>
    readValue(
      `${TRANSACTIONS_PREFIX}/by_hash?hash=${hash}`
    ),
  now: () => Date.now(),
  sleep
};

/**
 * Send a signed transaction that was never sent, and
 * resend the same signed bytes on the node's schedule until
 * its receipt appears. Throws TransactionSubmissionError
 * only when this first send is rejected before admission;
 * at the deadline or on abort, throws TransactionLockedError
 * or TransactionOutcomeUnknownError with every observation.
 */
export function submitAndSettle(
  authorized: AuthorizedTxV2,
  options?: SettleOptions
): Promise<SettledTransaction> {
  return runSettle(
    authorized,
    'clean',
    options,
    defaultDeps
  );
}

/**
 * Find the state of a signed transaction that was sent
 * before, and resend the same signed bytes on the node's
 * schedule until its receipt appears. Never throws
 * TransactionSubmissionError: a rejected resend says
 * nothing about the earlier send.
 */
export function settle(
  authorized: AuthorizedTxV2,
  options?: SettleOptions
): Promise<SettledTransaction> {
  return runSettle(
    authorized,
    'sent',
    options,
    defaultDeps
  );
}
