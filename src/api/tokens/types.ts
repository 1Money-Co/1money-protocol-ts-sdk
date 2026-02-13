// Types for tokens API
import type {
  AddressSchema,
  BytesSchema,
  U256Schema
} from '../types';

import type { Signature } from '@/utils';

// Token metadata key-value pair
export interface MetaDataKeyValuePair {
  key: string;
  value: string;
}

// Token metadata
export interface TokenMetadata {
  name: string;
  uri: string;
  additional_metadata: MetaDataKeyValuePair[];
}

// Minter allowance
export interface MinterAllowance {
  minter: AddressSchema;
  allowance: U256Schema;
}

// Mint info (token metadata)
export interface MintInfo {
  symbol: string;
  master_authority: AddressSchema;
  master_mint_burn_authority: AddressSchema;
  mint_burn_authorities: MinterAllowance[];
  pause_authorities: AddressSchema[];
  list_authorities: AddressSchema[];
  black_list: AddressSchema[];
  white_list: AddressSchema[];
  metadata_update_authorities: AddressSchema[];
  bridge_mint_authorities: AddressSchema[];
  supply: U256Schema;
  decimals: number;
  is_paused: boolean;
  is_private: boolean;
  meta: TokenMetadata;
}

// Request types
export interface KeyValuePair {
  key: string;
  value: string;
}

// Authority types
export enum AuthorityType {
  MasterMint = 'MasterMintBurn',
  MintBurnTokens = 'MintBurnTokens',
  Pause = 'Pause',
  ManageList = 'ManageList',
  UpdateMetadata = 'UpdateMetadata',
  Bridge = 'Bridge',
  Clawback = 'Clawback'
}

export enum AuthorityAction {
  Grant = 'Grant',
  Revoke = 'Revoke'
}

export enum ManageListAction {
  Add = 'Add',
  Remove = 'Remove'
}

export enum PauseAction {
  Pause = 'Pause',
  Unpause = 'Unpause'
}

// Signature type for REST requests
export interface RestSignature extends Signature {}

export interface TokenManageListPayload {
  chain_id: number;
  nonce: number;
  action: ManageListAction;
  address: string;
  token: string;
  signature: RestSignature;
}

export interface TokenBurnPayload {
  chain_id: number;
  nonce: number;
  value: string;
  token: string;
  signature: RestSignature;
}

export interface TokenAuthorityPayload {
  chain_id: number;
  nonce: number;
  action: AuthorityAction;
  authority_type: AuthorityType;
  authority_address: string;
  token: string;
  value?: string;
  signature: RestSignature;
}

export interface TokenIssuePayload {
  chain_id: number;
  nonce: number;
  symbol: string;
  name: string;
  decimals: number;
  master_authority: string;
  is_private: boolean;
  clawback_enabled?: boolean;
  signature: RestSignature;
}

export interface TokenMintPayload {
  chain_id: number;
  nonce: number;
  recipient: string;
  value: string;
  token: string;
  signature: RestSignature;
}

export interface TokenPausePayload {
  chain_id: number;
  nonce: number;
  action: PauseAction;
  token: string;
  signature: RestSignature;
}

export interface TokenMetadataPayload {
  chain_id: number;
  nonce: number;
  name: string;
  uri: string;
  token: string;
  additional_metadata: KeyValuePair[];
  signature: RestSignature;
}

export interface TokenBridgeAndMintPayload {
  chain_id: number;
  nonce: number;
  recipient: string;
  value: string;
  token: string;
  source_chain_id: number;
  source_tx_hash: string;
  bridge_metadata: string;
  signature: RestSignature;
}

export interface TokenBurnAndBridgePayload {
  chain_id: number;
  nonce: number;
  sender: string;
  value: string;
  token: string;
  destination_chain_id: number;
  destination_address: string;
  escrow_fee: string;
  bridge_metadata: string;
  bridge_param: BytesSchema;
  signature: RestSignature;
}

export interface TokenClawbackPayload {
  chain_id: number;
  nonce: number;
  token: string;
  from: string;
  recipient: string;
  value: string;
}

