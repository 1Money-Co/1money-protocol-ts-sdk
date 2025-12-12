// Types for transactions API
import { AuthorityType, RestSignature } from '../tokens/types';
import { AddressSchema, B256Schema } from '../types';

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

// Finalized transaction receipt response
export interface FinalizedTransactionReceipt extends TransactionReceipt {
  epoch: number;
  counter_signatures: RestSignature[];
}

// Estimate fee response
export interface EstimateFee {
  fee: string;
}

// Payment transaction payload
export interface PaymentPayload {
  chain_id: number;
  nonce: number;
  recipient: AddressSchema;
  value: string;
  token: AddressSchema;
  signature: RestSignature;
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
  recipient: AddressSchema;
  token: AddressSchema;
  value: string;
}

export interface TokenBurnAndBridgeData {
  bridge_metadata: string | null;
  destination_address: AddressSchema;
  destination_chain_id: number;
  escrow_fee: string;
  sender: AddressSchema;
  token: AddressSchema;
  value: string;
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
      transaction_type: 'Raw';
      data: RawData;
    });
