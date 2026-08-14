/**
 * Integration test configuration
 *
 * Environment variables:
 * - INTEGRATION_TEST_NETWORK: Network to use (local, testnet, mainnet)
 * - INTEGRATION_TEST_OPERATOR_KEY: Operator private key
 * - INTEGRATION_TEST_MASTER_KEY: Master account private key
 * - RUN_INTEGRATION_TESTS: Set to 'true' to run integration tests
 * - INTEGRATION_TEST_TIMEOUT: Per-test timeout in ms (default 120000)
 * - INTEGRATION_TEST_VERBOSE: Set to 'true' to print the resolved target
 *   (network, base URL, timeout), the generated account addresses, and
 *   every HTTP exchange -- request line, request body, response status,
 *   elapsed time and response body, correlated by a per-request id. Off
 *   by default, so CI output is unchanged.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.integration file if it exists
const envPath = path.resolve(process.cwd(), '.env.integration');
dotenv.config({ path: envPath });

export interface IntegrationTestConfig {
  network: IntegrationTestNetwork;
  operatorKey: string;
  masterKey: string;
  enabled: boolean;
  timeout: number;
  verbose: boolean;
}

const NETWORKS = [
  'local',
  'testnet',
  'mainnet'
] as const;

export type IntegrationTestNetwork =
  (typeof NETWORKS)[number];

function parseNetwork(
  value: string | undefined
): IntegrationTestNetwork {
  const network = value ?? 'local';
  if (
    !NETWORKS.includes(
      network as IntegrationTestNetwork
    )
  ) {
    throw new Error(
      `[1Money SDK integration]: Invalid INTEGRATION_TEST_NETWORK: ${network}`
    );
  }
  return network as IntegrationTestNetwork;
}

/**
 * Get integration test configuration from environment variables
 */
export function getConfig(): IntegrationTestConfig {
  const network = parseNetwork(
    process.env.INTEGRATION_TEST_NETWORK
  );

  // Default keys for local testing (these should be replaced with real keys in CI/CD)
  const operatorKey = process.env.INTEGRATION_TEST_OPERATOR_KEY ||
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  const masterKey = process.env.INTEGRATION_TEST_MASTER_KEY ||
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

  const enabled = process.env.RUN_INTEGRATION_TESTS === 'true';

  // Longer timeout for integration tests
  const timeout = parseInt(process.env.INTEGRATION_TEST_TIMEOUT || '120000', 10);

  const verbose = process.env.INTEGRATION_TEST_VERBOSE === 'true';

  return {
    network,
    operatorKey,
    masterKey,
    enabled,
    timeout,
    verbose
  };
}

/**
 * Check if integration tests should run
 */
export function shouldRunIntegrationTests(): boolean {
  return getConfig().enabled;
}
