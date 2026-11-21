import { API_VERSION } from '@/api/constants';
import { sameHash } from '../errors';
import { ownMember } from '../problem';
import {
  answeredStatus,
  readAnswer,
  wholeNumber
} from './answer';

import type {
  SoftFailReason,
  TransactionReceipt,
  TransactionStatusResponse,
  TransactionStatusValue
} from '../transactions/types';

const NOT_FOUND = 404;

const STATUS_VALUES: readonly TransactionStatusValue[] = [
  'pending',
  'finalized',
  'certified_pending_checkpoint',
  'checkpointed'
];

const SOFT_FAIL_REASONS: readonly SoftFailReason[] = [
  'HoldNotFound',
  'HoldInsufficient',
  'ComplianceRejected',
  'AuthorityChanged',
  'RoleMissing',
  'CapReached',
  'AllowanceShort',
  'RotationConflict',
  'RecipientNotWallet'
];

/**
 * A read that did not answer with a value this SDK can read, or a
 * 404. Its value decides nothing.
 */
export class AuthorityReadError extends Error {
  public readonly status?: number;

  public constructor(what: string, answer: unknown) {
    const status = answeredStatus(answer);
    const message = ownMember(answer, 'message');
    super(
      `[1Money SDK]: The ${what} gave no readable answer${status !== undefined ? ` (HTTP ${status})` : ''}: ${typeof message === 'string' ? message : 'unexpected body'}`
    );
    this.name = 'AuthorityReadError';
    if (status !== undefined) this.status = status;
  }
}

function isNotFound(answer: unknown): boolean {
  return (
    ownMember(answer, 'status') === NOT_FOUND &&
    typeof ownMember(answer, 'name') === 'string'
  );
}

// A value only when it names what was asked: a resolved error or a
// proxy page with a 200 status must never read as found. A 404 is
// the expected answer of a poll until the receipt or the status
// exists, so it is not logged; a 404 of another read is an error
// and still logs.
async function readFound<T>(
  what: string,
  url: string,
  isFor: (answer: unknown) => boolean
): Promise<T | undefined> {
  const answer = await readAnswer(url, [NOT_FOUND]);
  if (isFor(answer)) return answer as T;
  if (isNotFound(answer)) return undefined;
  throw new AuthorityReadError(what, answer);
}

const PREFIX = `/${API_VERSION}`;

function isListOf(
  value: unknown,
  isItem: (item: unknown) => boolean
): boolean {
  return (
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.every(isItem))
  );
}

// An event of another type decides nothing here, so it is let
// through; a SoftFail or NoOp must carry what the outcome reports.
function isReadableEvent(event: unknown): boolean {
  const type = ownMember(event, 'event_type');
  if (type === 'SoftFail') {
    return (SOFT_FAIL_REASONS as unknown[]).includes(
      ownMember(event, 'reason')
    );
  }
  if (type === 'NoOp') {
    const target = ownMember(event, 'target');
    return target === null || typeof target === 'string';
  }
  return typeof type === 'string';
}

function isReadableWarning(warning: unknown): boolean {
  return typeof ownMember(warning, 'type') === 'string';
}

// A receipt decides an outcome, so one the SDK cannot read must
// never read as a failure or a success.
function isReadableReceipt(answer: unknown, hash: string): boolean {
  return (
    sameHash(ownMember(answer, 'transaction_hash'), hash) &&
    typeof ownMember(answer, 'success') === 'boolean' &&
    isListOf(ownMember(answer, 'execution_events'), isReadableEvent) &&
    isListOf(ownMember(answer, 'warnings'), isReadableWarning)
  );
}

/** Throws AuthorityReadError for a receipt this SDK cannot read. */
export function readReceipt(
  hash: string
): Promise<TransactionReceipt | undefined> {
  return readFound(
    'receipt read',
    `${PREFIX}/transactions/receipt/by_hash?hash=${hash}`,
    answer => isReadableReceipt(answer, hash)
  );
}

/** Throws AuthorityReadError for a status this SDK does not know. */
export function readStatus(
  hash: string
): Promise<TransactionStatusResponse | undefined> {
  return readFound(
    'status lookup',
    `${PREFIX}/transactions/status/by_hash?hash=${hash}`,
    answer =>
      sameHash(ownMember(answer, 'hash'), hash) &&
      (STATUS_VALUES as unknown[]).includes(
        ownMember(answer, 'status')
      )
  );
}

async function readWholeNumber(
  what: string,
  url: string,
  key: string
): Promise<number> {
  const answer = await readAnswer(url);
  const value = wholeNumber(ownMember(answer, key));
  if (value === undefined) {
    throw new AuthorityReadError(what, answer);
  }
  return value;
}

/** The account's next nonce. */
export function readAccountNonce(
  address: string
): Promise<number> {
  return readWholeNumber(
    'nonce read',
    `${PREFIX}/accounts/nonce?address=${address}`,
    'nonce'
  );
}

/**
 * The default reference checkpoint of a new envelope: the node's
 * latest committed checkpoint. Admission takes one at most 100
 * checkpoints behind the admitting node's latest.
 */
export function latestReferenceCheckpoint(): Promise<number> {
  return readWholeNumber(
    'checkpoint number read',
    `${PREFIX}/checkpoints/number`,
    'number'
  );
}

/** Whether the token is private, which decides a list operation's list. */
export async function readTokenIsPrivate(
  token: string
): Promise<boolean> {
  const answer = await readAnswer(
    `${PREFIX}/tokens/token_metadata?token=${token}`
  );
  const isPrivate = ownMember(answer, 'is_private');
  if (typeof isPrivate !== 'boolean') {
    throw new AuthorityReadError('token metadata read', answer);
  }
  return isPrivate;
}
