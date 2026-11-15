import { API_VERSION } from '@/api/constants';
import { ownMember } from '../problem';
import {
  answeredStatus,
  readAnswer,
  wholeNumber
} from './answer';

import type {
  TransactionReceipt,
  TransactionStatusResponse
} from '../transactions/types';

const NOT_FOUND = 404;

/** A read that did not answer with the value or a 404. */
export class AuthorityReadError extends Error {
  public readonly status?: number;

  public constructor(what: string, answer: unknown) {
    const status = answeredStatus(answer);
    const message = ownMember(answer, 'message');
    super(
      `[1Money SDK]: The ${what} did not answer${status !== undefined ? ` (HTTP ${status})` : ''}: ${typeof message === 'string' ? message : 'unexpected body'}`
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

function sameHash(value: unknown, hash: string): boolean {
  return (
    typeof value === 'string' &&
    value.toLowerCase() === hash.toLowerCase()
  );
}

// A value only when it names what was asked: a resolved error or a
// proxy page with a 200 status must never read as found.
async function readFound<T>(
  what: string,
  url: string,
  isFor: (answer: unknown) => boolean
): Promise<T | undefined> {
  const answer = await readAnswer(url);
  if (isFor(answer)) return answer as T;
  if (isNotFound(answer)) return undefined;
  throw new AuthorityReadError(what, answer);
}

const PREFIX = `/${API_VERSION}`;

export function readReceipt(
  hash: string
): Promise<TransactionReceipt | undefined> {
  return readFound(
    'receipt read',
    `${PREFIX}/transactions/receipt/by_hash?hash=${hash}`,
    answer =>
      sameHash(ownMember(answer, 'transaction_hash'), hash)
  );
}

export function readStatus(
  hash: string
): Promise<TransactionStatusResponse | undefined> {
  return readFound(
    'status lookup',
    `${PREFIX}/transactions/status/by_hash?hash=${hash}`,
    answer =>
      sameHash(ownMember(answer, 'hash'), hash) &&
      typeof ownMember(answer, 'status') === 'string'
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
