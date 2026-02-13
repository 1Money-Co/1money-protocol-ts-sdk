import { get, post } from '@/client';
import { API_VERSION } from '@/api/constants';

import type { Hash, HashWithToken } from '@/api/types';
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
    const payloadWithDefaults = {
      ...payload,
      clawback_enabled: payload.clawback_enabled ?? true
    };
    return post<'custom', HashWithToken>(`${API_PREFIX}/issue`, payloadWithDefaults, { withCredentials: false });
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
};

export default tokensApi;
