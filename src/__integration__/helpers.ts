/**
 * Integration test helper utilities
 */

import { api } from '@/api';
import { getAddress } from 'viem';
import { getConfig } from './config';

/**
 * Create API client for integration tests
 */
export function createTestClient() {
  const config = getConfig();
  return api({
    network: config.network,
    timeout: config.timeout
  });
}


/**
 * Wait for a transaction to be finalized
 * @param txHash Transaction hash
 * @param maxRetries Maximum number of retries
 * @param retryDelay Delay between retries in milliseconds
 */
export async function waitForFinalization(
  txHash: string,
  maxRetries: number = 30,
  retryDelay: number = 2000
): Promise<boolean> {
  const client = createTestClient();

  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await client.transactions.getFinalizedByHash(txHash);

      if (result) {
        return true;
      }
    } catch (error) {
      // Transaction not finalized yet, continue waiting
    }

    // Wait before next retry
    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }

  return false;
}

/**
 * Wait for a specific amount of time
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get current checkpoint number
 */
export async function getCurrentCheckpoint(): Promise<number> {
  const client = createTestClient();
  const response = await client.checkpoints.getNumber();
  return response.number;
}

/**
 * Get account nonce
 */
export async function getAccountNonce(address: string): Promise<number> {
  const client = createTestClient();
  const response = await client.accounts.getNonce(address);
  return response.nonce;
}

/**
 * Get chain ID
 */
export async function getChainId(): Promise<number> {
  const client = createTestClient();
  const response = await client.chain.getChainId();
  return response.chain_id;
}

/**
 * Derive token address from owner and nonce
 */
export function deriveTokenAddress(owner: string, nonce: number): string {
  // This is a placeholder - you should import the actual deriveTokenAddress utility
  // For now, we'll just return a placeholder
  return `0x${owner.slice(2, 10)}${nonce.toString(16).padStart(32, '0')}`;
}

/**
 * Assert that a value is defined (throws if undefined/null)
 */
export function assertDefined<T>(value: T | undefined | null, message?: string): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(message || 'Value is undefined or null');
  }
}

/**
 * Format test section header
 */
export function logSection(title: string): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}\n`);
}

/**
 * Format test step log
 */
export function logStep(step: string, detail?: string): void {
  console.log(`\n→ ${step}`);
  if (detail) {
    console.log(`  ${detail}`);
  }
}

/**
 * Generate a random token symbol for testing
 */
export function generateRandomSymbol(prefix: string = 'TST'): string {
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}${randomSuffix}`;
}

/**
 * Normalize an address to checksum format for comparison
 */
export function normalizeAddress(address: string): string {
  try {
    return getAddress(address);
  } catch {
    // If getAddress fails, return lowercase for comparison
    return address.toLowerCase();
  }
}

/**
 * Check if two addresses are equal (case-insensitive)
 */
export function addressEquals(addr1: string, addr2: string): boolean {
  return normalizeAddress(addr1) === normalizeAddress(addr2);
}

/**
 * Check if an array of addresses includes a specific address (case-insensitive)
 */
export function addressArrayIncludes(addresses: string[], targetAddress: string): boolean {
  const normalizedTarget = normalizeAddress(targetAddress);
  return addresses.some(addr => normalizeAddress(addr) === normalizedTarget);
}
