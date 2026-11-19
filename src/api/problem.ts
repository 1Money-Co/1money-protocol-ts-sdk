// The node's RFC 9457 problem body states the client
// action in its `action` member. Only these five values
// are known; any other value is read as "unknown" by
// the classifier (src/api/classify.ts).
export const CLIENT_ACTIONS = [
  'fix_request',
  'retry_later',
  'in_progress',
  'check_status',
  'use_other_node'
] as const;

export type ClientAction =
  (typeof CLIENT_ACTIONS)[number];

// The actions that prove the request had no effect: the
// node rejected it before admission.
export const NO_EFFECT_ACTIONS: readonly ClientAction[] =
  ['fix_request', 'retry_later', 'use_other_node'];

export interface ProblemFields {
  // True when the body has an own `action` member of
  // any value and the node wrote it (isNodeType).
  hasAction: boolean;
  // The `action` member as sent, of any type and from any
  // writer. Diagnostics only.
  actionRaw?: unknown;
  // Set only for an exact match of a CLIENT_ACTIONS
  // value that the node wrote.
  action?: ClientAction;
  // The `type` URI, when it is a string.
  problemType?: string;
  // True when the body has an own `tx_hash` member of
  // any value.
  hasTxHash: boolean;
  // `tx_hash`, when it is a string.
  txHash?: string;
}

function isClientAction(
  value: unknown
): value is ClientAction {
  return (CLIENT_ACTIONS as readonly unknown[]).includes(
    value
  );
}

export function hasOwn(
  body: object,
  key: string
): boolean {
  return Object.prototype.hasOwnProperty.call(
    body,
    key
  );
}

// Reads an own member only: an inherited member is not
// part of an answer.
export function ownMember(
  value: unknown,
  key: string
): unknown {
  return typeof value === 'object' &&
    value !== null &&
    hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function ownString(
  body: Record<string, unknown>,
  key: string
): string | undefined {
  const value = hasOwn(body, key)
    ? body[key]
    : undefined;
  return typeof value === 'string'
    ? value
    : undefined;
}

export const PROBLEM_TYPE_PREFIX =
  'https://developer.1moneynetwork.com/problem/';

// RFC 9457 section 4.2.1: a problem that adds nothing to the
// HTTP status. The node adds its action to it.
const ABOUT_BLANK = 'about:blank';

// Only the node's own statement selects more than the HTTP
// status: a proxy, a firewall or a load balancer in front of
// the node can send problem details too. The node writes a
// type in its namespace, or `about:blank`.
function isNodeType(type: unknown): boolean {
  return (
    typeof type === 'string' &&
    (type.startsWith(PROBLEM_TYPE_PREFIX) ||
      type === ABOUT_BLANK)
  );
}

// Reads the members the classifier decides on. Never
// reads `message` or `title`.
export function readProblem(
  body: unknown
): ProblemFields {
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body)
  ) {
    return { hasAction: false, hasTxHash: false };
  }
  const record = body as Record<string, unknown>;
  const nodeAction =
    hasOwn(record, 'action') &&
    isNodeType(ownMember(record, 'type'));
  const fields: ProblemFields = {
    hasAction: nodeAction,
    hasTxHash: hasOwn(record, 'tx_hash')
  };
  if (hasOwn(record, 'action')) {
    fields.actionRaw = record.action;
  }
  if (nodeAction && isClientAction(record.action)) {
    fields.action = record.action;
  }
  const problemType = ownString(record, 'type');
  if (problemType !== undefined) {
    fields.problemType = problemType;
  }
  const txHash = ownString(record, 'tx_hash');
  if (txHash !== undefined) {
    fields.txHash = txHash;
  }
  return fields;
}

// Problem types that refuse the signed bytes themselves:
// each is built only from a check of the bytes and fixed
// chain constants, and that check exists unchanged in every
// release that accepts v2 submits (v0.8.3 on), so bytes an
// older node admitted cannot get it. Left out: types that a
// check of node state or governance settings also builds
// (`transaction_too_large`, `batch_payment_invalid`), and
// checks added after v0.8.3 (`zero_payment_value`,
// `bridge_sender_mismatch`, `token_field_invalid`,
// `provenance_not_admissible`).
//
// Typed with `undefined` so that `has` takes a missing type.
export const BYTES_REFUSAL_TYPES: ReadonlySet<
  string | undefined
> = new Set(
    [
      'envelope_signature_invalid',
      'signature_pairing_invalid',
      'chain_id_mismatch',
      'sender_not_allowed',
      'memo_invalid'
    ].map(id => `${PROBLEM_TYPE_PREFIX}${id}`)
  );

// The node's own text of an error body, for people to
// read: `message`, else the problem `title`.
export function bodyMessage(
  body: unknown
): string | undefined {
  for (const key of ['message', 'title']) {
    const text = ownMember(body, key);
    if (typeof text === 'string' && text !== '') {
      return text;
    }
  }
  return undefined;
}

// The node's own members of a problem body, and the legacy
// members it keeps for older clients. None of them is a
// typed member of the problem type.
const NON_TYPED_MEMBERS: ReadonlySet<string> = new Set([
  'type',
  'title',
  'status',
  'instance',
  'action',
  'error_code',
  'message'
]);

/**
 * The RFC 9457 problem details of a node error body. Decide
 * on `type` and `action`; `title` is for humans and can
 * change.
 */
export interface ApiProblem {
  /** The problem type URI, or `about:blank`. Compare the whole string. */
  readonly type: string;
  readonly title?: string;
  readonly status?: number;
  /** The request ID, `urn:uuid:<id>`. Quote it to the node operator. */
  readonly instance?: string;
  /**
   * Missing when the body has no action, one this SDK does not
   * know, or a `type` that is neither the node's nor
   * `about:blank` (something in front of the node wrote it). On
   * a submission, treat a missing action as `check_status`.
   */
  readonly action?: ClientAction;
  /**
   * The typed members of the type, as sent. A member can be
   * missing from an older node. Numbers above 2^53 are not exact.
   */
  readonly members: Readonly<Record<string, unknown>>;
  /** `tx_hash` as sent, when it is a string. */
  readonly txHash?: string;
  /** `retry_after_secs`, when it is a whole number, 0 or more. */
  readonly retryAfterSecs?: number;
}

// Like the Rust SDK's `ApiProblem::from_body`: a body without
// a string `type` (a legacy body) has no problem, and a member
// of the wrong type is left out instead of failing the parse.
export function parseProblem(
  body: unknown
): ApiProblem | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const type = ownString(record, 'type');
  if (type === undefined) return undefined;

  // Object.fromEntries defines each key as an own member, so a
  // `__proto__` member stays data.
  const members = Object.freeze(
    Object.fromEntries(
      Object.keys(record)
        .filter(key => !NON_TYPED_MEMBERS.has(key))
        .map(key => [key, record[key]])
    )
  );
  const title = ownString(record, 'title');
  const status = ownMember(record, 'status');
  const instance = ownString(record, 'instance');
  const action = ownMember(record, 'action');
  const txHash = ownString(record, 'tx_hash');
  const retryAfterSecs = ownMember(
    record,
    'retry_after_secs'
  );
  return Object.freeze({
    type,
    ...(title !== undefined && { title }),
    ...(isHttpStatus(status) && { status }),
    ...(instance !== undefined && { instance }),
    ...(isNodeType(type) &&
      isClientAction(action) && { action }),
    members,
    ...(txHash !== undefined && { txHash }),
    ...(isSeconds(retryAfterSecs) && { retryAfterSecs })
  });
}

function isHttpStatus(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 100 &&
    (value as number) <= 599
  );
}

function isSeconds(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
