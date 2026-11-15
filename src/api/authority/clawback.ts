import { recoverAddress } from 'viem';

import { validateLaneClawback } from '@/signing/builders/laneClawback';
import { prepareTransactionV2 } from '@/signing/v2';
import {
  authorityEnvelope,
  clawbackStaysLegacy,
  readEnvelopeMode
} from './envelopeMode';
import { readAccountNonce } from './reads';
import { isAuthorityRefusal } from './refusals';
import { buildLaneClawback, signLaneClawback } from './send';
import {
  settledAfterRetirement,
  submit
} from './sendCore';
import { laneClawbackFate } from './state';

import type { LaneClawbackPayload } from '../tokens/types';
import type { AuthorityEnvelope, ClawbackSource } from './envelopeMode';
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
  /**
   * The legacy clawback. `nonce` names it on its signer's lane: the
   * signer's next nonce for a new clawback.
   */
  clawback: OperationUnsignedMap['tokenClawback'];
  source: ClawbackSource;
  signer: SignerAdapter;
  memo?: Memo;
  /**
   * Called with the signed clawback, legacy or lane, before it is
   * sent. Store it: after any error, read its outcome from the
   * stored transaction, never by calling the router again.
   */
  onSigned: (authorized: AuthorizedTxV2) => Promise<void> | void;
}

async function signLegacyClawback(
  params: SendClawbackParams
): Promise<{ authorized: AuthorizedTxV2; signerAddress: string }> {
  const prepared = prepareTransactionV2(
    'tokenClawback',
    params.clawback,
    { memo: params.memo }
  );
  const signature = await params.signer.signDigest(
    prepared.signingHash
  );
  // authorize() refuses any v but 0 or 1 before the recovery reads it.
  const authorized = prepared.authorize(signature);
  // The signer's address comes from its own signature, so the nonce
  // check reads the account that actually signs.
  const signerAddress = await recoverAddress({
    hash: prepared.signingHash,
    signature: {
      r: signature.r,
      s: signature.s,
      yParity: Number(signature.v)
    }
  });
  return { authorized, signerAddress };
}

// A lane clawback of the intent is signed only while the signer's
// nonce has not passed the intent's nonce: a node refuses a resend
// of an executed legacy clawback as retired before it reads the
// nonce, and the lane clawback takes a holder slot, so the signer's
// nonce would no longer stop a second debit. The check cannot see a
// lane clawback already issued for the intent, or a legacy one still
// in flight: that is why the router runs once per intent.
async function laneClawbackOfIntent(
  params: SendClawbackParams,
  signerAddress: string
): Promise<ClawbackSubmission> {
  const { clawback } = params;
  const [nextNonce, payload] = await Promise.all([
    readAccountNonce(signerAddress),
    buildLaneClawback({
      chain_id: clawback.chain_id,
      token: clawback.token,
      holder: clawback.from,
      recipient: clawback.recipient,
      value: clawback.value
    })
  ]);
  if (nextNonce > clawback.nonce) {
    throw new ClawbackIntentNonceUsedError(
      signerAddress,
      clawback.nonce,
      nextNonce
    );
  }
  const authorized = await signLaneClawback(
    payload,
    params.signer,
    params.memo
  );
  await params.onSigned(authorized);
  return { kind: 'lane', authorized: await submit(authorized) };
}

async function route(
  envelope: AuthorityEnvelope,
  staysLegacy: boolean,
  params: SendClawbackParams
): Promise<ClawbackSubmission> {
  const legacy = await signLegacyClawback(params);
  if (envelope === 'settled' && !staysLegacy) {
    return laneClawbackOfIntent(params, legacy.signerAddress);
  }
  await params.onSigned(legacy.authorized);
  try {
    await submit(legacy.authorized);
  } catch (error) {
    if (
      staysLegacy ||
      !isAuthorityRefusal(error, 'legacy_envelope_retired')
    ) {
      throw error;
    }
    await settledAfterRetirement(error);
    return laneClawbackOfIntent(params, legacy.signerAddress);
  }
  return { kind: 'legacy', authorized: legacy.authorized };
}

/**
 * Claw back once in `envelope`: the legacy clawback at
 * `clawback.nonce`, or the lane clawback at the holder's next nonce.
 * A clawback that clawbackStaysLegacy names is the legacy clawback
 * whatever `envelope` says, and its retired refusal is returned. On
 * a retired legacy clawback of an ordinary account (no nonce or lock
 * taken), once the node reports `settled`, the clawback is issued as
 * the lane clawback.
 *
 * Call it once per clawback intent. After an error that
 * authorityRefusalOf does not name, the stored transaction may be in
 * flight or executed: resend its signed bytes or read its outcome
 * (laneClawbackFate for a lane clawback); never call again, which
 * would sign a second clawback.
 *
 * Throws as the single send; ClawbackIntentNonceUsedError before a
 * lane clawback is signed; after a retired refusal, the refusal,
 * UpgradeGapError or UnrecognizedEnvelopeModeError.
 */
export function sendClawback(
  envelope: AuthorityEnvelope,
  params: SendClawbackParams
): Promise<ClawbackSubmission> {
  return route(
    envelope,
    clawbackStaysLegacy(params.clawback.token, params.source),
    params
  );
}

/**
 * Claw back once in the envelope of the node's mode, as
 * sendClawback does. A clawback that clawbackStaysLegacy names reads
 * no mode. Throws UpgradeGapError or UnrecognizedEnvelopeModeError
 * before anything is sent.
 */
export async function clawbackByMode(
  params: SendClawbackParams
): Promise<ClawbackSubmission> {
  const staysLegacy = clawbackStaysLegacy(
    params.clawback.token,
    params.source
  );
  const envelope = staysLegacy
    ? 'legacy'
    : authorityEnvelope(await readEnvelopeMode());
  return route(envelope, staysLegacy, params);
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
   * hash. `node_behind`: the holder's nonce read for the replacement
   * was not past the dead slot; try again later.
   */
  | {
      kind: 'refused';
      fate: LaneClawbackFate;
      reason?: 'node_behind';
    };

/**
 * The issuer's statement that, on a node with the full history (not
 * bootstrapped from a snapshot taken after the dead clawback's
 * reference checkpoint, and keeping receipts that far back), the
 * dead clawback's hash has no receipt and no status by hash.
 */
export interface FullHistoryCheck {
  fullHistoryChecked: true;
}

function isMemo(value: unknown): value is Memo {
  const memo = value as Record<string, unknown> | null;
  return (
    typeof memo === 'object' &&
    memo !== null &&
    ['type', 'format', 'data'].every(
      key => typeof memo[key] === 'string'
    )
  );
}

// A stored record crossed a JSON boundary: check every field that
// the replacement copies before it is signed again.
function deadClawbackOf(dead: AuthorizedTxV2): {
  payload: LaneClawbackPayload;
  memo: Memo;
} {
  const request = dead.request as Record<string, unknown>;
  if (dead.operation !== 'laneClawback' || !isMemo(request.memo)) {
    throw new Error(
      '[1Money SDK]: prepareLaneClawbackReissue needs a stored signed lane clawback with its memo'
    );
  }
  const payload = {
    chain_id: request.chain_id,
    token: request.token,
    holder: request.holder,
    from_nonce: request.from_nonce,
    reference_checkpoint: request.reference_checkpoint,
    recipient: request.recipient,
    value: request.value
  } as LaneClawbackPayload;
  validateLaneClawback(payload);
  return { payload, memo: request.memo };
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
 * Throws for a stored record that is not a valid lane clawback,
 * AuthorityReadError when a read does not answer, and as
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
  const { payload: deadPayload, memo } = deadClawbackOf(dead);
  const fate = await laneClawbackFate(dead);
  if (fate.fate !== 'unknown' || fate.observed.status !== undefined) {
    return { kind: 'refused', fate };
  }
  const payload = await buildLaneClawback({
    chain_id: deadPayload.chain_id,
    token: deadPayload.token,
    holder: deadPayload.holder,
    recipient: deadPayload.recipient,
    value: deadPayload.value
  });
  if (payload.from_nonce <= deadPayload.from_nonce) {
    return { kind: 'refused', fate, reason: 'node_behind' };
  }
  return {
    kind: 'prepared',
    authorized: await signLaneClawback(payload, signer, memo)
  };
}
