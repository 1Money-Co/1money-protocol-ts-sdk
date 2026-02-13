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

export * from './core';
export * from './signer';
export * from './builders';

export const tx = {
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
  tokenClawback: prepareTokenClawbackTx,
};

export default tx;
