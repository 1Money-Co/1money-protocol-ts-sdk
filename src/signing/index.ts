import {
  preparePaymentTx,
  prepareTokenAuthorityTx,
  prepareTokenBridgeAndMintTx,
  prepareTokenBurnAndBridgeTx,
  prepareTokenBurnTx,
  prepareTokenClawbackTx,
  prepareTokenIssueTx,
  prepareTokenManageListTx,
  prepareTokenMetadataTx,
  prepareTokenMintTx,
  prepareTokenPauseTx,
} from './builders';
import { TransactionBuilderV2 } from './v2';

export * from './builders';
export * from './core';
export * from './signer';
export * from './eip712';
export * from './v2';

// Legacy v1 builders. Explicit opt-in during the migration
// window: these sign the pre-issue-1038 scheme and target the /v1
// write surface, which a node rejects with 410 once it reaches
// V2Only.
export const LegacyV1TransactionBuilder = {
  payment: preparePaymentTx,
  tokenManageList: prepareTokenManageListTx,
  tokenBurn: prepareTokenBurnTx,
  tokenAuthority: prepareTokenAuthorityTx,
  tokenIssue: prepareTokenIssueTx,
  tokenMint: prepareTokenMintTx,
  tokenPause: prepareTokenPauseTx,
  tokenMetadata: prepareTokenMetadataTx,
  tokenBridgeAndMint: prepareTokenBridgeAndMintTx,
  tokenBurnAndBridge: prepareTokenBurnAndBridgeTx,
  tokenClawback: prepareTokenClawbackTx
};

// The default builder is the domain-separated v2 scheme.
export const TransactionBuilder =
  TransactionBuilderV2;

export default TransactionBuilder;
