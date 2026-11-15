import { TransactionSubmissionError } from '../errors';
import { PROBLEM_TYPE_PREFIX } from '../problem';
import { wholeNumber } from './answer';

const REFUSAL_IDS = [
  'legacy_envelope_retired',
  'settled_envelope_not_active',
  'reference_checkpoint_not_committed',
  'reference_checkpoint_too_old',
  'token_not_at_reference_checkpoint'
] as const;

export type AuthorityRefusalKind =
  (typeof REFUSAL_IDS)[number];

/** The problem type URI of each token authority refusal. */
export const AUTHORITY_REFUSAL_TYPES: Readonly<
  Record<AuthorityRefusalKind, string>
> = Object.freeze(
  Object.fromEntries(
    REFUSAL_IDS.map(id => [id, `${PROBLEM_TYPE_PREFIX}${id}`])
  ) as Record<AuthorityRefusalKind, string>
);

/**
 * A refusal of the token authority model. Every one had no effect:
 * the node took no nonce and no lock for the request.
 *
 * - `legacy_envelope_retired`: do not send the legacy form again.
 *   Read the envelope mode; once it is `settled`, sign the
 *   operation again as the new envelope at the same nonce.
 * - `settled_envelope_not_active`: try the same transaction later.
 * - `reference_checkpoint_not_committed`: try again once the node
 *   commits the checkpoint.
 * - `reference_checkpoint_too_old`: sign again with a recent
 *   checkpoint only if the transaction was never sent; the node
 *   checks the reference before the nonce, so an executed one gets
 *   this answer too.
 * - `token_not_at_reference_checkpoint`: not evidence that the token
 *   does not exist; sign again later with a later checkpoint.
 *
 * A member is missing when an older node did not send it.
 */
export type AuthorityRefusal =
  | { kind: 'legacy_envelope_retired' }
  | { kind: 'settled_envelope_not_active' }
  | {
      kind: 'reference_checkpoint_not_committed';
      checkpointId?: number;
      checkpointIdLatest?: number;
    }
  | {
      kind: 'reference_checkpoint_too_old';
      checkpointId?: number;
      checkpointIdEarliest?: number;
    }
  | {
      kind: 'token_not_at_reference_checkpoint';
      mintAddress?: string;
      checkpointId?: number;
    };

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function withDefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;
}

function kindOf(
  problemType: string | undefined
): AuthorityRefusalKind | undefined {
  return REFUSAL_IDS.find(
    id => AUTHORITY_REFUSAL_TYPES[id] === problemType
  );
}

/**
 * The token authority refusal an error carries, or undefined. Only
 * a TransactionSubmissionError counts: it alone proves the request
 * had no effect.
 */
export function authorityRefusalOf(
  error: unknown
): AuthorityRefusal | undefined {
  if (!(error instanceof TransactionSubmissionError)) {
    return undefined;
  }
  const problem = error.problem;
  const kind = kindOf(problem?.type ?? error.problemType);
  if (kind === undefined) return undefined;
  const members = problem?.members ?? {};
  switch (kind) {
    case 'legacy_envelope_retired':
    case 'settled_envelope_not_active':
      return { kind };
    case 'reference_checkpoint_not_committed':
      return withDefined({
        kind,
        checkpointId: wholeNumber(members.checkpoint_id),
        checkpointIdLatest: wholeNumber(
          members.checkpoint_id_latest
        )
      });
    case 'reference_checkpoint_too_old':
      return withDefined({
        kind,
        checkpointId: wholeNumber(members.checkpoint_id),
        checkpointIdEarliest: wholeNumber(
          members.checkpoint_id_earliest
        )
      });
    case 'token_not_at_reference_checkpoint':
      return withDefined({
        kind,
        mintAddress: text(members.mint_address),
        checkpointId: wholeNumber(members.checkpoint_id)
      });
  }
}

export function isAuthorityRefusal(
  error: unknown,
  kind: AuthorityRefusalKind
): boolean {
  return authorityRefusalOf(error)?.kind === kind;
}

// The two refusals of a default reference that a second signature,
// with a reference read again, can cure: a node behind a load
// balancer can be a checkpoint behind the one that named it, and a
// token issued just before is in no checkpoint yet.
export function isReferenceNotReady(error: unknown): boolean {
  const kind = authorityRefusalOf(error)?.kind;
  return (
    kind === 'reference_checkpoint_not_committed' ||
    kind === 'token_not_at_reference_checkpoint'
  );
}
