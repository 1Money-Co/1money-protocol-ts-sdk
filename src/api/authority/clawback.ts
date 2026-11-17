import {
  authorityEnvelope,
  clawbackStaysLegacy,
  readEnvelopeMode
} from './envelopeMode';
import { laneClawbackRecordOf } from './laneClawbackRecord';
import { readAccountNonce } from './reads';
import { isAuthorityRefusal } from './refusals';
import { buildLaneClawback, signLaneClawback } from './send';
import {
  sendWithReferenceRetry,
  settledAfterRetirement,
  signRecovering,
  signedRecorder,
  submit
} from './sendCore';
import { laneClawbackFate } from './state';

import type { AuthorityEnvelope, ClawbackSource } from './envelopeMode';
import type { OnSigned } from './sendCore';
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

/**
 * The signer adapter's getAddress() names another account than its
 * signature recovers to. Nothing was stored or sent.
 */
export class SignerAddressMismatchError extends Error {
  public readonly submitted = false;
  public readonly claimed: string;
  public readonly recovered: string;

  public constructor(claimed: string, recovered: string) {
    super(
      `[1Money SDK]: The signer adapter's getAddress() gave ${claimed}, but its signature recovers to ${recovered}. Nothing was stored or sent.`
    );
    this.name = 'SignerAddressMismatchError';
    this.claimed = claimed;
    this.recovered = recovered;
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
  /** The wait before the one retry of a reference not ready yet. */
  referenceRetryDelayMs?: number;
  /**
   * Called with each signed clawback, legacy or lane, before it is
   * sent; a clawback that replaces a refused one names it in
   * `replaces`. After any error, read the outcome of the last
   * clawback it received, never by calling the router again.
   */
  onSigned: OnSigned;
}

type Recorder = (authorized: AuthorizedTxV2) => Promise<void>;

function signLegacyClawback(params: SendClawbackParams) {
  return signRecovering(
    'tokenClawback',
    params.clawback,
    params.signer,
    params.memo
  );
}

// The adapter's own address. From an adapter without getAddress,
// the address recovered from a legacy clawback signed only for it,
// which costs a remote or hardware signer a second approval.
async function signerAddressOf(
  params: SendClawbackParams
): Promise<string> {
  if (params.signer.getAddress) return params.signer.getAddress();
  return (await signLegacyClawback(params)).signerAddress;
}

// A lane clawback of the intent is signed only while the signer's
// nonce has not passed the intent's nonce: a node refuses a resend
// of an executed legacy clawback as retired before it reads the
// nonce, and the lane clawback takes a holder slot, so the signer's
// nonce would no longer stop a second debit. The check cannot see a
// lane clawback already issued for the intent, or a legacy one still
// in flight: that is why the router runs once per intent.
async function signLaneClawbackOfIntent(
  params: SendClawbackParams,
  signerAddress: string
): Promise<AuthorizedTxV2> {
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
  const signed = await signRecovering(
    'laneClawback',
    payload,
    params.signer,
    params.memo
  );
  if (
    signed.signerAddress.toLowerCase() !==
    signerAddress.toLowerCase()
  ) {
    throw new SignerAddressMismatchError(
      signerAddress,
      signed.signerAddress
    );
  }
  return signed.authorized;
}

async function laneClawbackOfIntent(
  params: SendClawbackParams,
  signerAddress: string,
  record: Recorder
): Promise<ClawbackSubmission> {
  const authorized = await sendWithReferenceRetry(
    () => signLaneClawbackOfIntent(params, signerAddress),
    record,
    params.referenceRetryDelayMs
  );
  return { kind: 'lane', authorized };
}

async function route(
  envelope: AuthorityEnvelope,
  staysLegacy: boolean,
  params: SendClawbackParams
): Promise<ClawbackSubmission> {
  const record = signedRecorder(params.onSigned);
  if (envelope === 'settled' && !staysLegacy) {
    return laneClawbackOfIntent(
      params,
      await signerAddressOf(params),
      record
    );
  }
  const legacy = await signLegacyClawback(params);
  await record(legacy.authorized);
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
    return laneClawbackOfIntent(
      params,
      legacy.signerAddress,
      record
    );
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
 * the lane clawback. A lane clawback whose reference was not ready
 * is built and signed once more.
 *
 * Call it once per clawback intent. After an error that
 * authorityRefusalOf does not name, the stored transaction may be in
 * flight or executed: resend its signed bytes or read its outcome
 * (laneClawbackFate for a lane clawback); never call again, which
 * would sign a second clawback.
 *
 * Throws as the single send; ClawbackIntentNonceUsedError before a
 * lane clawback is signed; SignerAddressMismatchError before one is
 * stored; after a retired refusal, the refusal, UpgradeGapError or
 * UnrecognizedEnvelopeModeError.
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
 * Throws as laneClawbackRecordOf for a stored record that is not a
 * valid lane clawback, AuthorityReadError when a read does not
 * answer, and as buildLaneClawback.
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
  const { payload: deadPayload, memo } = laneClawbackRecordOf(dead);
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
