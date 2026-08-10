import { API_VERSION } from '@/api/constants';
import { submitAuthorized } from '@/api/submit';
import { get, post } from '@/client';

import type { Hash } from '@/api/types';
import type { AuthorizedTxV2 } from '@/signing/v2';
import type {
  BatchFeeEstimateRequest,
  EstimateFee,
  FinalizedTransactionReceipt,
  PaymentPayload,
  Transaction,
  TransactionReceipt
} from './types';

const API_PREFIX = `/${API_VERSION}/transactions`;

/**
 * Transactions API methods
 */
export const transactionsApi = {
  /**
   * Get transaction by hash
   * @param hash Hash of the transaction to lookup
   * @returns Promise with transaction response
   */
  getByHash: (hash: string) => {
    return get<'custom', Transaction>(`${API_PREFIX}/by_hash?hash=${hash}`, { withCredentials: false });
  },

  /**
   * Get transaction receipt by hash
   * @param hash Hash of the transaction to lookup receipt for
   * @returns Promise with transaction receipt response
   */
  getReceiptByHash: (hash: string) => {
    return get<'custom', TransactionReceipt>(`${API_PREFIX}/receipt/by_hash?hash=${hash}`, { withCredentials: false });
  },

  /**
   * Get finalized transaction by hash
   * @param hash Hash of the transaction to lookup
   * @returns Promise with finalized transaction receipt response
   */
  getFinalizedByHash: (hash: string) => {
    return get<'custom', FinalizedTransactionReceipt>(`${API_PREFIX}/finalized/by_hash?hash=${hash}`, { withCredentials: false });
  },

  /**
   * Estimate transaction fee
   * @param from Address of the transaction author
   * @param to Address of the transaction recipient
   * @param value Value of the transaction
   * @param token Token address
   * @returns Promise with fee estimate response
   */
  estimateFee: (from: string, to: string, value: string, token: string) => {
    const url = `${API_PREFIX}/estimate_fee?from=${from}&value=${value}&to=${to}&token=${token}`;
    return get<'custom', EstimateFee>(url, { withCredentials: false });
  },

  /**
   * Estimate the fee for an unsigned Batch Payment.
   */
  estimateBatchPaymentFee: (
    request: BatchFeeEstimateRequest
  ) =>
    post<'custom', EstimateFee>(
      `${API_PREFIX}/batch_payment/estimate_fee`,
      request,
      { withCredentials: false }
    ),

  /**
   * Submit a domain-separated v2 payment.
   * @param authorized Output of TransactionBuilderV2.payment(..).authorize(sig)
   */
  payment: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(authorized, 'payment'),

  /**
   * Submit a domain-separated v2 batch payment.
   */
  batchPayment: (authorized: AuthorizedTxV2) =>
    submitAuthorized<Hash>(
      authorized,
      'batchPayment'
    ),

  /**
   * Legacy v1 writes. Explicit opt-in for the migration window;
   * rejected with 410 once the node reaches V2Only.
   */
  legacyV1: {
    /**
     * Submit payment transaction
     * @param payload Payment transaction payload
     * @returns Promise with transaction hash response
     */
    payment: (payload: PaymentPayload) => {
      return post<'custom', Hash>(`${API_PREFIX}/payment`, payload, { withCredentials: false });
    }
  }
};

export default transactionsApi;
