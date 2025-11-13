import { API_VERSION } from '@/api/constants';
import { get } from '@/client';

import type { AccountInfo, AssociatedTokenAccount, BbNonceInfo } from './types';


const API_PREFIX = `/${API_VERSION}/accounts`;

/**
 * Accounts API methods
 */
export const accountsApi = {
  /**
   * Get account nonce
   * @param address Address of the account to lookup nonce for
   * @returns Promise with account info response
   */
  getNonce: (address: string) => {
    return get<'custom', AccountInfo>(`${API_PREFIX}/nonce?address=${address}`, { withCredentials: false });
  },

  /**
   * Get account bbnonce
   * @param address Address of the account to lookup nonce for
   * @returns Promise with bbnonce info response
   */
  getBbNonce: (address: string) => {
    return get<'custom', BbNonceInfo>(`${API_PREFIX}/bbnonce?address=${address}`, { withCredentials: false });
  },

  /**
   * Get associated token account
   * @param address Address of the account to lookup associated token account for
   * @param token Token address to lookup associated token account for
   * @returns Promise with associated token account response
   */
  getTokenAccount: (address: string, token: string) => {
    return get<'custom', AssociatedTokenAccount>(`${API_PREFIX}/token_account?address=${address}&token=${token}`, { withCredentials: false });
  }
};

export default accountsApi;
