import {
  batchPaymentPayloadFields,
  batchPaymentWireFields,
  validateBatchPayment
} from '../builders/batchPayment';
import {
  createMultisigPayloadFields,
  createMultisigWireFields,
  validateCreateMultisig
} from '../builders/createMultisig';
import {
  paymentPayloadFields,
  validatePayment
} from '../builders/payment';
import {
  tokenAuthorityPayloadFields,
  validateTokenAuthority
} from '../builders/tokenAuthority';
import {
  tokenBridgeAndMintPayloadFields,
  validateTokenBridgeAndMint
} from '../builders/tokenBridgeAndMint';
import {
  tokenBurnPayloadFields,
  validateTokenBurn
} from '../builders/tokenBurn';
import {
  tokenBurnAndBridgePayloadFields,
  validateTokenBurnAndBridge
} from '../builders/tokenBurnAndBridge';
import {
  tokenClawbackPayloadFields,
  validateTokenClawback
} from '../builders/tokenClawback';
import {
  tokenIssuePayloadFields,
  validateTokenIssue
} from '../builders/tokenIssue';
import {
  tokenManageListPayloadFields,
  validateTokenManageList
} from '../builders/tokenManageList';
import {
  tokenMetadataPayloadFields,
  validateTokenMetadata
} from '../builders/tokenMetadata';
import {
  tokenMintPayloadFields,
  validateTokenMint
} from '../builders/tokenMint';
import {
  tokenPausePayloadFields,
  validateTokenPause
} from '../builders/tokenPause';
import { NativeOperationType } from './domain';
import {
  tokenAuthorityWireFields,
  tokenMetadataWireFields
} from './wire';

import type { PlpPayload } from '@/utils';
import type { BatchPaymentUnsigned } from '../builders/batchPayment';
import type { CreateMultisigUnsigned } from '../builders/createMultisig';
import type { PaymentUnsigned } from '../builders/payment';
import type { TokenAuthorityUnsigned } from '../builders/tokenAuthority';
import type { TokenBridgeAndMintUnsigned } from '../builders/tokenBridgeAndMint';
import type { TokenBurnUnsigned } from '../builders/tokenBurn';
import type { TokenBurnAndBridgeUnsigned } from '../builders/tokenBurnAndBridge';
import type { TokenClawbackUnsigned } from '../builders/tokenClawback';
import type { TokenIssueUnsigned } from '../builders/tokenIssue';
import type { TokenManageListUnsigned } from '../builders/tokenManageList';
import type { TokenMetadataUnsigned } from '../builders/tokenMetadata';
import type { TokenMintUnsigned } from '../builders/tokenMint';
import type { TokenPauseUnsigned } from '../builders/tokenPause';

// The /v2 request body never carries a memo inside the business
// payload: the memo is a sibling field supplied through the prepare
// options, so it is stripped from every unsigned type here.
type WithoutMemo<T> = Omit<T, 'memo'>;

export interface OperationUnsignedMap {
  payment: WithoutMemo<PaymentUnsigned>;
  tokenIssue: WithoutMemo<TokenIssueUnsigned>;
  tokenMint: WithoutMemo<TokenMintUnsigned>;
  tokenAuthority: WithoutMemo<TokenAuthorityUnsigned>;
  tokenBlacklist: WithoutMemo<TokenManageListUnsigned>;
  tokenWhitelist: WithoutMemo<TokenManageListUnsigned>;
  tokenPause: WithoutMemo<TokenPauseUnsigned>;
  tokenBurn: WithoutMemo<TokenBurnUnsigned>;
  tokenClawback: WithoutMemo<TokenClawbackUnsigned>;
  tokenMetadata: WithoutMemo<TokenMetadataUnsigned>;
  tokenBridgeAndMint: WithoutMemo<TokenBridgeAndMintUnsigned>;
  tokenBurnAndBridge: WithoutMemo<TokenBurnAndBridgeUnsigned>;
  createMultisig: CreateMultisigUnsigned;
  batchPayment: WithoutMemo<BatchPaymentUnsigned>;
}

export type OperationName =
  keyof OperationUnsignedMap;

export interface OperationSpec<TUnsigned> {
  operationType: number;
  // Every registered native-v2 operation uses the memo wrapper.
  memoCapable: boolean;
  // Declared metadata recording the legacy correspondence; null
  // only for createMultisig, which has no legacy form. The
  // legacyV1 API methods keep their own hardcoded paths, so
  // nothing reads this field today -- it exists so the registry
  // stays the complete op-to-route mapping.
  pathV1: string | null;
  pathV2: string;
  payloadFields: (u: TUnsigned) => PlpPayload[];
  validate: (u: TUnsigned) => void;
  // Omit when the JSON body is exactly the unsigned object.
  wireFields?: (
    u: TUnsigned
  ) => Record<string, unknown>;
}

export const OPERATION_REGISTRY: {
  [K in OperationName]: OperationSpec<
    OperationUnsignedMap[K]
  >;
} = {
  payment: {
    operationType: NativeOperationType.Payment,
    memoCapable: true,
    pathV1: '/v1/transactions/payment',
    pathV2: '/v2/transactions/payment',
    payloadFields: paymentPayloadFields,
    validate: validatePayment
  },
  tokenIssue: {
    operationType: NativeOperationType.TokenIssue,
    memoCapable: true,
    pathV1: '/v1/tokens/issue',
    pathV2: '/v2/tokens/issue',
    payloadFields: tokenIssuePayloadFields,
    validate: validateTokenIssue
  },
  tokenMint: {
    operationType: NativeOperationType.TokenMint,
    memoCapable: true,
    pathV1: '/v1/tokens/mint',
    pathV2: '/v2/tokens/mint',
    payloadFields: tokenMintPayloadFields,
    validate: validateTokenMint
  },
  tokenAuthority: {
    operationType:
      NativeOperationType.TokenAuthority,
    memoCapable: true,
    pathV1: '/v1/tokens/grant_authority',
    pathV2: '/v2/tokens/grant_authority',
    payloadFields: tokenAuthorityPayloadFields,
    validate: validateTokenAuthority,
    wireFields: tokenAuthorityWireFields
  },
  tokenBlacklist: {
    operationType:
      NativeOperationType.TokenBlacklist,
    memoCapable: true,
    pathV1: '/v1/tokens/manage_blacklist',
    pathV2: '/v2/tokens/manage_blacklist',
    payloadFields: tokenManageListPayloadFields,
    validate: validateTokenManageList
  },
  tokenWhitelist: {
    operationType:
      NativeOperationType.TokenWhitelist,
    memoCapable: true,
    pathV1: '/v1/tokens/manage_whitelist',
    pathV2: '/v2/tokens/manage_whitelist',
    payloadFields: tokenManageListPayloadFields,
    validate: validateTokenManageList
  },
  tokenPause: {
    operationType: NativeOperationType.TokenPause,
    memoCapable: true,
    pathV1: '/v1/tokens/pause',
    pathV2: '/v2/tokens/pause',
    payloadFields: tokenPausePayloadFields,
    validate: validateTokenPause
  },
  tokenBurn: {
    operationType: NativeOperationType.TokenBurn,
    memoCapable: true,
    pathV1: '/v1/tokens/burn',
    pathV2: '/v2/tokens/burn',
    payloadFields: tokenBurnPayloadFields,
    validate: validateTokenBurn
  },
  tokenClawback: {
    operationType:
      NativeOperationType.TokenClawback,
    memoCapable: true,
    pathV1: '/v1/tokens/clawback',
    pathV2: '/v2/tokens/clawback',
    payloadFields: tokenClawbackPayloadFields,
    validate: validateTokenClawback
  },
  tokenMetadata: {
    operationType:
      NativeOperationType.TokenMetadata,
    memoCapable: true,
    pathV1: '/v1/tokens/update_metadata',
    pathV2: '/v2/tokens/update_metadata',
    payloadFields: tokenMetadataPayloadFields,
    validate: validateTokenMetadata,
    wireFields: tokenMetadataWireFields
  },
  tokenBridgeAndMint: {
    operationType:
      NativeOperationType.TokenBridgeAndMint,
    memoCapable: true,
    pathV1: '/v1/tokens/bridge_and_mint',
    pathV2: '/v2/tokens/bridge_and_mint',
    payloadFields:
      tokenBridgeAndMintPayloadFields,
    validate: validateTokenBridgeAndMint
  },
  tokenBurnAndBridge: {
    operationType:
      NativeOperationType.TokenBurnAndBridge,
    memoCapable: true,
    pathV1: '/v1/tokens/burn_and_bridge',
    pathV2: '/v2/tokens/burn_and_bridge',
    payloadFields:
      tokenBurnAndBridgePayloadFields,
    validate: validateTokenBurnAndBridge
  },
  createMultisig: {
    operationType:
      NativeOperationType.CreateMultiSig,
    memoCapable: true,
    // v2-only: legacy clients used POST /v1/transactions/raw,
    // which is retired and returns 410 Gone.
    pathV1: null,
    pathV2: '/v2/accounts/multisig',
    payloadFields: createMultisigPayloadFields,
    validate: validateCreateMultisig,
    wireFields: createMultisigWireFields
  },
  batchPayment: {
    operationType:
      NativeOperationType.BatchPayment,
    memoCapable: true,
    pathV1: '/v1/transactions/batch_payment',
    pathV2: '/v2/transactions/batch_payment',
    payloadFields: batchPaymentPayloadFields,
    validate: validateBatchPayment,
    wireFields: batchPaymentWireFields
  }
};
