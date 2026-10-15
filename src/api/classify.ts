import { errorCodeOf } from './errors';
import { matchLegacyReason } from './legacyText';
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
      // Proven by a released node's text, not by `action`.
      legacyText?: true;
    }
  | {
      kind: 'unknown';
      status?: number;
      data?: unknown;
      cause?: unknown;
      action?: unknown;
      problemType?: string;
      // A released node's text says the nonce is used.
      nonceUsed?: true;
    };

// A REST-layer 408 can follow a successful admission:
// the node's request timeout races the whole handler,
// pool admission included, and answers 408 even when
// admission won by a hair.
const AMBIGUOUS_CLIENT_ERROR_STATUS = 408;

// On a node without the `action` member, this one code
// covers the in-flight and nonce-lock answers, which can
// follow admission. Every problem type with action
// in_progress or check_status that a submit can return
// maps to it there.
const LEGACY_AMBIGUOUS_ERROR_CODE =
  'business_transaction_failed';

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
function isParsedErrorShape(
  value: unknown
): value is ParsedErrorShape {
  // A string own `name` already proves an object.
  return (
    typeof ownMember(value, 'name') === 'string' &&
    typeof ownMember(value, 'status') === 'number' &&
    hasOwn(value as object, 'data')
  );
}

// core.ts's login rule resolves a 401 with the bare body
// and drops the status. The body shape is the only
// signal left; loose equality mirrors isLogin's
// `res.code == 401` (src/client/index.ts).
function isLoginRefusalBody(
  value: unknown
): value is { data?: unknown; msg?: unknown } {
  return ownMember(value, 'code') == 401;
}

function messageOf(
  value: unknown,
  key: 'message' | 'msg',
  fallback: string
): string {
  const text = ownMember(value, key);
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
    messageOf(
      response,
      'message',
      'the node rejected the request'
    )
  );
}

function statusOf(value: unknown): number | undefined {
  const status = ownMember(value, 'status');
  return typeof status === 'number'
    ? status
    : undefined;
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
    nonceUsed?: true;
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
    p.txHash !== undefined &&
    p.txHash.toLowerCase() === localHash.toLowerCase()
  );
}

// Rules 5a to 5c: a released node's 422
// business_transaction_failed whose reason is pinned.
function legacyOutcome(
  response: ParsedErrorShape
): SubmitOutcome | undefined {
  const message = ownMember(response.data, 'message');
  if (typeof message !== 'string') return undefined;
  const cls = matchLegacyReason(message);
  if (cls === 'in_flight') {
    return {
      kind: 'locked',
      status: response.status,
      data: response.data,
      legacyText: true
    };
  }
  if (cls === 'bytes') {
    return {
      kind: 'rejected',
      status: response.status,
      data: response.data,
      nodeMessage: message,
      refusal: 'bytes'
    };
  }
  if (cls === 'nonce_used') {
    return unknownOutcome(
      response,
      response.status,
      response.data,
      { nonceUsed: true }
    );
  }
  return undefined;
}

// Classifies the value `post()` gave (resolved or
// rejected). Rules apply in order; the first match wins.
// The node's `action` decides when the body has one;
// the status rules apply only to a body without it. Only
// rules 5a to 5c read message text: the fixed reasons of a
// released node, which sends no action
// (src/api/legacyText.ts). Never throws.
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
  const status = parsed
    ? response.status
    : statusOf(body);
  const p = readProblem(body);

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

  if (parsed) {
    const legacyAmbiguous =
      response.status === 422 &&
      errorCodeOf(response) ===
        LEGACY_AMBIGUOUS_ERROR_CODE;
    if (legacyAmbiguous) {
      const legacy = legacyOutcome(response);
      if (legacy !== undefined) return legacy;
    }
    if (
      !legacyAmbiguous &&
      response.status !==
        AMBIGUOUS_CLIENT_ERROR_STATUS &&
      response.status >= 400 &&
      response.status < 500 &&
      response.data !== undefined
    ) {
      return {
        kind: 'rejected',
        status: response.status,
        data: response.data,
        nodeMessage: nodeMessageOf(
          response,
          response.data
        ),
        refusal: 'request'
      };
    }
    return unknownOutcome(
      response,
      response.status,
      response.data,
      {}
    );
  }

  if (isLoginRefusalBody(response)) {
    return {
      kind: 'rejected',
      status: 401,
      data: response.data,
      nodeMessage: messageOf(
        response,
        'msg',
        'the node returned a 401 (unauthorized) response'
      ),
      refusal: 'request'
    };
  }

  return unknownOutcome(
    response,
    statusOf(response),
    ownMember(response, 'data'),
    {}
  );
}
