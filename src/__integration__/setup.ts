/**
 * Integration test setup and account generation
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import { getConfig } from './config';

export interface TestAccount extends PrivateKeyAccount {
  privateKey: `0x${string}`;
}

export interface TestAccounts {
  operator: TestAccount;
  master: TestAccount;
  user1: TestAccount;
  user2: TestAccount;
  user3: TestAccount;
}

let testAccounts: TestAccounts | null = null;

/**
 * Generate and cache test accounts
 */
export function getTestAccounts(): TestAccounts {
  if (testAccounts) {
    return testAccounts;
  }

  const config = getConfig();

  // Generate private keys
  const user1Key = generatePrivateKey();
  const user2Key = generatePrivateKey();
  const user3Key = generatePrivateKey();

  testAccounts = {
    operator: Object.assign(privateKeyToAccount(config.operatorKey as `0x${string}`), {
      privateKey: config.operatorKey as `0x${string}`
    }),
    master: Object.assign(privateKeyToAccount(config.masterKey as `0x${string}`), {
      privateKey: config.masterKey as `0x${string}`
    }),
    user1: Object.assign(privateKeyToAccount(user1Key), { privateKey: user1Key }),
    user2: Object.assign(privateKeyToAccount(user2Key), { privateKey: user2Key }),
    user3: Object.assign(privateKeyToAccount(user3Key), { privateKey: user3Key })
  };

  return testAccounts;
}

/**
 * Log test account information
 */
export function logTestAccounts(): void {
  const accounts = getTestAccounts();

  console.log('\n=== Integration Test Accounts ===');
  console.log('Operator:', accounts.operator.address);
  console.log('Master:', accounts.master.address);
  console.log('User1:', accounts.user1.address);
  console.log('User2:', accounts.user2.address);
  console.log('User3:', accounts.user3.address);
  console.log('=================================\n');
}

/**
 * Reset test accounts (for cleanup)
 */
export function resetTestAccounts(): void {
  testAccounts = null;
}
