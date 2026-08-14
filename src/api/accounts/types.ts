// Types for accounts API
import { U256Schema } from '../types';

// Account info response
export interface AccountInfo {
  nonce: number;
}

// Bbnonce info response
export interface BbNonceInfo {
  bbnonce: number;
}

// Associated token account response
export interface AssociatedTokenAccount {
  balance: U256Schema;
  nonce: number;
}

// One member of a multisig account. `public_key` is the 33-byte
// SEC1-compressed key as 0x-hex.
export interface MultiSigSigner {
  public_key: string;
  weight: number;
}

// Multisig account creation payload. The creation transaction is
// itself single-signed.
export interface CreateMultiSigPayload {
  chain_id: number;
  nonce: number;
  signers: MultiSigSigner[];
  threshold: number;
}
