// Types for tokens API
import type {
  AddressSchema,
  BytesSchema,
  U256Schema
} from '../types';

import type { Memo, Signature } from '@/utils';

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
  clawback_enabled: boolean;
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
  /** Optional transaction memo (see PaymentPayload.memo). */
  memo?: Memo;
}

export interface TokenBurnPayload {
  chain_id: number;
  nonce: number;
  value: string;
  token: string;
  signature: RestSignature;
  /** Optional transaction memo (see PaymentPayload.memo). */
  memo?: Memo;
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
  /** Optional transaction memo (see PaymentPayload.memo). */
  memo?: Memo;
}

export interface TokenIssuePayload {
  chain_id: number;
  nonce: number;
  symbol: string;
  name: string;
  decimals: number;
  master_authority: string;
  is_private: boolean;
  /**
   * @default true
   */
  clawback_enabled?: boolean;
  signature: RestSignature;
  /** Optional transaction memo (see PaymentPayload.memo). */
  memo?: Memo;
}

export interface TokenMintPayload {
  chain_id: number;
  nonce: number;
  recipient: string;
  value: string;
  token: string;
  signature: RestSignature;
  /** Optional transaction memo (see PaymentPayload.memo). */
  memo?: Memo;
}

export interface TokenPausePayload {
  chain_id: number;
  nonce: number;
  action: PauseAction;
  token: string;
  signature: RestSignature;
  /** Optional transaction memo (see PaymentPayload.memo). */
  memo?: Memo;
}

export interface TokenMetadataPayload {
  chain_id: number;
  nonce: number;
  name: string;
  uri: string;
  token: string;
  additional_metadata: KeyValuePair[];
  signature: RestSignature;
  /** Optional transaction memo (see PaymentPayload.memo). */
  memo?: Memo;
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
  /** Optional transaction memo (see PaymentPayload.memo). */
  memo?: Memo;
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
  /** Optional transaction memo (see PaymentPayload.memo). */
  memo?: Memo;
}

export interface TokenClawbackPayload {
  chain_id: number;
  nonce: number;
  token: string;
  from: string;
  recipient: string;
  value: string;
  signature: RestSignature;
  /** Optional transaction memo (see PaymentPayload.memo). */
  memo?: Memo;
}

/** A delegated role that a token's master grants and revokes. */
export type AuthorityRole =
  | 'pause'
  | 'manage_list'
  | 'update_metadata'
  | 'bridge'
  | 'clawback';

export type AuthorityListKind = 'blacklist' | 'whitelist';

export type AuthorityListAction = 'add' | 'remove';

/**
 * One token authority operation, decided at the checkpoint that
 * includes it. `type` names the operation. A revoke of an account
 * that holds no role or minter entry succeeds as a no-op, and its
 * receipt carries a `no_op_revoke` warning.
 */
export type AuthorityOperation =
  | { type: 'pause' }
  | { type: 'unpause' }
  | {
      type: 'list';
      list: AuthorityListKind;
      action: AuthorityListAction;
      account: AddressSchema;
    }
  | {
      type: 'update_metadata';
      name: string;
      uri: string;
      additional_metadata: MetaDataKeyValuePair[];
    }
  | {
      type: 'grant_role' | 'revoke_role';
      role: AuthorityRole;
      account: AddressSchema;
    }
  | {
      type: 'set_minter_allowance';
      minter: AddressSchema;
      /** An absolute allowance, in the token's base unit. */
      allowance: U256Schema;
    }
  | { type: 'revoke_minter'; minter: AddressSchema }
  | {
      type: 'rotate_master_mint_burn';
      account: AddressSchema;
    }
  | { type: 'revoke_master_mint_burn' }
  | {
      type: 'mint';
      recipient: AddressSchema;
      value: U256Schema;
    };

/** The unsigned settled authority envelope (native operation 17). */
export interface SettledAuthorityPayload {
  chain_id: number;
  /** The signer's nonce. */
  nonce: number;
  token: string;
  /**
   * A committed checkpoint, at most 100 behind the node's latest.
   * Admission reads the signer's role in its state.
   */
  reference_checkpoint: number;
  operation: AuthorityOperation;
}

/**
 * The unsigned lane clawback (native operation 18). It takes the
 * holder's nonce `from_nonce` and no nonce of its signer.
 */
export interface LaneClawbackPayload {
  chain_id: number;
  token: string;
  /** The frozen account to claw back from. */
  holder: string;
  /** The holder's next nonce when the clawback is signed. */
  from_nonce: number;
  reference_checkpoint: number;
  recipient: string;
  value: string;
}
