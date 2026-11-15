import { refuseLaneClawbackOfVerify } from '@/signing/builders/laneClawback';
import {
  authorityEnvelope,
  readEnvelopeMode
} from './envelopeMode';
import {
  isListOperation,
  settledPayloadOf
} from './legacyMap';
import {
  latestReferenceCheckpoint,
  readAccountNonce,
  readTokenIsPrivate
} from './reads';
import { isAuthorityRefusal } from './refusals';
import {
  retryOnceOnReferenceNotReady,
  settledAfterRetirement,
  sign,
  signedRecorder,
  submit
} from './sendCore';

import type {
  LaneClawbackPayload,
  SettledAuthorityPayload
} from '../tokens/types';
import type { AuthorityEnvelope } from './envelopeMode';
import type { LegacyAuthorityOperation } from './legacyMap';
import type { OnSigned } from './sendCore';
import type { SignerAdapter } from '@/signing/core';
import type {
  AuthorizedTxV2,
  OperationName
} from '@/signing/v2';
import type { Memo } from '@/utils';

export type { OnSigned, SignedContext } from './sendCore';

export interface AuthoritySendOptions {
  memo?: Memo;
  /** The wait before the one retry of a reference not ready yet. */
  referenceRetryDelayMs?: number;
  /**
   * Called with each signed envelope before it is sent: the first,
   * and each one that replaces it after a refusal with no effect.
   */
  onSigned?: OnSigned;
}

/** An authority operation that was sent once. */
export interface AuthorityOperationSubmission {
  /** The envelope that was sent: after a retired legacy refusal, `settled`. */
  envelope: AuthorityEnvelope;
  authorized: AuthorizedTxV2;
  transactionHash: string;
}

const LEGACY_OPERATIONS: Record<
  LegacyAuthorityOperation['kind'],
  OperationName
> = {
  mint: 'tokenMint',
  authority: 'tokenAuthority',
  blacklist: 'tokenBlacklist',
  whitelist: 'tokenWhitelist',
  pause: 'tokenPause',
  metadata: 'tokenMetadata'
};

/**
 * A settled authority payload with the latest committed checkpoint
 * as its reference, unless the input names one.
 */
export async function buildSettledAuthority(
  input: Omit<SettledAuthorityPayload, 'reference_checkpoint'> & {
    reference_checkpoint?: number;
  }
): Promise<SettledAuthorityPayload> {
  return {
    ...input,
    reference_checkpoint:
      input.reference_checkpoint ??
      (await latestReferenceCheckpoint())
  };
}

/** Sign a settled authority envelope. No network call. */
export function signSettledAuthority(
  payload: SettledAuthorityPayload,
  signer: SignerAdapter,
  memo?: Memo
): Promise<AuthorizedTxV2> {
  return sign('settledAuthority', payload, signer, memo);
}

/**
 * The new envelope of a legacy authority operation, at its chain and
 * nonce, with the latest committed checkpoint as its reference. A
 * list operation reads the token's privacy, which decides its list.
 */
export async function settledPayload(
  legacy: LegacyAuthorityOperation
): Promise<SettledAuthorityPayload> {
  const [tokenIsPrivate, reference] = await Promise.all([
    isListOperation(legacy)
      ? readTokenIsPrivate(legacy.payload.token)
      : Promise.resolve(false),
    latestReferenceCheckpoint()
  ]);
  return settledPayloadOf(legacy, tokenIsPrivate, reference);
}

function sendSettled(
  legacy: LegacyAuthorityOperation,
  signer: SignerAdapter,
  options: AuthoritySendOptions,
  record: (authorized: AuthorizedTxV2) => Promise<void>
): Promise<AuthorizedTxV2> {
  return retryOnceOnReferenceNotReady(async () => {
    const authorized = await signSettledAuthority(
      await settledPayload(legacy),
      signer,
      options.memo
    );
    await record(authorized);
    return submit(authorized);
  }, options.referenceRetryDelayMs);
}

/**
 * Send an authority operation once in `envelope`: the legacy payload
 * as given, or the new envelope at the same chain and nonce. On a
 * retired legacy envelope (no nonce or lock was taken) the legacy
 * form is never sent again: once the node reports `settled`, the
 * operation is signed again as the new envelope at the same nonce.
 * A settled envelope whose reference was not ready is signed once
 * more with a new reference.
 *
 * Each signature reaches `options.onSigned` before its send. After
 * an error, read authorityOperationState of the last envelope it
 * received; never call again for the same intent.
 *
 * Throws as submitAuthorized; after a retired refusal, the refusal,
 * UpgradeGapError or UnrecognizedEnvelopeModeError.
 */
export async function sendAuthorityOperation(
  envelope: AuthorityEnvelope,
  legacy: LegacyAuthorityOperation,
  signer: SignerAdapter,
  options: AuthoritySendOptions = {}
): Promise<AuthorityOperationSubmission> {
  const record = signedRecorder(options.onSigned);
  const settled = async () => {
    const authorized = await sendSettled(
      legacy,
      signer,
      options,
      record
    );
    return {
      envelope: 'settled' as const,
      authorized,
      transactionHash: authorized.transactionHash
    };
  };
  if (envelope === 'settled') return settled();
  const authorized = await sign(
    LEGACY_OPERATIONS[legacy.kind],
    legacy.payload as never,
    signer,
    options.memo
  );
  await record(authorized);
  try {
    await submit(authorized);
  } catch (error) {
    if (!isAuthorityRefusal(error, 'legacy_envelope_retired')) {
      throw error;
    }
    await settledAfterRetirement(error);
    return settled();
  }
  return {
    envelope: 'legacy',
    authorized,
    transactionHash: authorized.transactionHash
  };
}

/**
 * Read the node's envelope mode and send the operation in its
 * envelope. Throws UpgradeGapError or UnrecognizedEnvelopeModeError
 * before anything is sent; else as sendAuthorityOperation.
 */
export async function authorityOperationByMode(
  legacy: LegacyAuthorityOperation,
  signer: SignerAdapter,
  options: AuthoritySendOptions = {}
): Promise<AuthorityOperationSubmission> {
  const envelope = authorityEnvelope(await readEnvelopeMode());
  return sendAuthorityOperation(envelope, legacy, signer, options);
}

/** What a lane clawback claws back; the SDK reads the rest. */
export type LaneClawbackIntent = Omit<
  LaneClawbackPayload,
  'from_nonce' | 'reference_checkpoint'
>;

/**
 * A lane clawback at the holder's next nonce, with the latest
 * committed checkpoint as its reference. Throws for VERIFY, and for
 * a holder with no lane yet (next nonce 0), which admission refuses.
 */
export async function buildLaneClawback(
  intent: LaneClawbackIntent
): Promise<LaneClawbackPayload> {
  refuseLaneClawbackOfVerify(intent.token);
  const [fromNonce, reference] = await Promise.all([
    readAccountNonce(intent.holder),
    latestReferenceCheckpoint()
  ]);
  if (fromNonce === 0) {
    throw new Error(
      '[1Money SDK]: The holder has no lane yet (its next nonce is 0), so a lane clawback cannot claw it back; a Reserved Payment hold needs the hold clawback'
    );
  }
  return {
    ...intent,
    from_nonce: fromNonce,
    reference_checkpoint: reference
  };
}

/**
 * Sign a lane clawback. No network call. Store the result before
 * you send it: a crash between the send and the store would lose
 * the only record of a clawback that can execute. A resend of the
 * same signed bytes can never execute twice.
 */
export function signLaneClawback(
  payload: LaneClawbackPayload,
  signer: SignerAdapter,
  memo?: Memo
): Promise<AuthorizedTxV2> {
  return sign('laneClawback', payload, signer, memo);
}

export interface IssueLaneClawbackOptions {
  memo?: Memo;
  /** The wait before the one retry of a reference not ready yet. */
  referenceRetryDelayMs?: number;
  /**
   * Called with each signed clawback before it is sent: the first,
   * and the one that replaces it after a refusal with no effect.
   */
  onSigned?: OnSigned;
}

/**
 * Build, sign and send one lane clawback. A node that refuses the
 * reference as not committed or as not holding the token gets one
 * more clawback, built again after a short wait; the refused one had
 * no effect, and onSigned names it in `replaces`. After any other
 * error, read laneClawbackFate of the last clawback onSigned
 * received; never sign a new clawback because a send failed.
 */
export function issueLaneClawback(
  intent: LaneClawbackIntent,
  signer: SignerAdapter,
  options: IssueLaneClawbackOptions = {}
): Promise<AuthorizedTxV2> {
  const record = signedRecorder(options.onSigned);
  return retryOnceOnReferenceNotReady(async () => {
    const authorized = await signLaneClawback(
      await buildLaneClawback(intent),
      signer,
      options.memo
    );
    await record(authorized);
    return submit(authorized);
  }, options.referenceRetryDelayMs);
}
