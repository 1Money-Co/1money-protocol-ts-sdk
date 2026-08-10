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
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray(
      (parsed as { vectors?: unknown }).vectors
    )
  ) {
    throw new Error(
      '[test]: Batch Payment fixture must contain a vectors array'
    );
  }
  return (parsed as { vectors: BatchVector[] }).vectors;
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
