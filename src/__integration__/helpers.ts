import {
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from '@/api/errors';

export function wait(
  ms: number
): Promise<void> {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

export async function waitForResult<T>(
  lookup: () => PromiseLike<T>,
  options: {
    attempts?: number;
    intervalMs?: number;
  } = {}
): Promise<T> {
  const attempts = options.attempts ?? 30;
  const intervalMs =
    options.intervalMs ?? 1000;
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt < attempts;
    attempt += 1
  ) {
    try {
      return await lookup();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await wait(intervalMs);
      }
    }
  }

  const failure = new Error(
    `[1Money SDK integration]: result did not become available after ${attempts} attempts`
  ) as Error & { cause?: unknown };
  failure.cause = lastError;
  throw failure;
}

export async function observeForWindow<T>(
  lookup: () => PromiseLike<T>,
  options: {
    attempts: number;
    intervalMs: number;
  }
): Promise<
  | { state: 'found'; value: T }
  | { state: 'not_found'; error: unknown }
> {
  let lastError: unknown;
  for (
    let attempt = 0;
    attempt < options.attempts;
    attempt += 1
  ) {
    try {
      return { state: 'found', value: await lookup() };
    } catch (error) {
      lastError = error;
      if (attempt + 1 < options.attempts) {
        await wait(options.intervalMs);
      }
    }
  }
  return { state: 'not_found', error: lastError };
}

export function classifyBatchFailureSubmission(
  error: unknown,
  localHash: string
): {
  submission: 'refused' | 'outcome_unknown';
  raw: Record<string, unknown>;
} {
  if (error instanceof TransactionSubmissionError) {
    return {
      submission: 'refused',
      raw: {
        status: error.status,
        body: error.data,
        local_hash: localHash,
        message: error.message
      }
    };
  }
  if (error instanceof TransactionOutcomeUnknownError) {
    return {
      submission: 'outcome_unknown',
      raw: {
        status: error.status,
        body: error.data,
        hash: error.transactionHash,
        local_hash: localHash,
        message: error.message
      }
    };
  }
  throw error;
}

export function generateRandomSymbol(
  prefix: string = 'TST'
): string {
  const randomSuffix = Math.random()
    .toString(36)
    .substring(2, 6)
    .toUpperCase();
  return `${prefix}${randomSuffix}`;
}
