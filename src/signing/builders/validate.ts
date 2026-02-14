const ADDRESS_HEX_RE = /^0x[0-9a-fA-F]{40}$/;
const UINT_STRING_RE = /^\d+$/;

function fail(name: string, value: unknown): never {
  throw new Error(
    `[1Money signing]: Invalid ${name}: ${String(value)}`
  );
}

export function assertPositiveInteger(
  name: string,
  value: number
) {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    fail(name, value);
  }
}

export function assertNonNegativeInteger(
  name: string,
  value: number
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    fail(name, value);
  }
}

export function assertUintString(
  name: string,
  value: string
) {
  if (!UINT_STRING_RE.test(value)) {
    fail(name, value);
  }
}

export function assertOptionalUintString(
  name: string,
  value: string | undefined
) {
  if (value === undefined) return;
  assertUintString(name, value);
}

export function assertAddress(
  name: string,
  value: string
) {
  if (!ADDRESS_HEX_RE.test(value)) {
    fail(name, value);
  }
}

export function validateChainAndNonce(unsigned: {
  chain_id: number;
  nonce: number;
}) {
  assertPositiveInteger('chain_id', unsigned.chain_id);
  assertNonNegativeInteger('nonce', unsigned.nonce);
}

export function validateRecipientValueToken(unsigned: {
  recipient: string;
  value: string;
  token: string;
}) {
  assertAddress('recipient', unsigned.recipient);
  assertUintString('value', unsigned.value);
  assertAddress('token', unsigned.token);
}

export function validateValueToken(unsigned: {
  value: string;
  token: string;
}) {
  assertUintString('value', unsigned.value);
  assertAddress('token', unsigned.token);
}
