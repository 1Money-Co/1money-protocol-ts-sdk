import { validateMemo } from '@/utils';
import { assertLowS } from '../core';
import { singleSecp256k1 } from './authorization';
import {
  encodePayloadRlp,
  signingHashV2,
  singleDescriptor,
  singleProof,
  transactionHashV2
} from './encoding';
import {
  OPERATION_REGISTRY,
  type OperationName,
  type OperationUnsignedMap
} from './registry';
import { toRequiredMemo } from './wire';

import type {
  Memo,
  Signature,
  ZeroXString
} from '@/utils';

export interface PrepareOptionsV2 {
  memo?: Memo;
}

// A signed, canonical v2 transaction ready to submit. Plain data
// with no methods, so it survives JSON.stringify across a process
// boundary (sign here, submit there).
export interface AuthorizedTxV2 {
  operation: OperationName;
  path: string;
  request: Record<string, unknown>;
  transactionHash: ZeroXString;
}

export interface PreparedTxV2<TUnsigned> {
  operation: OperationName;
  unsigned: TUnsigned;
  // The 32-byte digest the signer must sign.
  signingHash: ZeroXString;
  authorize: (
    signature: Signature
  ) => AuthorizedTxV2;
}

export function prepareTransactionV2<
  K extends OperationName
>(
  operation: K,
  unsigned: OperationUnsignedMap[K],
  options?: PrepareOptionsV2
): PreparedTxV2<OperationUnsignedMap[K]> {
  const spec = OPERATION_REGISTRY[operation];
  if (!spec) {
    throw new Error(
      `[1Money SDK]: Unknown native v2 operation: ${String(operation)}`
    );
  }

  // The /v2 request body never carries memo inside the business
  // payload -- it is a sibling field supplied through `options.memo`
  // (see OperationUnsignedMap's WithoutMemo<T>). That is only a
  // compile-time guarantee for an inline object literal: a caller
  // migrating a v1-shaped payload *variable* (or any plain-JS caller)
  // can still pass an object carrying `memo`, which would otherwise be
  // silently overwritten below and submitted as the empty
  // three-string memo with no error. Reject it instead of guessing
  // which memo the caller meant.
  if (
    Object.prototype.hasOwnProperty.call(
      unsigned as object,
      'memo'
    )
  ) {
    throw new Error(
      `[1Money SDK]: ${operation} unsigned payload must not include a memo property -- pass it as the { memo } option instead.`
    );
  }

  spec.validate(unsigned);

  if (!spec.memoCapable && options?.memo) {
    throw new Error(
      `[1Money SDK]: ${operation} does not carry a memo`
    );
  }

  const memo = spec.memoCapable
    ? toRequiredMemo(options?.memo)
    : null;
  if (memo) {
    validateMemo(memo);
  }

  const payloadRlp = encodePayloadRlp({
    chainId: unsigned.chain_id,
    nonce: unsigned.nonce,
    payloadFields: spec.payloadFields(unsigned),
    memo
  });

  const descriptor = singleDescriptor();
  const signingHash = signingHashV2(
    spec.operationType,
    descriptor,
    payloadRlp
  );

  return {
    operation,
    unsigned,
    signingHash,
    authorize: (signature: Signature) => {
      // A non-normalized (high-S) signature confidently produces a
      // transactionHash the node will still reject at admission
      // (om-crypto-types CryptoError::HighSSignature) -- fail fast
      // locally with the same check the legacy path runs in
      // attachSignature, rather than handing the caller a hash for a
      // transaction that fails remotely. Deliberately placed here
      // (authorize()) and not inside singleProof/multisigProof: those
      // low-level encoders are exercised directly by the frozen
      // conformance vectors, whose fixture signatures are dummies
      // that are themselves high-S.
      assertLowS(signature);

      const body: Record<string, unknown> = {
        ...(spec.wireFields
          ? spec.wireFields(unsigned)
          : { ...unsigned })
      };
      if (memo) {
        body.memo = memo;
      }
      body.authorization =
        singleSecp256k1(signature);

      return {
        operation,
        path: spec.pathV2,
        request: body,
        transactionHash: transactionHashV2(
          spec.operationType,
          descriptor,
          payloadRlp,
          singleProof(signature)
        )
      };
    }
  };
}

export const TransactionBuilderV2 = {
  payment: (
    u: OperationUnsignedMap['payment'],
    o?: PrepareOptionsV2
  ) => prepareTransactionV2('payment', u, o),
  tokenIssue: (
    u: OperationUnsignedMap['tokenIssue'],
    o?: PrepareOptionsV2
  ) => prepareTransactionV2('tokenIssue', u, o),
  tokenMint: (
    u: OperationUnsignedMap['tokenMint'],
    o?: PrepareOptionsV2
  ) => prepareTransactionV2('tokenMint', u, o),
  tokenAuthority: (
    u: OperationUnsignedMap['tokenAuthority'],
    o?: PrepareOptionsV2
  ) =>
    prepareTransactionV2('tokenAuthority', u, o),
  tokenBlacklist: (
    u: OperationUnsignedMap['tokenBlacklist'],
    o?: PrepareOptionsV2
  ) =>
    prepareTransactionV2('tokenBlacklist', u, o),
  tokenWhitelist: (
    u: OperationUnsignedMap['tokenWhitelist'],
    o?: PrepareOptionsV2
  ) =>
    prepareTransactionV2('tokenWhitelist', u, o),
  tokenPause: (
    u: OperationUnsignedMap['tokenPause'],
    o?: PrepareOptionsV2
  ) => prepareTransactionV2('tokenPause', u, o),
  tokenBurn: (
    u: OperationUnsignedMap['tokenBurn'],
    o?: PrepareOptionsV2
  ) => prepareTransactionV2('tokenBurn', u, o),
  tokenClawback: (
    u: OperationUnsignedMap['tokenClawback'],
    o?: PrepareOptionsV2
  ) =>
    prepareTransactionV2('tokenClawback', u, o),
  tokenMetadata: (
    u: OperationUnsignedMap['tokenMetadata'],
    o?: PrepareOptionsV2
  ) =>
    prepareTransactionV2('tokenMetadata', u, o),
  tokenBridgeAndMint: (
    u: OperationUnsignedMap['tokenBridgeAndMint'],
    o?: PrepareOptionsV2
  ) =>
    prepareTransactionV2(
      'tokenBridgeAndMint',
      u,
      o
    ),
  tokenBurnAndBridge: (
    u: OperationUnsignedMap['tokenBurnAndBridge'],
    o?: PrepareOptionsV2
  ) =>
    prepareTransactionV2(
      'tokenBurnAndBridge',
      u,
      o
    ),
  createMultisig: (
    u: OperationUnsignedMap['createMultisig'],
    o?: PrepareOptionsV2
  ) =>
    prepareTransactionV2('createMultisig', u, o),
  batchPayment: (
    u: OperationUnsignedMap['batchPayment'],
    o?: PrepareOptionsV2
  ) => prepareTransactionV2('batchPayment', u, o)
};
