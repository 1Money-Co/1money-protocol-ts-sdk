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

export function generateRandomSymbol(
  prefix: string = 'TST'
): string {
  const randomSuffix = Math.random()
    .toString(36)
    .substring(2, 6)
    .toUpperCase();
  return `${prefix}${randomSuffix}`;
}
