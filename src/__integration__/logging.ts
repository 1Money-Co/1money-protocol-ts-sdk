/**
 * Opt-in observability for the integration suite.
 *
 * Everything here is gated on `INTEGRATION_TEST_VERBOSE=true`
 * (see `config.ts`). With the switch off nothing is printed and no
 * interceptor is installed, so default and CI output is byte-for-byte
 * what it was before.
 */

import { axiosStatic } from '@/client';

import type { IntegrationTestConfig } from './config';
// Type-only, so this does not create a runtime import cycle with setup.ts,
// which imports logGeneratedAccounts from here.
import type { TestAccounts } from './setup';

const PREFIX = '[1Money SDK integration]';

// The target banner describes the run, not an object. `context.test.ts`
// resets and rebuilds the context several times to exercise config
// parsing, and reprinting for each of those throwaway contexts would put
// two banners on screen that no real test ever used.
let targetLogged = false;

// An axios instance is process-wide and interceptors stack, so guard
// against a second install across those same resets.
let httpLoggingAttached = false;

function line(message: string): void {
  console.log(`${PREFIX} ${message}`);
}

/**
 * Print the target the suite actually resolved, once per process.
 *
 * The base URL is read back from the axios defaults the SDK just
 * configured rather than re-derived from the network name here. A local
 * copy of that mapping could drift from `api()` and would then report a
 * URL the tests are not using -- the exact thing this is meant to answer.
 */
export function logIntegrationTarget(
  config: IntegrationTestConfig
): void {
  if (!config.verbose || targetLogged) {
    return;
  }
  targetLogged = true;

  const baseURL =
    axiosStatic.defaults.baseURL ?? '(unset)';

  line('=== Integration target ===');
  line(`network:  ${config.network}`);
  line(`base URL: ${baseURL}`);
  line(`timeout:  ${config.timeout}ms`);
  line('==========================');
}

/**
 * Print the account addresses at the moment they are generated.
 *
 * Deliberately not folded into the banner above: user keys are random
 * and are regenerated whenever `resetTestAccounts()` runs, so a set
 * captured at banner time would not be the set the lifecycle later
 * signs with. Printing at generation keeps every line true.
 */
export function logGeneratedAccounts(
  config: IntegrationTestConfig,
  accounts: TestAccounts
): void {
  if (!config.verbose) {
    return;
  }

  line('--- accounts generated ---');
  for (const [name, account] of Object.entries(
    accounts
  )) {
    line(`${name.padEnd(13)}${account.address}`);
  }
}

// A safety valve, not a display budget: every body this API returns is
// far below it, so nothing is truncated in practice. It exists so one
// pathological response cannot bury the run in a single line.
const BODY_MAX_CHARS = 4000;

// Correlates a response back to its request. Requests overlap whenever
// the suite uses Promise.all, so without an id the interleaved lines
// cannot be paired up.
interface TracedConfig {
  __integrationTraceId?: number;
  __integrationStartedAt?: number;
}

let nextTraceId = 0;

function formatBody(value: unknown): string {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return '';
  }
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (text.length <= BODY_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, BODY_MAX_CHARS)}... (${text.length} chars total)`;
}

function traceOf(config: unknown): {
  id: string;
  elapsed: string;
} {
  const traced = config as TracedConfig | undefined;
  const id = traced?.__integrationTraceId;
  const startedAt = traced?.__integrationStartedAt;
  return {
    id: id === undefined ? '#?' : `#${id}`,
    elapsed:
      startedAt === undefined
        ? ''
        : ` ${Date.now() - startedAt}ms`
  };
}

/**
 * Log every request and its response, so a run can be followed against a
 * live node. Polling helpers retry the same URL, and those repeats are
 * deliberately not collapsed -- seeing them is how a slow or stuck read
 * becomes visible.
 */
export function attachHttpLogging(
  config: IntegrationTestConfig
): void {
  if (!config.verbose || httpLoggingAttached) {
    return;
  }
  httpLoggingAttached = true;

  axiosStatic.interceptors.request.use(request => {
    const traced =
      request as typeof request & TracedConfig;
    const id = (nextTraceId += 1);
    traced.__integrationTraceId = id;
    traced.__integrationStartedAt = Date.now();

    const method = (
      request.method ?? 'get'
    ).toUpperCase();
    const base =
      request.baseURL ??
      axiosStatic.defaults.baseURL ??
      '';
    line(
      `-> #${id} ${method} ${base}${request.url ?? ''}`
    );
    // Interceptors run before transformRequest, so this is the payload as
    // the caller built it rather than the serialized wire bytes.
    const body = formatBody(request.data);
    if (body) {
      line(`   #${id} request  ${body}`);
    }
    return request;
  });

  axiosStatic.interceptors.response.use(
    response => {
      const { id, elapsed } = traceOf(
        response.config
      );
      line(
        `<- ${id} ${response.status}${elapsed}`
      );
      const body = formatBody(response.data);
      if (body) {
        line(`   ${id} response ${body}`);
      }
      return response;
    },
    (error: unknown) => {
      const failure = error as {
        config?: unknown;
        response?: {
          status?: number;
          data?: unknown;
        };
        message?: string;
      };
      const { id, elapsed } = traceOf(
        failure?.config
      );
      const status =
        failure?.response?.status ?? 'no response';
      line(`<- ${id} ${status}${elapsed}`);
      const body = formatBody(
        failure?.response?.data ?? failure?.message
      );
      if (body) {
        line(`   ${id} response ${body}`);
      }
      // Pass the rejection through untouched: this is an observer, and
      // swallowing it here would change what the tests see.
      return Promise.reject(error);
    }
  );
}

/** Test seam: drop the once-only guards. */
export function resetIntegrationLogging(): void {
  targetLogged = false;
  httpLoggingAttached = false;
}
