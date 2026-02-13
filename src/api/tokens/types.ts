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

// type Unsigned<T extends { signature: RestSignature }> = Omit<T, 'signature'>;

// function withRlpEncodeBytes<T>(
//   payload: T,
//   encode: () => Uint8Array
// ): WithRlpEncodeBytes<T> {
//   return {
//     ...payload,
//     rlpEncodeBytes: encode,
//   };
// }

// export function withTokenManageListRlpEncodeBytes(
//   payload: Unsigned<TokenManageListPayload> | TokenManageListPayload
// ): WithRlpEncodeBytes<
//   Unsigned<TokenManageListPayload> | TokenManageListPayload
// > {
//   return withRlpEncodeBytes(payload, () =>
//     encodePayload2(ev.list([
//       ev.uint(payload.chain_id),
//       ev.uint(payload.nonce),
//       ev.string(payload.action),
//       ev.address(payload.address as `0x${string}`),
//       ev.address(payload.token as `0x${string}`),
//     ]))
//   );
// }

// export function withTokenBurnRlpEncodeBytes(
//   payload: Unsigned<TokenBurnPayload> | TokenBurnPayload
// ): WithRlpEncodeBytes<Unsigned<TokenBurnPayload> | TokenBurnPayload> {
//   return withRlpEncodeBytes(payload, () =>
//     encodePayload2(ev.list([
//       ev.uint(payload.chain_id),
//       ev.uint(payload.nonce),
//       ev.uint(payload.value),
//       ev.address(payload.token as `0x${string}`),
//     ]))
//   );
// }

// export function withTokenAuthorityRlpEncodeBytes(
//   payload: Unsigned<TokenAuthorityPayload> | TokenAuthorityPayload
// ): WithRlpEncodeBytes<
//   Unsigned<TokenAuthorityPayload> | TokenAuthorityPayload
// > {
//   return withRlpEncodeBytes(payload, () => {
//     const encoded = [
//       ev.uint(payload.chain_id),
//       ev.uint(payload.nonce),
//       ev.string(payload.action),
//       ev.string(payload.authority_type),
//       ev.address(payload.authority_address as `0x${string}`),
//       ev.address(payload.token as `0x${string}`),
//     ];

//     if (payload.value !== undefined) {
//       encoded.push(ev.uint(payload.value));
//     }

//     return encodePayload2(ev.list(encoded));
//   });
// }

// export function withTokenIssueRlpEncodeBytes(
//   payload: Unsigned<TokenIssuePayload> | TokenIssuePayload
// ): WithRlpEncodeBytes<Unsigned<TokenIssuePayload> | TokenIssuePayload> {
//   return withRlpEncodeBytes(payload, () =>
//     encodePayload2(ev.list([
//       ev.uint(payload.chain_id),
//       ev.uint(payload.nonce),
//       ev.string(payload.symbol),
//       ev.string(payload.name),
//       ev.uint(payload.decimals),
//       ev.address(payload.master_authority as `0x${string}`),
//       ev.bool(payload.is_private),
//       ev.bool(payload.clawback_enabled ?? true),
//     ]))
//   );
// }

// export function withTokenMintRlpEncodeBytes(
//   payload: Unsigned<TokenMintPayload> | TokenMintPayload
// ): WithRlpEncodeBytes<Unsigned<TokenMintPayload> | TokenMintPayload> {
//   return withRlpEncodeBytes(payload, () =>
//     encodePayload2(ev.list([
//       ev.uint(payload.chain_id),
//       ev.uint(payload.nonce),
//       ev.address(payload.recipient as `0x${string}`),
//       ev.uint(payload.value),
//       ev.address(payload.token as `0x${string}`),
//     ]))
//   );
// }

// export function withTokenPauseRlpEncodeBytes(
//   payload: Unsigned<TokenPausePayload> | TokenPausePayload
// ): WithRlpEncodeBytes<Unsigned<TokenPausePayload> | TokenPausePayload> {
//   return withRlpEncodeBytes(payload, () =>
//     encodePayload2(ev.list([
//       ev.uint(payload.chain_id),
//       ev.uint(payload.nonce),
//       ev.string(payload.action),
//       ev.address(payload.token as `0x${string}`),
//     ]))
//   );
// }

// export function withTokenMetadataRlpEncodeBytes(
//   payload: Unsigned<TokenMetadataPayload> | TokenMetadataPayload
// ): WithRlpEncodeBytes<
//   Unsigned<TokenMetadataPayload> | TokenMetadataPayload
// > {
//   return withRlpEncodeBytes(payload, () =>
//     encodePayload2(ev.list([
//       ev.uint(payload.chain_id),
//       ev.uint(payload.nonce),
//       ev.string(payload.name),
//       ev.string(payload.uri),
//       ev.address(payload.token as `0x${string}`),
//       ev.hex(toHex(payload.additional_metadata)),
//     ]))
//   );
// }

// export function withTokenBridgeAndMintRlpEncodeBytes(
//   payload: Unsigned<TokenBridgeAndMintPayload> | TokenBridgeAndMintPayload
// ): WithRlpEncodeBytes<
//   Unsigned<TokenBridgeAndMintPayload> | TokenBridgeAndMintPayload
// > {
//   return withRlpEncodeBytes(payload, () =>
//     encodePayload2(ev.list([
//       ev.uint(payload.chain_id),
//       ev.uint(payload.nonce),
//       ev.address(payload.recipient as `0x${string}`),
//       ev.uint(payload.value),
//       ev.address(payload.token as `0x${string}`),
//       ev.uint(payload.source_chain_id),
//       ev.hex(payload.source_tx_hash as `0x${string}`),
//       ev.string(payload.bridge_metadata),
//     ]))
//   );
// }

// export function withTokenBurnAndBridgeRlpEncodeBytes(
//   payload: Unsigned<TokenBurnAndBridgePayload> | TokenBurnAndBridgePayload
// ): WithRlpEncodeBytes<
//   Unsigned<TokenBurnAndBridgePayload> | TokenBurnAndBridgePayload
// > {
//   return withRlpEncodeBytes(payload, () =>
//     encodePayload2(ev.list([
//       ev.uint(payload.chain_id),
//       ev.uint(payload.nonce),
//       ev.address(payload.sender as `0x${string}`),
//       ev.uint(payload.value),
//       ev.address(payload.token as `0x${string}`),
//       ev.uint(payload.destination_chain_id),
//       ev.address(payload.destination_address as `0x${string}`),
//       ev.uint(payload.escrow_fee),
//       ev.string(payload.bridge_metadata),
//       ev.hex(payload.bridge_param as `0x${string}`),
//     ]))
//   );
// }
