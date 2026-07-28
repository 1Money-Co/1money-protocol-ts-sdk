import { get, post } from '@/client';
import { API_VERSION } from '@/api/constants';
import { submitAuthorized } from '@/api/submit';

import type { Hash, HashWithToken } from '@/api/types';
import type { AuthorizedTxV2 } from '@/signing/v2';
import type {
  MintInfo,
  TokenManageListPayload,
  TokenBurnPayload,
  TokenAuthorityPayload,
  TokenIssuePayload,
  TokenMintPayload,
  TokenPausePayload,
  TokenMetadataPayload,
  TokenBridgeAndMintPayload,
  TokenBurnAndBridgePayload,
  TokenClawbackPayload,
} from './types';

const API_PREFIX = `/${API_VERSION}/tokens`;

/**
 * Tokens API methods
 */
export const tokensApi = {
  /**
   * Get token metadata
   * @param token Token address to lookup metadata for
   * @returns Promise with token metadata response
   */
  getTokenMetadata: (token: string) => {
    return get<'custom', MintInfo>(`${API_PREFIX}/token_metadata?token=${token}`, { withCredentials: false });
  },

  /**
   * Issue new token
   * @param authorized Output of TransactionBuilderV2.tokenIssue(..).authorize(sig)
   */
  issueToken: (authorized: AuthorizedTxV2) =>
    submitAuthorized<HashWithToken>(authorized),

  /**
   * Mint tokens
   * @param authorized Output of TransactionBuilderV2.tokenMint(..).authorize(sig)
   */
  mintToken: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(authorized),

  /**
   * Burn tokens
   * @param authorized Output of TransactionBuilderV2.tokenBurn(..).authorize(sig)
   */
  burnToken: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(authorized),

  /**
   * Claw back tokens from a wallet
   * @param authorized Output of TransactionBuilderV2.tokenClawback(..).authorize(sig)
   */
  clawbackToken: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(authorized),

  /**
   * Grant or revoke token authority
   * @param authorized Output of TransactionBuilderV2.tokenAuthority(..).authorize(sig)
   */
  grantAuthority: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(authorized),

  /**
   * Manage token blacklist
   * @param authorized Output of TransactionBuilderV2.tokenBlacklist(..).authorize(sig)
   */
  manageBlacklist: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(authorized),

  /**
   * Manage token whitelist
   * @param authorized Output of TransactionBuilderV2.tokenWhitelist(..).authorize(sig)
   */
  manageWhitelist: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(authorized),

  /**
   * Pause or unpause token
   * @param authorized Output of TransactionBuilderV2.tokenPause(..).authorize(sig)
   */
  pauseToken: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(authorized),

  /**
   * Update token metadata
   * @param authorized Output of TransactionBuilderV2.tokenMetadata(..).authorize(sig)
   */
  updateMetadata: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(authorized),

  /**
   * Bridge and mint tokens
   * @param authorized Output of TransactionBuilderV2.tokenBridgeAndMint(..).authorize(sig)
   */
  bridgeAndMint: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(authorized),

  /**
   * Burn and bridge tokens
   * @param authorized Output of TransactionBuilderV2.tokenBurnAndBridge(..).authorize(sig)
   */
  burnAndBridge: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(authorized),

  /**
   * Legacy v1 writes. Explicit opt-in for the migration window;
   * rejected with 410 once the node reaches V2Only.
   */
  legacyV1: {
    /**
     * Manage token blacklist
     * @param payload Token blacklist request payload
     * @returns Promise with transaction hash response
     */
    manageBlacklist: (payload: TokenManageListPayload) => {
      return post<'custom', Hash>(`${API_PREFIX}/manage_blacklist`, payload, { withCredentials: false });
    },

    /**
     * Manage token whitelist
     * @param payload Token whitelist request payload
     * @returns Promise with transaction hash response
     */
    manageWhitelist: (payload: TokenManageListPayload) => {
      return post<'custom', Hash>(`${API_PREFIX}/manage_whitelist`, payload, { withCredentials: false });
    },

    /**
     * Burn tokens
     * @param payload Token burn request payload
     * @returns Promise with transaction hash response
     */
    burnToken: (payload: TokenBurnPayload) => {
      return post<'custom', Hash>(`${API_PREFIX}/burn`, payload, { withCredentials: false });
    },

    /**
     * Grant or revoke token authority
     * @param payload Token authority request payload
     * @returns Promise with transaction hash response
     */
    grantAuthority: (payload: TokenAuthorityPayload) => {
      return post<'custom', Hash>(`${API_PREFIX}/grant_authority`, payload, { withCredentials: false });
    },

    /**
     * Issue new token
     * @param payload Token issue request payload
     * @returns Promise with transaction hash and token address response
     */
    issueToken: (payload: TokenIssuePayload) => {
      return post<'custom', HashWithToken>(`${API_PREFIX}/issue`, payload, { withCredentials: false });
    },

    /**
     * Mint tokens
     * @param payload Token mint request payload
     * @returns Promise with transaction hash response
     */
    mintToken: (payload: TokenMintPayload) => {
      return post<'custom', Hash>(`${API_PREFIX}/mint`, payload, { withCredentials: false });
    },

    /**
     * Pause or unpause token
     * @param payload Token pause request payload
     * @returns Promise with transaction hash response
     */
    pauseToken: (payload: TokenPausePayload) => {
      return post<'custom', Hash>(`${API_PREFIX}/pause`, payload, { withCredentials: false });
    },

    /**
     * Update token metadata
     * @param payload Token metadata request payload
     * @returns Promise with transaction hash response
     */
    updateMetadata: (payload: TokenMetadataPayload) => {
      return post<'custom', Hash>(`${API_PREFIX}/update_metadata`, payload, { withCredentials: false });
    },

    /**
     * Bridge and mint tokens
     * @param payload Token bridge and mint request payload
     * @returns Promise with transaction hash response
     */
    bridgeAndMint: (payload: TokenBridgeAndMintPayload) => {
      return post<'custom', Hash>(`${API_PREFIX}/bridge_and_mint`, payload, { withCredentials: false });
    },

    /**
     * Burn and bridge tokens
     * @param payload Token burn and bridge request payload
     * @returns Promise with transaction hash response
     */
    burnAndBridge: (payload: TokenBurnAndBridgePayload) => {
      return post<'custom', Hash>(`${API_PREFIX}/burn_and_bridge`, payload, { withCredentials: false });
    },

    /**
     * Claw back tokens from a wallet
     * @param payload Token clawback request payload
     * @returns Promise with transaction hash response
     */
    clawbackToken: (payload: TokenClawbackPayload) => {
      return post<'custom', Hash>(`${API_PREFIX}/clawback`, payload, { withCredentials: false });
    }
  }
};

export default tokensApi;
