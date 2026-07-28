import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type VectorSignature = {
  r: string;
  s: string;
  v: number;
};

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
