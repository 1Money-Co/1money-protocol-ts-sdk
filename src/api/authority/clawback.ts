import { prepareTransactionV2 } from '@/signing/v2';
import { submitAuthorized } from '../submit';
import {
  authorityEnvelope,
  clawbackStaysLegacy,
  readEnvelopeMode
} from './envelopeMode';
import { readAccountNonce } from './reads';
import { isAuthorityRefusal } from './refusals';
import {
  buildLaneClawback,
  issueLaneClawback,
  signLaneClawback
} from './send';
import { laneClawbackFate } from './state';

import type { Hash } from '../types';
import type {
  AuthorityEnvelope,
  ClawbackSource
} from './envelopeMode';
import type { LaneClawbackFate } from './state';
import type { SignerAdapter } from '@/signing/core';
import type {
  AuthorizedTxV2,
  OperationUnsignedMap
} from '@/signing/v2';
import type { Memo } from '@/utils';

/** A clawback that was sent once. */
export type ClawbackSubmission =
  /** The legacy clawback, at the signer's own nonce. */
  | { kind: 'legacy'; authorized: AuthorizedTxV2 }
  /**
   * The lane clawback, at the holder's next nonce; the signer's
   * nonce does not change. Read it with laneClawbackFate.
   */
  | { kind: 'lane'; authorized: AuthorizedTxV2 };

/**
 * The signer's nonce has passed the nonce of the clawback intent, so
 * no lane clawback was signed: a legacy send of the same clawback may
 * have executed, and a lane clawback would debit the holder again.
 * Read the legacy clawback's outcome by its hash first.
 */
export class ClawbackIntentNonceUsedError extends Error {
  public readonly submitted = false;
  public readonly signer: string;
  public readonly nonce: number;
  public readonly nextNonce: number;

  public constructor(
    signer: string,
    nonce: number,
    nextNonce: number
  ) {
    super(
      `[1Money SDK]: The signer ${signer}'s next nonce is ${nextNonce}, past the clawback's nonce ${nonce}, so no lane clawback was signed. Read the legacy clawback's outcome by its hash before you claw back again.`
    );
    this.name = 'ClawbackIntentNonceUsedError';
    this.signer = signer;
    this.nonce = nonce;
    this.nextNonce = nextNonce;
  }
}

export interface SendClawbackParams {
  /** The legacy clawback; `nonce` names it on its signer's lane. */
  clawback: OperationUnsignedMap['tokenClawback'];
  source: ClawbackSource;
  signer: SignerAdapter;
  /** The address of `signer`, whose nonce guards the intent. */
  signerAddress: string;
  memo?: Memo;
  /** Called with a signed lane clawback before it is sent. Store it here. */
  onSigned?: (authorized: AuthorizedTxV2) => Promise<void> | void;
}

async function sendLegacyClawback(
  params: SendClawbackParams
): Promise<ClawbackSubmission> {
  const prepared = prepareTransactionV2(
    'tokenClawback',
    params.clawback,
    { memo: params.memo }
  );
  const authorized = prepared.authorize(
    await params.signer.signDigest(prepared.signingHash)
  );
  await submitAuthorized<Hash>(authorized, 'tokenClawback');
  return { kind: 'legacy', authorized };
}

// The lane clawback of an intent is signed only while the signer's
// nonce has not passed the intent's nonce: a node refuses a resend
// of an executed legacy clawback as retired before it reads the
// nonce, and the lane clawback takes a holder slot, so the signer's
// nonce would no longer stop a second debit.
async function laneClawbackOfIntent(
  params: SendClawbackParams
): Promise<ClawbackSubmission> {
  const { clawback } = params;
  const nextNonce = await readAccountNonce(params.signerAddress);
  if (nextNonce > clawback.nonce) {
    throw new ClawbackIntentNonceUsedError(
      params.signerAddress,
      clawback.nonce,
      nextNonce
    );
  }
  const authorized = await issueLaneClawback(
    {
      chain_id: clawback.chain_id,
      token: clawback.token,
      holder: clawback.from,
      recipient: clawback.recipient,
      value: clawback.value
    },
    params.signer,
    { memo: params.memo, onSigned: params.onSigned }
  );
  return { kind: 'lane', authorized };
}

/**
 * Claw back in `envelope`: the legacy clawback at `clawback.nonce`,
 * or the lane clawback at the holder's next nonce. A clawback that
 * clawbackStaysLegacy names is the legacy clawback whatever
 * `envelope` says, and its retired refusal is returned as is.
 *
 * On a retired legacy clawback of an ordinary account (no nonce or
 * lock taken), once the node reports `settled`, the clawback is
 * issued as the lane clawback.
 *
 * Throws as the single send; ClawbackIntentNonceUsedError before
 * anything is signed; after a retired refusal, the refusal,
 * UpgradeGapError or UnrecognizedEnvelopeModeError.
 */
export async function sendClawback(
  envelope: AuthorityEnvelope,
  params: SendClawbackParams
): Promise<ClawbackSubmission> {
  const staysLegacy = clawbackStaysLegacy(
    params.clawback.token,
    params.source
  );
  if (envelope === 'settled' && !staysLegacy) {
    return laneClawbackOfIntent(params);
  }
  try {
    return await sendLegacyClawback(params);
  } catch (error) {
    if (
      staysLegacy ||
      !isAuthorityRefusal(error, 'legacy_envelope_retired')
    ) {
      throw error;
    }
    if (
      authorityEnvelope(await readEnvelopeMode()) === 'legacy'
    ) {
      throw error;
    }
    return laneClawbackOfIntent(params);
  }
}

/**
 * Claw back in the envelope of the node's mode. A clawback that
 * clawbackStaysLegacy names reads no mode. Throws UpgradeGapError
 * or UnrecognizedEnvelopeModeError before anything is sent; else as
 * sendClawback.
 */
export async function clawbackByMode(
  params: SendClawbackParams
): Promise<ClawbackSubmission> {
  const envelope = clawbackStaysLegacy(
    params.clawback.token,
    params.source
  )
    ? 'legacy'
    : authorityEnvelope(await readEnvelopeMode());
  return sendClawback(envelope, params);
}

export type LaneClawbackReissue =
  /**
   * The replacement, signed at the holder's next nonce with a new
   * reference checkpoint, and not sent. Store it, then send it with
   * tokens.laneClawback; from then on read the replacement's fate.
   */
  | { kind: 'prepared'; authorized: AuthorizedTxV2 }
  /**
   * Nothing was signed: the reads show the clawback executed,
   * counter-signed, its slot not passed, or a node that knows its
   * hash.
   */
  | { kind: 'refused'; fate: LaneClawbackFate };

/**
 * The issuer's statement that, on a node with the full history (not
 * bootstrapped from a snapshot taken after the dead clawback's
 * reference checkpoint, and keeping receipts that far back), the
 * dead clawback's hash has no receipt and no status by hash.
 */
export interface FullHistoryCheck {
  fullHistoryChecked: true;
}

function laneRequestOf(dead: AuthorizedTxV2) {
  const request = dead.request as {
    chain_id: number;
    token: string;
    holder: string;
    from_nonce: number;
    recipient: string;
    value: string;
    memo: Memo;
  };
  return request;
}

/**
 * Sign the replacement of a lane clawback that did not execute, on
 * the holder's next slot with a new reference checkpoint, and do not
 * send it. This is an explicit issuer action:
 *
 * - The SDK cannot tell a clawback whose slot another transaction
 *   took from one that executed, on a node without its history.
 *   Call this only after the full-history check that `check` states.
 * - Store the replacement before you send it.
 * - Never prepare twice for the same dead clawback: each call reads
 *   the checkpoint and the holder's nonce again, so two calls can
 *   sign two replacements, and both can execute.
 * - Never send `dead` again.
 *
 * Throws AuthorityReadError when a read does not answer, and as
 * buildLaneClawback.
 */
export async function prepareLaneClawbackReissue(
  dead: AuthorizedTxV2,
  signer: SignerAdapter,
  check: FullHistoryCheck
): Promise<LaneClawbackReissue> {
  if (check?.fullHistoryChecked !== true) {
    throw new Error(
      '[1Money SDK]: prepareLaneClawbackReissue needs { fullHistoryChecked: true } after a check on a node with the full history'
    );
  }
  const fate = await laneClawbackFate(dead);
  if (fate.fate !== 'unknown' || fate.observed.status !== undefined) {
    return { kind: 'refused', fate };
  }
  const request = laneRequestOf(dead);
  const payload = await buildLaneClawback({
    chain_id: request.chain_id,
    token: request.token,
    holder: request.holder,
    recipient: request.recipient,
    value: request.value
  });
  // A node that is behind can serve a nonce that is not past the
  // dead slot.
  if (payload.from_nonce <= request.from_nonce) {
    return { kind: 'refused', fate: { fate: 'pending' } };
  }
  return {
    kind: 'prepared',
    authorized: await signLaneClawback(
      payload,
      signer,
      request.memo
    )
  };
}
