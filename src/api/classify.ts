import { sameHash } from './hash';
import {
  bodyMessage,
  BYTES_REFUSAL_TYPES,
  hasOwn,
  NO_EFFECT_ACTIONS,
  ownMember,
  readProblem
} from './problem';

import type {
  ClientAction,
  ProblemFields
} from './problem';

// One submit response, classified by the state it proves:
// - accepted: the node returned a hash (admitted).
// - rejected: the node refused the request before
//   admission. Only this outcome lets the caller sign a
//   new transaction for the same intent.
// - locked: the node holds this exact transaction.
// - unknown: the response does not tell.
export type SubmitOutcome =
  | {
      kind: 'accepted';
      serverHash: string;
      // The whole response, returned to the caller as is.
      response: unknown;
    }
  | {
      kind: 'rejected';
      status: number;
      data: unknown;
      nodeMessage: string;
      // 'bytes': the node refused the signed bytes
      // themselves, so no send of them was ever admitted.
      // 'request': this request only.
      refusal: 'bytes' | 'request';
      action?: ClientAction;
      problemType?: string;
    }
  | {
      kind: 'locked';
      status?: number;
      data: unknown;
      problemType?: string;
    }
  | {
      kind: 'unknown';
      status?: number;
      data?: unknown;
      cause?: unknown;
      action?: unknown;
      problemType?: string;
    };

const NONCE_USED_TYPE =
  'https://developer.1moneynetwork.com/problem/nonce_too_low';

// The node sends nonce_too_low with check_status, so only
// an unknown outcome can carry it.
export function isNonceUsed(
  outcome: SubmitOutcome
): boolean {
  return (
    outcome.kind === 'unknown' &&
    outcome.problemType === NONCE_USED_TYPE
  );
}

function extractHash(
  value: unknown
): string | undefined {
  const hash = ownMember(value, 'hash');
  return typeof hash === 'string'
    ? hash
    : undefined;
}

type ParsedErrorShape = {
  status: number;
  data: unknown;
  message?: unknown;
};

// The ParsedError value of src/client/core.ts: a string
// `name`, a numeric HTTP `status`, and an own `data`
// member (the body, or undefined when no body arrived,
// for example on a timeout). A bare problem body has a
// numeric `status` too, but no `name`, so its own
// `action` is never skipped.
// An answer that a browser got after it followed a redirect
// (src/client/core.ts marks it).
export function isRedirected(value: unknown): boolean {
  return ownMember(value, 'redirected') === true;
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status <= 399;
}

export function isParsedErrorShape(
  value: unknown
): value is ParsedErrorShape {
  // A string own `name` already proves an object.
  return (
    typeof ownMember(value, 'name') === 'string' &&
    typeof ownMember(value, 'status') === 'number' &&
    hasOwn(value as object, 'data')
  );
}

function messageOf(
  value: unknown,
  fallback: string
): string {
  const text = ownMember(value, 'message');
  return typeof text === 'string' ? text : fallback;
}

// The node's text when the body has one; the transport
// text ("Request failed with status code 422") otherwise.
function nodeMessageOf(
  response: unknown,
  body: unknown
): string {
  return (
    bodyMessage(body) ??
    messageOf(response, 'the node rejected the request')
  );
}

function problemTypeOf(p: ProblemFields): {
  problemType?: string;
} {
  return p.problemType === undefined
    ? {}
    : { problemType: p.problemType };
}

function unknownOutcome(
  response: unknown,
  status: number | undefined,
  data: unknown,
  extra: {
    action?: unknown;
    problemType?: string;
  }
): SubmitOutcome {
  const outcome: SubmitOutcome = { kind: 'unknown' };
  if (status !== undefined) outcome.status = status;
  if (data !== undefined) outcome.data = data;
  if (response !== undefined) outcome.cause = response;
  return { ...outcome, ...extra };
}

function isLockedForThisTransaction(
  p: ProblemFields,
  localHash: string
): boolean {
  if (p.action !== 'in_progress') return false;
  if (!p.hasTxHash) return true;
  return (
    p.txHash !== undefined && sameHash(p.txHash, localHash)
  );
}

// Classifies the value `post()` gave (resolved or
// rejected). Rules apply in order; the first match wins.
// Only the node's `action` can reject or lock; every answer
// without one is unknown, whatever its status, code or
// message (the Rust SDK `onemoney-protocol` has the same
// rules). The status is the HTTP status of a ParsedError: a
// bare value's `status` member is data. Never throws.
export function classifySubmitResponse(
  response: unknown,
  localHash: string
): SubmitOutcome {
  const hash = extractHash(response);
  if (hash !== undefined) {
    return {
      kind: 'accepted',
      serverHash: hash,
      response
    };
  }

  const parsed = isParsedErrorShape(response);
  const body = parsed ? response.data : response;
  const status = parsed ? response.status : undefined;
  const p = readProblem(body);

  // The node never redirects a submit. A 3xx, or an answer from the
  // URL a browser was redirected to, is someone else's answer.
  if (
    parsed &&
    (isRedirected(response) || isRedirectStatus(response.status))
  ) {
    return unknownOutcome(response, status, body, problemTypeOf(p));
  }

  if (
    p.action !== undefined &&
    NO_EFFECT_ACTIONS.includes(p.action)
  ) {
    return {
      kind: 'rejected',
      status: status ?? 0,
      data: body,
      nodeMessage: nodeMessageOf(response, body),
      refusal: BYTES_REFUSAL_TYPES.has(p.problemType)
        ? 'bytes'
        : 'request',
      action: p.action,
      ...problemTypeOf(p)
    };
  }

  if (isLockedForThisTransaction(p, localHash)) {
    const locked: SubmitOutcome = {
      kind: 'locked',
      data: body
    };
    if (status !== undefined) locked.status = status;
    return { ...locked, ...problemTypeOf(p) };
  }

  if (p.hasAction) {
    return unknownOutcome(response, status, body, {
      action: p.actionRaw,
      ...problemTypeOf(p)
    });
  }

  // A node type without an action still names the problem:
  // nonce_too_low then still marks the nonce used.
  return unknownOutcome(
    response,
    status,
    parsed ? body : ownMember(response, 'data'),
    problemTypeOf(p)
  );
}
