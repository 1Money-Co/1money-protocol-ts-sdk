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
