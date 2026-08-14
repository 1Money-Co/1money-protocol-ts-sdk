import api from '@/api';

import { getConfig } from './config';
import {
  attachHttpLogging,
  logIntegrationTarget
} from './logging';
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

  const client = api({
    network: config.network,
    timeout: config.timeout
  });

  // api() has already written the resolved base URL into the shared axios
  // defaults, so the banner below reports the URL actually in use.
  logIntegrationTarget(config);
  attachHttpLogging(config);

  context = {
    config,
    client,
    accounts: getTestAccounts()
  };
  return context;
}

export function resetIntegrationContext(): void {
  context = null;
}
