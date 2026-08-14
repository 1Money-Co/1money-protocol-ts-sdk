// Frozen constants from
// l1client/docs/specs/native-v2-signing-spec.md
// sections 2.1-2.3. Never reorder, reuse, or
// reinterpret a value here: a change to what is
// signed is a new signing protocol with its own
// domain constant.

export const NATIVE_TX_DOMAIN_V2_TEXT =
  '1money.native.transaction.v2';

export const NATIVE_TX_DOMAIN_V2 =
  new TextEncoder().encode(
    NATIVE_TX_DOMAIN_V2_TEXT
  );

export const NativeOperationType = {
  Payment: 1,
  TokenIssue: 2,
  TokenMint: 3,
  TokenAuthority: 4,
  TokenBlacklist: 5,
  TokenWhitelist: 6,
  TokenPause: 7,
  TokenBurn: 8,
  TokenClawback: 9,
  TokenMetadata: 10,
  TokenBridgeAndMint: 11,
  TokenBurnAndBridge: 12,
  CreateMultiSig: 13,
  BatchPayment: 14
} as const;

export type NativeOperationType =
  (typeof NativeOperationType)[keyof typeof NativeOperationType];

export const AuthorizationKind = {
  SingleSecp256k1: 0,
  MultiSecp256k1: 1
} as const;

export type AuthorizationKind =
  (typeof AuthorizationKind)[keyof typeof AuthorizationKind];
