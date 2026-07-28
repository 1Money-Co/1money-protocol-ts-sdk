// Error codes specific to the /v2 domain-separated
// write surface.
export const V2_ERROR_CODES = {
  // 403 - the node has not activated /v2 yet
  // (NativeWriteMode V1Only).
  DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE:
    'DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE',
  // 410 - the node disabled the legacy /v1 write
  // surface (NativeWriteMode V2Only).
  LEGACY_NATIVE_WRITE_ENDPOINT_DISABLED:
    'LEGACY_NATIVE_WRITE_ENDPOINT_DISABLED',
  // 400 - authorization.type is not a recognized
  // tag.
  UNSUPPORTED_AUTHORIZATION_TYPE:
    'UNSUPPORTED_AUTHORIZATION_TYPE',
  // 400 - a legacy top-level signature was posted
  // to /v2.
  DOMAIN_SEPARATED_SIGNATURE_REQUIRED:
    'DOMAIN_SEPARATED_SIGNATURE_REQUIRED',
  // 410 - POST /v1/transactions/raw is retired.
  RAW_TRANSACTION_ENDPOINT_REMOVED:
    'RAW_TRANSACTION_ENDPOINT_REMOVED'
} as const;

export type V2ErrorCode =
  (typeof V2_ERROR_CODES)[keyof typeof V2_ERROR_CODES];

// The transaction WAS accepted by the node before
// this was thrown. `submitted` is load-bearing:
// treating this as "not sent" and retrying would
// submit a second transaction on the same nonce.
//
// A mismatch means the bytes the node admitted are
// not the bytes that were signed locally -- an SDK
// encoding defect or a request body mutated in
// transit -- not a dishonest node (the check runs
// after submission, and a dishonest node could echo
// the expected hash).
export class TransactionHashMismatchError extends
  Error {
  readonly submitted = true;
  readonly serverHash: string;
  readonly localHash: string;

  constructor(
    localHash: string,
    serverHash: string
  ) {
    super(
      `[1Money SDK]: Transaction hash mismatch - the transaction was submitted, but the node returned ${serverHash} while the SDK computed ${localHash}. Do not retry: a retry would submit a second transaction on the same nonce.`
    );
    this.name = 'TransactionHashMismatchError';
    this.localHash = localHash;
    this.serverHash = serverHash;
  }
}

function errorCodeOf(
  error: unknown
): string | undefined {
  if (
    typeof error !== 'object' ||
    error === null
  ) {
    return undefined;
  }
  const data = (
    error as { data?: { error_code?: unknown } }
  ).data;
  return typeof data?.error_code === 'string'
    ? data.error_code
    : undefined;
}

// True when the node has not activated the /v2
// write surface. Callers in a migration window can
// fall back to the explicit legacyV1 namespace --
// but only by re-preparing the transaction, never
// by resubmitting the same signed bytes.
export function isNativeV2NotActive(
  error: unknown
): boolean {
  return (
    errorCodeOf(error) ===
    V2_ERROR_CODES.DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE
  );
}

// True when the node has disabled the legacy /v1
// write surface.
export function isLegacyWriteDisabled(
  error: unknown
): boolean {
  return (
    errorCodeOf(error) ===
    V2_ERROR_CODES.LEGACY_NATIVE_WRITE_ENDPOINT_DISABLED
  );
}

// `serverHash` originates from a parsed HTTP
// response body -- the static `string` type on the
// caller's side does not guarantee the runtime shape.
// Anything that is not a pair of strings is treated
// as a mismatch (never a silent pass-through) so this
// stays fail-closed: the transaction was already
// admitted by the time this runs, and only
// TransactionHashMismatchError carries `submitted`
// to the caller.
export function assertTransactionHash(
  localHash: unknown,
  serverHash: unknown
): void {
  if (
    typeof localHash !== 'string' ||
    typeof serverHash !== 'string' ||
    localHash.toLowerCase() !==
      serverHash.toLowerCase()
  ) {
    throw new TransactionHashMismatchError(
      String(localHash),
      String(serverHash)
    );
  }
}
