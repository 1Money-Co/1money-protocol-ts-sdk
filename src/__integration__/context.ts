import api from '@/api';

import { getConfig } from './config';
import {
  getTestAccounts,
  type TestAccounts
} from './setup';

export interface IntegrationContext {
  config: ReturnType<typeof getConfig>;
  client: ReturnType<typeof api>;
  accounts: TestAccounts;
}

let context: IntegrationContext | null = null;

export function getIntegrationContext():
  IntegrationContext {
  if (context) {
    return context;
  }

  const config = getConfig();
  if (
    config.enabled &&
    config.network === 'mainnet'
  ) {
    throw new Error(
      '[1Money SDK integration]: refuses to run state-changing integration tests on mainnet'
    );
  }

  context = {
    config,
    client: api({
      network: config.network,
      timeout: config.timeout
    }),
    accounts: getTestAccounts()
  };
  return context;
}

export function resetIntegrationContext(): void {
  context = null;
}
