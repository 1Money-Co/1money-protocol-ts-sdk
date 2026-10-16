import { API_VERSION } from '@/api/constants';
import { get } from '@/client';
import {
  assertTransactionHash,
  TransactionLockedError,
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from './errors';
import {
  bodyMessage,
  ownMember,
  readProblem
} from './problem';
import { sendAuthorized } from './submit';

import type { SubmitOutcome } from './classify';
import type { TransactionReceipt } from './transactions/types';
import type { AuthorizedTxV2 } from '@/signing/v2';

export interface SettleOptions {
  // The gap between resends: a rebroadcast is useful only
  // after peers forget the last one (70 s = 60 s gossip
  // duplicate cache + 10 s publish queue). A node also
  // limits how often it forwards one hash; behind a load
  // balancer each node keeps its own count, so the client
  // does not copy that limit.
  resendIntervalMs?: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  deadlineMs?: number;
  // The wait after a read or a send answered 429 or
  // retry_later, when the answer has no `retry_after_secs`.
  throttleBackoffMs?: number;
  // The longest wait for the receipt after a send answered
  // nonce_too_low, when the receipt reads keep failing. No
  // send can execute after it; three receipt 404s in a row
  // end the run sooner.
  nonceUsedGraceMs?: number;
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
  // The node's text of a send answer, for people to read.
  message?: string;
}

// Why a settle run ended without a receipt:
// - deadline: `deadlineMs` passed.
// - nonce_used: a send answered nonce_too_low, and the
//   receipt did not appear.
// - not_found_after_probes: no node that the lookups
//   reached held the transaction, after the probes.
// - aborted: the caller's signal.
export type SettleEndReason =
  | 'deadline'
  | 'nonce_used'
  | 'not_found_after_probes'
  | 'aborted';

export const SETTLE_DEFAULTS = {
  resendIntervalMs: 70_000,
  pollIntervalMs: 1_000,
  maxPollIntervalMs: 10_000,
  deadlineMs: 900_000,
  throttleBackoffMs: 60_000,
  nonceUsedGraceMs: 70_000
} as const;

// Matched exactly, as the node matches its own type URIs.
// A legacy node sends no type, so it never matches.
const NONCE_USED_TYPE =
  'https://developer.1moneynetwork.com/problem/nonce_too_low';

const MAX_OBSERVATIONS = 200;

// While no node is known to hold the transaction, a lookup
// that answers 404 starts a resend at once: the node's
// retry gate forwards a hash that it does not hold. Probe k
// waits PROBE_GAPS_MS[k] after the last delivered send;
// the first 1 s covers the time between a 2xx and the
// node's shared lock.
const MAX_PROBES = 3;
const PROBE_GAPS_MS = [1_000, 2_000, 4_000];
// 404 reads in a row that end a run early: from several
// nodes behind the load balancer, most likely.
const MISSES_TO_END = 3;

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

// The wait after a throttled answer: the node's own
// `retry_after_secs` when it sends one, else the fallback.
function throttleWaitMs(
  value: unknown,
  fallbackMs: number
): number {
  const seconds = ownMember(bodyOf(value), 'retry_after_secs');
  return typeof seconds === 'number' &&
    Number.isFinite(seconds) &&
    seconds > 0
    ? Math.min(seconds * 1_000, MAX_TIMER_MS)
    : fallbackMs;
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
      message?: string;
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
    if (detail.message !== undefined) {
      entry.message = detail.message;
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
        // A released node's text proves locked without
        // an `action` member: log none.
        this.add('send', 'locked', {
          status: outcome.status,
          action: outcome.legacyText
            ? undefined
            : 'in_progress',
          problemType: outcome.problemType,
          message: bodyMessage(outcome.data)
        });
        return;
      case 'rejected':
        this.add('send', 'rejected', {
          status: outcome.status,
          action: outcome.action,
          problemType: outcome.problemType,
          message: outcome.nodeMessage
        });
        return;
      default:
        this.add('send', outcome.kind, {
          status: outcome.status,
          action: outcome.action,
          problemType: outcome.problemType,
          message: bodyMessage(outcome.data)
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
    this.add(request, readResult(value), {
      status:
        typeof status === 'number' ? status : undefined,
      action: p.actionRaw,
      problemType: p.problemType
    });
  }
}

// A read that is not found: rate-limited, a 404 (the node
// that answered does not have it), or failed (anything
// else, such as a 5xx or a network error). Only a 404
// counts toward an early end.
function readResult(
  value: unknown
): 'not_found' | 'throttled' | 'failed' {
  if (isThrottled(value)) return 'throttled';
  return ownMember(value, 'status') === 404
    ? 'not_found'
    : 'failed';
}

// What the engine knows about H. Accepted: a node
// answered 2xx, but its core can still drop H. Locked: a
// lookup found H, or a node said it holds H. Locked never
// goes back: a later answer does not undo that proof.
type SettleState = 'accepted' | 'unknown' | 'locked';

// The caller may change or reuse its object while the
// engine waits, and every send must carry the same signed
// bytes. The JSON round trip is the body the client sends.
function privateCopy(
  authorized: AuthorizedTxV2
): AuthorizedTxV2 {
  return {
    operation: authorized.operation,
    path: authorized.path,
    request: JSON.parse(
      JSON.stringify(authorized.request)
    ) as AuthorizedTxV2['request'],
    transactionHash: authorized.transactionHash
  };
}

// A nonce_used end is never locked: once the nonce is
// used, H either executed or can never execute, so "a node
// holds H, resend it" is no longer true.
function stateError(
  state: SettleState,
  hash: string,
  observations: readonly SettleObservation[],
  endReason: SettleEndReason
): Error {
  return state === 'locked' && endReason !== 'nonce_used'
    ? new TransactionLockedError(hash, {
        observations: [...observations],
        endReason
      })
    : new TransactionOutcomeUnknownError(hash, {
        observations: [...observations],
        endReason
      });
}

// A send that the node or the firewall turned away for
// now: it delivered nothing. Any 429 counts, with or
// without a body: counting a throttled send as delivered
// could end a run early on false evidence, while the
// reverse only delays a resend. A locked answer proves
// that a node holds H, so it always counts.
function isThrottledSend(
  outcome: SubmitOutcome
): outcome is Extract<
  SubmitOutcome,
  { kind: 'rejected' | 'unknown' }
> {
  return (
    (outcome.kind === 'rejected' ||
      outcome.kind === 'unknown') &&
    (outcome.status === 429 ||
      outcome.action === 'retry_later')
  );
}

function isNonceUsed(outcome: SubmitOutcome): boolean {
  return (
    outcome.kind !== 'accepted' &&
    (outcome.problemType === NONCE_USED_TYPE ||
      (outcome.kind === 'unknown' &&
        outcome.nonceUsed === true))
  );
}

// A send answer that ends the run as rejected.
// - The first send: any rejection, as for a single send
//   (src/api/submit.ts). It proves that this request had
//   no effect, whatever came before.
// - Any send while no node is known to have admitted H: a
//   refusal of the signed bytes, which fail on every node.
//   After a 2xx or a lookup that found H, such a refusal
//   contradicts that proof (nodes that disagree), so it
//   ends nothing.
function refusalError(
  outcome: SubmitOutcome,
  first: boolean,
  state: SettleState
): TransactionSubmissionError | undefined {
  if (outcome.kind !== 'rejected') return undefined;
  const ends =
    first ||
    (outcome.refusal === 'bytes' && state === 'unknown');
  return ends
    ? new TransactionSubmissionError(
        outcome.status,
        outcome.data,
        outcome.nodeMessage,
        {
          action: outcome.action,
          problemType: outcome.problemType
        }
      )
    : undefined;
}

// The settle engine. `start` is 'clean' for
// submitAndSettle, which sends first, and 'sent' for
// settle, which reads first. It only ever resends the
// caller's signed bytes; it never builds or signs a
// transaction.
export async function runSettle(
  authorized: AuthorizedTxV2,
  start: 'clean' | 'sent',
  settleOptions: SettleOptions | undefined,
  deps: SettleDeps
): Promise<SettledTransaction> {
  // Checked before any request.
  const options = resolveOptions(settleOptions);
  const signed = privateCopy(authorized);
  const hash = signed.transactionHash;
  const t0 = deps.now();
  const log = new ObservationLog(t0, deps.now);
  // Changed by the closures below, so not narrowed here.
  let state = 'unknown' as SettleState;
  // The last delivered send: a send that was throttled
  // delivered nothing and does not count.
  let lastSend = t0;
  let poll = options.pollIntervalMs;
  let endAt = t0 + options.deadlineMs;
  // A resend is due `resendIntervalMs` after the last
  // delivered gate send, or after H became locked (a node
  // broadcast it then). Probes do not count. `settle` has
  // sent nothing yet, so its first send is due at once.
  let gateSent = false;
  let lastGateSend = t0;
  // No send before this time: a send was throttled.
  let sendHoldUntil = t0;
  let probes = 0;
  // 404 reads in a row since the last send, for an early
  // end: lookups after the probes, receipts after a nonce
  // answer.
  let misses = 0;
  // Set by a nonce_too_low answer: no send can help, and
  // only the receipt can tell whether H used the nonce.
  let nonceUsed = false;
  // After a 429 the client's address stays near the
  // firewall's read limit, so 404s no longer speed up the
  // polls.
  let throttledOnce = false;

  const aborted = () => options.signal?.aborted === true;
  const end = (reason: SettleEndReason) =>
    stateError(state, hash, log.entries, reason);
  const lock = () => {
    if (state === 'locked') return;
    state = 'locked';
    // Before any send, `settle`'s first send stays due at
    // once: an unsent gate is due at lastGateSend.
    lastGateSend = deps.now();
  };
  const nextGateSendAt = () => {
    if (nonceUsed) return Number.POSITIVE_INFINITY;
    const due = gateSent
      ? lastGateSend + options.resendIntervalMs
      : lastGateSend;
    return Math.max(due, sendHoldUntil);
  };

  // Returns whether the send was delivered.
  const send = async (
    kind: 'first' | 'gate' | 'probe'
  ): Promise<boolean> => {
    const outcome = await deps.send(signed);
    const sentAt = deps.now();
    log.addSend(outcome);
    const refusal = refusalError(
      outcome,
      kind === 'first',
      state
    );
    if (refusal !== undefined) throw refusal;
    if (isThrottledSend(outcome)) {
      sendHoldUntil =
        sentAt +
        throttleWaitMs(
          outcome.data,
          options.throttleBackoffMs
        );
      return false;
    }
    lastSend = sentAt;
    misses = 0;
    if (kind !== 'probe') {
      gateSent = true;
      lastGateSend = sentAt;
    }
    if (outcome.kind === 'accepted') {
      assertTransactionHash(hash, outcome.serverHash);
      if (state === 'unknown') state = 'accepted';
    } else if (outcome.kind === 'locked') {
      lock();
    }
    if (isNonceUsed(outcome) && !nonceUsed) {
      nonceUsed = true;
      poll = options.pollIntervalMs;
      endAt = Math.min(
        endAt,
        lastSend + options.nonceUsedGraceMs
      );
    }
    return true;
  };

  if (start === 'clean') {
    if (aborted()) {
      throw new Error(
        '[1Money SDK]: submitAndSettle was aborted before its first send; the transaction was not sent.'
      );
    }
    await send('first');
  }

  for (;;) {
    if (aborted()) throw end('aborted');

    const receipt = await deps.receipt(hash);
    const settled = isReceiptFor(receipt, hash);
    log.addRead('receipt', receipt, settled);
    if (settled) return { transactionHash: hash, receipt };
    // The last poll runs at the end time itself: the
    // deadline, or the nonce cap.
    if (deps.now() >= endAt) {
      throw end(nonceUsed ? 'nonce_used' : 'deadline');
    }
    let throttled = isThrottled(receipt);
    let throttleWait = throttleWaitMs(
      receipt,
      options.throttleBackoffMs
    );
    // A 404 read in this pass: the next wait stays short.
    let missed = false;
    let probeDue = false;

    if (nonceUsed) {
      missed = readResult(receipt) === 'not_found';
      misses = missed ? misses + 1 : 0;
      if (misses >= MISSES_TO_END) throw end('nonce_used');
    } else if (state !== 'locked') {
      if (throttled) {
        misses = 0;
      } else {
        const lookupStartedAt = deps.now();
        const transaction = await deps.lookup(hash);
        const found = isTransactionFor(transaction, hash);
        log.addRead('lookup', transaction, found);
        const result = found
          ? 'found'
          : readResult(transaction);
        throttled = result === 'throttled';
        throttleWait = throttleWaitMs(
          transaction,
          options.throttleBackoffMs
        );
        missed = result === 'not_found';
        const sinceSend = lookupStartedAt - lastSend;
        if (found) {
          lock();
        } else if (!missed) {
          misses = 0;
        } else if (probes < MAX_PROBES) {
          probeDue = sinceSend >= PROBE_GAPS_MS[probes];
        } else if (sinceSend >= PROBE_GAPS_MS[0]) {
          misses += 1;
          if (misses >= MISSES_TO_END) {
            throw end('not_found_after_probes');
          }
        }
      }
    }

    // One send per pass: a due probe and a due gate send
    // are the same request. A read can end after endAt: no
    // send may start after it.
    const sendCheckedAt = deps.now();
    const gateDue = sendCheckedAt >= nextGateSendAt();
    if (
      (probeDue || gateDue) &&
      sendCheckedAt >= sendHoldUntil &&
      !nonceUsed &&
      !aborted() &&
      sendCheckedAt < endAt
    ) {
      // A probe resends after a delivered send; the first
      // delivered send is never a probe.
      const deliveredBefore = gateSent;
      const delivered = await send(
        gateDue ? 'gate' : 'probe'
      );
      if (delivered && probeDue && deliveredBefore) {
        probes += 1;
      }
    }

    // While sends are on hold, a 404 cannot start a probe,
    // so it does not speed up the polls.
    const holding = deps.now() < sendHoldUntil;
    let wait: number;
    if (throttled) {
      throttledOnce = true;
      wait = throttleWait;
      poll = options.maxPollIntervalMs;
    } else if (missed && !throttledOnce && !holding) {
      // Probing, or counting 404s toward an early end:
      // the probe gaps are whole poll intervals.
      wait = options.pollIntervalMs;
    } else {
      wait = poll;
      poll = Math.min(
        poll * 2,
        options.maxPollIntervalMs
      );
    }
    // Wake for the next send, the end of a send hold (a
    // probe may be waiting) and the end time, so that
    // neither a long poll nor a back-off moves them.
    const now = deps.now();
    try {
      await deps.sleep(
        Math.max(
          0,
          Math.min(
            wait,
            nextGateSendAt() - now,
            holding ? sendHoldUntil - now : wait,
            endAt - now
          )
        ),
        options.signal
      );
    } catch {
      throw end('aborted');
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
 * Send a signed transaction, and resend the same signed
 * bytes until its receipt appears. Throws
 * TransactionSubmissionError when the node rejects the
 * first send, or when, before any node is known to have
 * admitted it, a send is refused for its signed bytes.
 * Otherwise ends with TransactionLockedError or
 * TransactionOutcomeUnknownError, with `endReason` and
 * every observation. It uses no history from before the
 * call. It needs nodes that send problem details: a
 * released node's state refusal reads as unknown.
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
 * before, and resend the same signed bytes until its
 * receipt appears. Throws TransactionSubmissionError only
 * when, before any node is known to have admitted it, a
 * send is refused for its signed bytes: any other refusal
 * says nothing about the earlier send. Otherwise ends like
 * `submitAndSettle`.
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
