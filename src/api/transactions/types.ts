// Types for transactions API
import { AuthorityType, RestSignature } from '../tokens/types';
import type {
  AddressSchema,
  B256Schema,
  BytesSchema
} from '../types';
import type { Memo } from '@/utils';

export interface BatchPaymentOperation {
  recipient: AddressSchema;
  amount: string;
}

export interface BridgeInfo {
  bbnonce: number;
  destination_chain_id: number;
  destination_address: string;
  bridge_param: BytesSchema;
}

export interface SuccessInfo {
  sender: AddressSchema;
  /** Batch receipts use the zero address; read PaymentExecuted events. */
  receiver: AddressSchema;
  is_private: boolean;
  message: string;
  bridge_info: BridgeInfo | null;
}

export interface BatchFailureInfo {
  failed_operation_index: number;
  reason: string;
}

export interface BatchReceiptInfo {
  batch_id: string | null;
  operations_hash: B256Schema | null;
  operations_count: number;
  total_amount: string;
  /** Reserved; current production failure path does not populate it. */
  failure: BatchFailureInfo | null;
}

export type BatchExecutionEvent =
  | {
      event_type: 'BatchStarted';
      batch_id: string | null;
      operations_count: number;
      total_amount: string;
      operations_hash: B256Schema | null;
    }
  | {
      event_type: 'PaymentExecuted';
      operation_index: number;
      recipient: AddressSchema;
      amount: string;
    }
  | {
      event_type: 'BatchCompleted';
      batch_id: string | null;
      operations_count: number;
      total_amount: string;
      operations_hash: B256Schema | null;
    };

// Transaction receipt response
export interface TransactionReceipt {
  success: boolean;
  transaction_hash: B256Schema;
  transaction_index?: number;
  fee_used: string;
  from: AddressSchema;
  checkpoint_hash?: B256Schema;
  checkpoint_number?: number;
  recipient?: AddressSchema | null;
  token_address?: AddressSchema | null;
  success_info?: SuccessInfo;
  batch_info?: BatchReceiptInfo;
  execution_events?: BatchExecutionEvent[];
}

// Finalized transaction receipt response
export interface FinalizedTransactionReceipt extends TransactionReceipt {
  epoch: number;
  counter_signatures: RestSignature[];
}

// Estimate fee response
export interface EstimateFee {
  fee: string;
  plan?: string;
}

export interface BatchFeeEstimateRequest {
  from: AddressSchema;
  token: AddressSchema;
  operations: PaymentOperation[];
}

// Payment transaction payload
export interface PaymentPayload {
  chain_id: number;
  nonce: number;
  recipient: AddressSchema;
  value: string;
  token: AddressSchema;
  signature: RestSignature;
  /**
   * Optional transaction memo. When present (even with empty subfields),
   * the request is routed to the V2 envelope variant on-chain and the
   * client MUST sign over the WithMemo<PaymentPayload> RLP shape.
   * When omitted/undefined, the request takes the legacy V1 path.
   */
  memo?: Memo;
}

// Transaction data types for different transaction types
export interface TokenCreateData {
  decimals: number;
  is_private: boolean;
  master_authority: AddressSchema;
  name: string;
  symbol: string;
}

export interface TokenTransferData {
  recipient: AddressSchema;
  token: AddressSchema;
  value: string;
}

export interface TokenMintData {
  recipient: AddressSchema;
  token: AddressSchema;
  value: string;
}

export interface TokenGrantAuthorityData {
  authority_address: AddressSchema;
  authority_type: AuthorityType;
  token: AddressSchema;
  value: string;
}

export interface TokenRevokeAuthorityData {
  authority_address: AddressSchema;
  authority_type: AuthorityType;
  token: AddressSchema;
  value: string;
}

export interface TokenBlacklistAccountData {
  address: AddressSchema;
  token: AddressSchema;
}

export interface TokenWhitelistAccountData {
  address: AddressSchema;
  token: AddressSchema;
}

export interface TokenBridgeAndMintData {
  bridge_metadata: string | null;
  recipient: AddressSchema;
  source_chain_id: number;
  source_tx_hash: string;
  token: AddressSchema;
  value: string;
}

export interface TokenBurnData {
  token: AddressSchema;
  value: string;
}

export interface TokenBurnAndBridgeData {
  value: string;
  sender: AddressSchema;
  destination_chain_id: number;
  destination_address: AddressSchema;
  escrow_fee: string;
  bridge_metadata: string | null;
  bridge_param: BytesSchema;
  token: AddressSchema;
}

export interface TokenClawbackData {
  from: AddressSchema;
  recipient: AddressSchema;
  value: string;
  token: AddressSchema;
}

export interface TokenCloseAccountData {
  token: AddressSchema;
}

export interface TokenPauseData {
  token: AddressSchema;
}

export interface TokenUpdateMetadataData {
  metadata: {
    name: string;
    uri: string;
    additional_metadata: Array<{
      key: string;
      value: string;
    }>;
  };
  token: AddressSchema;
}

export interface RawData {
  input: string;
  token: AddressSchema;
}

export interface TokenUnpauseData {
  token: AddressSchema;
}

// One recipient/amount pair inside a batch payment.
export interface PaymentOperation {
  recipient: AddressSchema;
  amount: string;
}

// Batch payment payload. `operations_hash` and `batch_id` are the
// only optional fields and are strictly trailing.
export interface BatchPaymentPayload {
  chain_id: number;
  nonce: number;
  token: AddressSchema;
  operations: PaymentOperation[];
  created_at: number;
  operations_hash?: B256Schema;
  /** Signed correlation metadata only; not an idempotency or replay key. */
  batch_id?: string;
}

export interface BatchPaymentData {
  token: AddressSchema | null;
  operations: BatchPaymentOperation[];
  operations_hash: B256Schema | null;
  batch_id: string | null;
  created_at: number;
}

export interface CreateMultiSigData {
  signers: Array<{
    public_key: string;
    weight: number;
  }>;
  threshold: number;
  multisig_address: AddressSchema;
}

// Base transaction fields shared by all transaction types
interface BaseTransaction {
  hash: B256Schema;

  checkpoint_hash?: B256Schema;
  checkpoint_number?: number;
  transaction_index?: number;

  chain_id: number;
  from: AddressSchema;
  nonce: number;
  signature: {
    r: string;
    s: string;
    v: number;
  };
  /**
   * Signed memo attached to the transaction. Populated only for V2
   * (memo-bearing) envelope variants; omitted when the transaction was
   * a legacy variant.
   */
  memo?: Memo;
}

// Discriminated union for all transaction types
export type Transaction =
  | (BaseTransaction & {
      transaction_type: 'TokenCreate';
      data: TokenCreateData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenTransfer';
      data: TokenTransferData;
    })
  | (BaseTransaction & {
      transaction_type: 'BatchPayment';
      data: BatchPaymentData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenMint';
      data: TokenMintData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenGrantAuthority';
      data: TokenGrantAuthorityData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenRevokeAuthority';
      data: TokenRevokeAuthorityData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenBlacklistAccount';
      data: TokenBlacklistAccountData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenWhitelistAccount';
      data: TokenWhitelistAccountData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenBridgeAndMint';
      data: TokenBridgeAndMintData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenBurn';
      data: TokenBurnData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenBurnAndBridge';
      data: TokenBurnAndBridgeData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenClawback';
      data: TokenClawbackData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenCloseAccount';
      data: TokenCloseAccountData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenPause';
      data: TokenPauseData;
    })
    | (BaseTransaction & {
        transaction_type: 'TokenUnpause';
        data: TokenUnpauseData;
    })
  | (BaseTransaction & {
      transaction_type: 'TokenUpdateMetadata';
      data: TokenUpdateMetadataData;
    })
  | (BaseTransaction & {
      transaction_type: 'CreateMultiSig';
      data: CreateMultiSigData;
    })
  | (BaseTransaction & {
      transaction_type: 'Raw';
      data: RawData;
    });
