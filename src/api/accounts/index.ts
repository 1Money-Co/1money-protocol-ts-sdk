import { API_VERSION } from '@/api/constants';
import { submitAuthorized } from '@/api/submit';
import { get } from '@/client';

import type { Hash } from '@/api/types';
import type { AuthorizedTxV2 } from '@/signing/v2';
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
  },

  /**
   * Create a native multisig account. v2-only: legacy clients
   * used POST /v1/transactions/raw, which is retired.
   * Compute the resulting address locally with
   * deriveMultisigAddress -- the node returns only the hash.
   */
  createMultisig: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(authorized)
};

export default accountsApi;
