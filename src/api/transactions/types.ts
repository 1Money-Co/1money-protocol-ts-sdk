// Types for transactions API
import { AddressSchema, B256Schema } from '../types';
import { RestSignature } from '../tokens/types';

// Transaction receipt response
export interface TransactionReceipt {
  success: boolean;
  transaction_hash: B256Schema;
  fee_used: number;
  from: AddressSchema;
  checkpoint_hash?: B256Schema;
  checkpoint_number?: number;
  to?: AddressSchema;
  token_address?: AddressSchema;
}

// Estimate fee response
export interface EstimateFee {
  fee: string;
}

// Payment transaction payload
export interface PaymentPayload {
  recent_checkpoint: number;
  chain_id: number;
  nonce: number;
  recipient: AddressSchema;
  value: string;
  token: AddressSchema;
  signature: RestSignature;
}
