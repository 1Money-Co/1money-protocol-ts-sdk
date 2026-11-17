import { isVerifyToken } from '@/signing/builders/laneClawback';
import { ownMember } from '../problem';
import {
  answeredStatus,
  isReadError,
  readAnswer
} from './answer';

import type { NodeEnvelopeMode } from '../status/types';

const STATUS_PATH = '/api/status';
const ENVELOPE_MODE_MEMBER = 'envelope_mode';
const NODE_ENVELOPE_MODES: readonly NodeEnvelopeMode[] = [
  'upgrade_gap',
  'settled'
];

/** Why a node reads as taking the legacy envelopes. */
export type LegacyModeReason =
  /** The status has no `envelope_mode`, or a null one. */
  | { kind: 'not_reported' }
  /**
   * `GET /api/status` answered with this HTTP status. The endpoint
   * is operational, outside the partner API, so a gateway may hide
   * it. Behind such a gateway every by-mode call ends in a retired
   * refusal once the node takes the new envelopes: send with the
   * envelope named (`'settled'`) instead.
   */
  | { kind: 'status_answered'; status: number }
  /** `GET /api/status` got no answer. */
  | { kind: 'no_answer'; message: string }
  /** The status body is not a JSON object. */
  | { kind: 'undecodable' };

/**
 * What a node's `GET /api/status` says about the token authority
 * envelopes it takes. Only a positively reported mode leaves the
 * legacy envelopes: a node of the new release refuses a legacy
 * envelope at admission and takes no nonce or lock for it, so a
 * wrong legacy reading costs a refused request, never a stuck one.
 */
export type EnvelopeMode =
  | { mode: 'legacy'; reason: LegacyModeReason }
  /** Send nothing of the class; try again later. */
  | { mode: 'upgrade_gap' }
  /** The node takes the new envelopes, for good. */
  | { mode: 'settled' }
  /** A mode this SDK does not know: send nothing, upgrade the SDK. */
  | { mode: 'unrecognized'; reported: unknown };

export type AuthorityEnvelope = 'legacy' | 'settled';

/**
 * The source of a clawback: an ordinary frozen account, or a
 * Reserved Payment hold (whose clawback stays legacy).
 */
export type ClawbackSource = 'account' | 'hold';

/** The node is in the upgrade gap. Nothing was sent; try again later. */
export class UpgradeGapError extends Error {
  public readonly submitted = false;

  public constructor() {
    super(
      '[1Money SDK]: The node is in the token authority upgrade gap: it refuses the legacy authority envelopes and does not take the new ones yet. Nothing was sent; try again later.'
    );
    this.name = 'UpgradeGapError';
  }
}

/** The node reports an envelope mode this SDK does not know. Nothing was sent. */
export class UnrecognizedEnvelopeModeError extends Error {
  public readonly submitted = false;
  public readonly reported: unknown;

  public constructor(reported: unknown) {
    super(
      `[1Money SDK]: The node reports the envelope mode ${JSON.stringify(reported)}, which this SDK does not know. Nothing was sent; upgrade the SDK.`
    );
    this.name = 'UnrecognizedEnvelopeModeError';
    this.reported = reported;
  }
}

/** The envelope mode of a `GET /api/status` answer, or of its read error. */
export function envelopeModeOf(answer: unknown): EnvelopeMode {
  if (answer instanceof Error && !isReadError(answer)) {
    return {
      mode: 'legacy',
      reason: { kind: 'no_answer', message: answer.message }
    };
  }
  if (isReadError(answer)) {
    const status = answeredStatus(answer);
    return {
      mode: 'legacy',
      reason:
        status !== undefined
          ? { kind: 'status_answered', status }
          : {
              kind: 'no_answer',
              message: String(ownMember(answer, 'message'))
            }
    };
  }
  if (
    typeof answer !== 'object' ||
    answer === null ||
    Array.isArray(answer)
  ) {
    return { mode: 'legacy', reason: { kind: 'undecodable' } };
  }
  const reported = ownMember(answer, ENVELOPE_MODE_MEMBER);
  if (reported === undefined || reported === null) {
    return { mode: 'legacy', reason: { kind: 'not_reported' } };
  }
  return (NODE_ENVELOPE_MODES as unknown[]).includes(reported)
    ? { mode: reported as NodeEnvelopeMode }
    : { mode: 'unrecognized', reported };
}

/**
 * Read the node's envelope mode. Never throws for a node answer:
 * a missing or null member, an HTTP error, no answer, or a body
 * that does not decode all read as `legacy`, with the reason; a
 * mode this SDK does not know reads as `unrecognized`.
 */
export async function readEnvelopeMode(): Promise<EnvelopeMode> {
  return envelopeModeOf(await readAnswer(STATUS_PATH));
}

/**
 * The envelope of an authority operation in this mode. Throws
 * UpgradeGapError or UnrecognizedEnvelopeModeError, before
 * anything is sent.
 */
export function authorityEnvelope(
  mode: EnvelopeMode
): AuthorityEnvelope {
  switch (mode.mode) {
    case 'legacy':
      return 'legacy';
    case 'settled':
      return 'settled';
    case 'upgrade_gap':
      throw new UpgradeGapError();
    case 'unrecognized':
      throw new UnrecognizedEnvelopeModeError(mode.reported);
  }
}

/**
 * Whether a clawback is the legacy clawback in every mode: a
 * clawback of VERIFY (its master claws it back at the master's
 * own nonce) or of a Reserved Payment hold. It needs no mode read.
 */
export function clawbackStaysLegacy(
  token: string,
  source: ClawbackSource
): boolean {
  return isVerifyToken(token) || source === 'hold';
}

/** The envelope of a clawback in this mode; throws as authorityEnvelope. */
export function clawbackEnvelope(
  mode: EnvelopeMode,
  token: string,
  source: ClawbackSource
): AuthorityEnvelope {
  return clawbackStaysLegacy(token, source)
    ? 'legacy'
    : authorityEnvelope(mode);
}
