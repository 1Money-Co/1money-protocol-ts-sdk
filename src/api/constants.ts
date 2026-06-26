
// Base URLs for the API
export const TESTNET_API_URL = 'https://api.testnet.1money.network';
export const MAINNET_API_URL = 'https://api.mainnet.1money.network';
export const LOCAL_API_URL = 'http://localhost:18555';

// Chain IDs for different networks
export const CHAIN_IDS = {
  MAINNET: 21210,
  TESTNET: 1212101,
  LOCAL: 1212101 // Using same chain ID as testnet for local development
} as const;

// API version
export const API_VERSION = 'v1';