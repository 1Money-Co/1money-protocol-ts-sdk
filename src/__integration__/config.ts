/**
 * Integration test configuration
 *
 * Environment variables:
 * - INTEGRATION_TEST_NETWORK: Network to use (local, testnet, mainnet)
 * - INTEGRATION_TEST_OPERATOR_KEY: Operator private key
 * - INTEGRATION_TEST_MASTER_KEY: Master account private key
 * - RUN_INTEGRATION_TESTS: Set to 'true' to run integration tests
 */

export interface IntegrationTestConfig {
  network: 'local' | 'testnet' | 'mainnet';
  operatorKey: string;
  masterKey: string;
  enabled: boolean;
  timeout: number;
}

/**
 * Get integration test configuration from environment variables
 */
export function getConfig(): IntegrationTestConfig {
  const network = (process.env.INTEGRATION_TEST_NETWORK || 'local') as 'local' | 'testnet' | 'mainnet';

  // Default keys for local testing (these should be replaced with real keys in CI/CD)
  const operatorKey = process.env.INTEGRATION_TEST_OPERATOR_KEY ||
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  const masterKey = process.env.INTEGRATION_TEST_MASTER_KEY ||
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

  const enabled = process.env.RUN_INTEGRATION_TESTS === 'true';

  // Longer timeout for integration tests
  const timeout = parseInt(process.env.INTEGRATION_TEST_TIMEOUT || '120000', 10);

  return {
    network,
    operatorKey,
    masterKey,
    enabled,
    timeout
  };
}

/**
 * Check if integration tests should run
 */
export function shouldRunIntegrationTests(): boolean {
  return getConfig().enabled;
}
