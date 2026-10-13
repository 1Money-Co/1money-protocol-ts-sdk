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
  // any value.
  hasAction: boolean;
  // The `action` value as sent, of any type, when
  // hasAction. Diagnostics only.
  actionRaw?: unknown;
  // Set only for an exact match of a CLIENT_ACTIONS
  // value.
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

// Reads the members the classifier decides on. Never
// reads `message` or `title`: no decision depends on
// message text.
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
  const fields: ProblemFields = {
    hasAction: hasOwn(record, 'action'),
    hasTxHash: hasOwn(record, 'tx_hash')
  };
  if (fields.hasAction) {
    fields.actionRaw = record.action;
    if (isClientAction(record.action)) {
      fields.action = record.action;
    }
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
   * Missing when the body has no action, or one this SDK does
   * not know. On a submission, treat a missing action as
   * `check_status`.
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
    ...(isClientAction(action) && { action }),
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
