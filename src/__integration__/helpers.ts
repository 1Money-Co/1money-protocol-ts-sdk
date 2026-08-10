import {
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from '@/api/errors';

export function totalMintAllocation(
  allocations: readonly { amount: string }[]
): string {
  return allocations
    .reduce(
      (total, allocation) =>
        total + BigInt(allocation.amount),
      BigInt(0)
    )
    .toString();
}

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

export async function cleanupBlacklistedAddress(
  lookup: () => PromiseLike<unknown>,
  remove: () => PromiseLike<unknown>,
  address: string,
  options: {
    attempts: number;
    intervalMs: number;
  }
): Promise<'removed' | 'absent'> {
  for (
    let attempt = 0;
    attempt < options.attempts;
    attempt += 1
  ) {
    const metadata = await lookup();
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      !Array.isArray(
        (metadata as { black_list?: unknown })
          .black_list
      ) ||
      !(metadata as { black_list: unknown[] }).black_list.every(
        entry => typeof entry === 'string'
      )
    ) {
      throw new Error(
        '[1Money SDK integration]: blacklist cleanup lookup resolved with malformed token metadata'
      );
    }

    const blackList = (
      metadata as { black_list: string[] }
    ).black_list;
    if (
      blackList.some(
        entry =>
          entry.toLowerCase() ===
          address.toLowerCase()
      )
    ) {
      await remove();
      return 'removed';
    }
    if (attempt + 1 < options.attempts) {
      await wait(options.intervalMs);
    }
  }
  return 'absent';
}

export async function observeForWindow<T>(
  lookup: () => PromiseLike<T>,
  options: {
    attempts: number;
    intervalMs: number;
    isNotFound: (error: unknown) => boolean;
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
      if (!options.isNotFound(error)) {
        throw error;
      }
      lastError = error;
      if (attempt + 1 < options.attempts) {
        await wait(options.intervalMs);
      }
    }
  }
  return { state: 'not_found', error: lastError };
}

export function isConfirmedReadNotFound(
  error: unknown
): boolean {
  if (
    typeof error !== 'object' ||
    error === null
  ) {
    return false;
  }
  const candidate = error as {
    status?: unknown;
    data?: unknown;
  };
  if (
    typeof candidate.data !== 'object' ||
    candidate.data === null
  ) {
    return false;
  }
  return (
    candidate.status === 404 &&
    (candidate.data as { error_code?: unknown })
      .error_code ===
      'resource_transaction_not_found'
  );
}

function receiptSuccess(
  value: unknown,
  label: string
): boolean {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { success?: unknown }).success !==
      'boolean'
  ) {
    throw new Error(
      `[1Money SDK integration]: ${label} lookup resolved with a malformed receipt`
    );
  }
  return (value as { success: boolean }).success;
}

export function classifyFailedBatchObservation(
  observation:
    | { state: 'found'; value: unknown }
    | { state: 'not_found'; error: unknown },
  label: string
): 'not_found' | 'failure_receipt' {
  if (observation.state === 'not_found') {
    return 'not_found';
  }
  if (receiptSuccess(observation.value, label)) {
    throw new Error(
      `[1Money SDK integration]: the deliberately invalid Batch Payment unexpectedly succeeded in the ${label}`
    );
  }
  return 'failure_receipt';
}

export function requireSuccessfulReceipt(
  value: unknown,
  label: string
): void {
  if (!receiptSuccess(value, label)) {
    throw new Error(
      `[1Money SDK integration]: ${label} did not succeed`
    );
  }
}

export function classifyNextValidSubmissionError(
  error: unknown,
  nonce: number,
  localHash: string
): {
  nextValidTransaction: 'blocked';
  raw: Record<string, unknown>;
} {
  if (!(error instanceof TransactionSubmissionError)) {
    throw error;
  }
  return {
    nextValidTransaction: 'blocked',
    raw: {
      nonce,
      status: error.status,
      body: error.data,
      local_hash: localHash,
      message: error.message
    }
  };
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
