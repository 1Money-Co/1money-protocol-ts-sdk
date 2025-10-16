import { setInitConfig } from '@/client';

// Import API modules
import accountsApi from './accounts';
import checkpointsApi from './checkpoints';
import tokensApi from './tokens';
import transactionsApi from './transactions';
import chainApi from './chain';
import { CHAIN_IDS, MAINNET_API_URL, TESTNET_API_URL, LOCAL_API_URL } from './constants';

// Re-export types from each module
export * from './accounts/types';
export * from './tokens/types';
export * from './transactions/types';
export * from './checkpoints/types';
export * from './chain/types';

/**
 * API client for 1money network
 * @param options Configuration options
 * @param options.network Network to use (testnet, mainnet, local)
 * @param options.timeout Request timeout in milliseconds
 * @param options.chainId Custom chain ID (overrides the default for the selected network)
 */
export function api(options?: {
  network?: 'testnet' | 'mainnet' | 'local';
  timeout?: number;
}): {
  accounts: typeof accountsApi;
  checkpoints: typeof checkpointsApi;
  tokens: typeof tokensApi;
  transactions: typeof transactionsApi;
  chain: typeof chainApi;
} {
  const network = options?.network || 'mainnet';
  let baseURL = MAINNET_API_URL;

  // Set the base URL based on the network
  switch (network) {
    case 'mainnet':
      baseURL = MAINNET_API_URL;
      break;
    case 'testnet':
      baseURL = TESTNET_API_URL;
      break;
    case 'local':
      baseURL = LOCAL_API_URL;
      break;
  }

  // Initialize API configuration
  setInitConfig({
    baseURL,
    // Treat status code 200 as success
    isSuccess: (_res, status) => status === 200,
    timeout: options?.timeout || 10000
  });

  return {
    /**
     * Accounts API methods
     */
    accounts: accountsApi,

    /**
     * Checkpoint API methods
     */
    checkpoints: checkpointsApi,

    /**
     * Tokens API methods
     */
    tokens: tokensApi,

    /**
     * Transactions API methods
     */
    transactions: transactionsApi,

    /**
     * Chain API methods
     */
    chain: chainApi,
  };
}

export default api;
