import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type VectorSignature = {
  r: string;
  s: string;
  v: number;
};

export interface BatchVector {
  name: string;
  class: string;
  operation: 'BatchPayment';
  operation_type: 14;
  payload: {
    chain_id: number;
    nonce: number;
    token: string;
    operations: Array<{
      recipient: string;
      amount: string;
    }>;
    created_at: number;
    operations_hash: string | null;
    batch_id: string | null;
  };
  options: {
    memo?: {
      type: string;
      format: string;
      data: string;
    };
  };
  authorization: VectorSignature;
  expected: {
    signing_hash: string;
    transaction_hash: string;
    operations_hash: string;
  };
}

export type Vector = {
  name: string;
  operation_type: number;
  authorization_kind: number;
  multisig_account: string | null;
  payload_rlp: string;
  authorization_proof: {
    type: string;
    signature?: VectorSignature;
    account?: string;
    signatures?: {
      signer_pubkey: string;
      signature: VectorSignature;
    }[];
  };
  unsigned_transaction_rlp: string;
  signing_hash: string;
  signed_transaction_rlp: string;
  transaction_hash: string;
};

export function loadVectors(): Vector[] {
  const raw = readFileSync(
    join(
      __dirname,
      '..',
      'fixtures',
      'native-v2-signing-vectors.json'
    ),
    'utf8'
  );
  const parsed = JSON.parse(raw);
  return [
    ...parsed.base_vectors,
    ...parsed.supplemental_vectors
  ];
}

export function vector(name: string): Vector {
  const found = loadVectors().find(
    entry => entry.name === name
  );
  if (!found) {
    throw new Error(
      `[test]: no golden vector named ${name}`
    );
  }
  return found;
}

export function vectorHash(
  name: string
): string {
  return vector(name).signing_hash;
}

const B256_RE = /^0x[0-9a-fA-F]{64}$/;

function fixtureError(
  path: string,
  message: string
): never {
  throw new Error(
    `[test]: Batch Payment fixture ${path} ${message}`
  );
}

function assertRecord(
  value: unknown,
  path: string
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    fixtureError(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  path: string,
  keys: readonly string[]
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fixtureError(
      path,
      `must contain exactly: ${expected.join(', ')}`
    );
  }
}

function assertString(
  value: unknown,
  path: string
): asserts value is string {
  if (typeof value !== 'string') {
    fixtureError(path, 'must be a string');
  }
}

function assertNumber(
  value: unknown,
  path: string
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fixtureError(path, 'must be a finite number');
  }
}

function assertB256(
  value: unknown,
  path: string
): void {
  assertString(value, path);
  if (!B256_RE.test(value)) {
    fixtureError(path, 'must be 32-byte 0x-hex');
  }
}

function assertNullableB256(
  value: unknown,
  path: string
): void {
  if (value !== null) {
    assertB256(value, path);
  }
}

function assertNullableString(
  value: unknown,
  path: string
): void {
  if (value !== null) {
    assertString(value, path);
  }
}

function parseBatchVector(
  value: unknown,
  index: number
): BatchVector {
  const path = `vectors[${index}]`;
  const entry = assertRecord(value, path);
  assertExactKeys(entry, path, [
    'name',
    'class',
    'operation',
    'operation_type',
    'payload',
    'options',
    'authorization',
    'expected'
  ]);
  assertString(entry.name, `${path}.name`);
  assertString(entry.class, `${path}.class`);
  if (entry.operation !== 'BatchPayment') {
    fixtureError(`${path}.operation`, 'must be BatchPayment');
  }
  if (entry.operation_type !== 14) {
    fixtureError(`${path}.operation_type`, 'must be 14');
  }

  const payload = assertRecord(entry.payload, `${path}.payload`);
  assertExactKeys(payload, `${path}.payload`, [
    'chain_id',
    'nonce',
    'token',
    'operations',
    'created_at',
    'operations_hash',
    'batch_id'
  ]);
  assertNumber(payload.chain_id, `${path}.payload.chain_id`);
  assertNumber(payload.nonce, `${path}.payload.nonce`);
  assertString(payload.token, `${path}.payload.token`);
  assertNumber(payload.created_at, `${path}.payload.created_at`);
  if (!Array.isArray(payload.operations)) {
    fixtureError(`${path}.payload.operations`, 'must be an array');
  }
  payload.operations.forEach((operation, operationIndex) => {
    const operationPath = `${path}.payload.operations[${operationIndex}]`;
    const pair = assertRecord(operation, operationPath);
    assertExactKeys(pair, operationPath, ['recipient', 'amount']);
    assertString(pair.recipient, `${operationPath}.recipient`);
    assertString(pair.amount, `${operationPath}.amount`);
  });
  assertNullableB256(
    payload.operations_hash,
    `${path}.payload.operations_hash`
  );
  assertNullableString(
    payload.batch_id,
    `${path}.payload.batch_id`
  );

  const options = assertRecord(entry.options, `${path}.options`);
  if (Object.keys(options).length === 0) {
    // An omitted business memo is represented by an empty options object.
  } else {
    assertExactKeys(options, `${path}.options`, ['memo']);
    const memo = assertRecord(options.memo, `${path}.options.memo`);
    assertExactKeys(memo, `${path}.options.memo`, [
      'type',
      'format',
      'data'
    ]);
    assertString(memo.type, `${path}.options.memo.type`);
    assertString(memo.format, `${path}.options.memo.format`);
    assertString(memo.data, `${path}.options.memo.data`);
  }

  const authorization = assertRecord(
    entry.authorization,
    `${path}.authorization`
  );
  assertExactKeys(authorization, `${path}.authorization`, [
    'r',
    's',
    'v'
  ]);
  assertB256(authorization.r, `${path}.authorization.r`);
  assertB256(authorization.s, `${path}.authorization.s`);
  if (authorization.v !== 0 && authorization.v !== 1) {
    fixtureError(`${path}.authorization.v`, 'must be 0 or 1');
  }

  const expected = assertRecord(entry.expected, `${path}.expected`);
  assertExactKeys(expected, `${path}.expected`, [
    'signing_hash',
    'transaction_hash',
    'operations_hash'
  ]);
  assertB256(expected.signing_hash, `${path}.expected.signing_hash`);
  assertB256(expected.transaction_hash, `${path}.expected.transaction_hash`);
  assertB256(expected.operations_hash, `${path}.expected.operations_hash`);

  return entry as unknown as BatchVector;
}

export function parseBatchVectors(
  value: unknown
): BatchVector[] {
  const parsed = assertRecord(value, 'root');
  assertExactKeys(parsed, 'root', ['vectors']);
  if (!Array.isArray(parsed.vectors)) {
    fixtureError('vectors', 'must be an array');
  }
  return parsed.vectors.map(parseBatchVector);
}

export function batchVectors(): BatchVector[] {
  const raw = readFileSync(
    join(
      __dirname,
      '..',
      'fixtures',
      'batch-payment-vectors.json'
    ),
    'utf8'
  );
  return parseBatchVectors(JSON.parse(raw));
}

export function batchVector(name: string): BatchVector {
  const found = batchVectors().find(
    entry => entry.name === name
  );
  if (!found) {
    throw new Error(
      `[test]: no Batch Payment vector named ${name}`
    );
  }
  return found;
}
