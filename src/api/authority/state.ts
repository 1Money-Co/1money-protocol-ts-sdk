import { laneClawbackRecordOf } from './laneClawbackRecord';
import {
  readAccountNonce,
  readReceipt,
  readStatus
} from './reads';

import type { AuthorizedTxV2 } from '@/signing/v2';
import type {
  ReceiptWarning,
  SoftFailReason,
  TransactionReceipt,
  TransactionStatusValue
} from '../transactions/types';

const COUNTER_SIGNED: readonly TransactionStatusValue[] = [
  'certified_pending_checkpoint',
  'checkpointed',
  'finalized'
];

/** Whether a status reports a 2f+1 certificate, which is final. */
export function isCounterSigned(status: unknown): boolean {
  return (COUNTER_SIGNED as unknown[]).includes(status);
}

/**
 * What a receipt decided. Show `warnings` to the user: a no-op
 * revoke names an account that held no role, so another account
 * can still hold it.
 */
export type ReceiptOutcome =
  | { outcome: 'success'; warnings: ReceiptWarning[] }
  /** A success that changed only the signer's nonce. */
  | {
      outcome: 'no_op';
      target: string | null;
      warnings: ReceiptWarning[];
    }
  /** Failed at its checkpoint; the nonce is used. */
  | { outcome: 'soft_fail'; reason: SoftFailReason }
  | { outcome: 'failed' };

export function receiptOutcomeOf(
  receipt: TransactionReceipt
): ReceiptOutcome {
  const events = receipt.execution_events ?? [];
  const warnings = receipt.warnings ?? [];
  if (!receipt.success) {
    for (const event of events) {
      if (event.event_type === 'SoftFail') {
        return { outcome: 'soft_fail', reason: event.reason };
      }
    }
    return { outcome: 'failed' };
  }
  for (const event of events) {
    if (event.event_type === 'NoOp') {
      return { outcome: 'no_op', target: event.target, warnings };
    }
  }
  return { outcome: 'success', warnings };
}

/**
 * What one round of reads showed when the account's nonce passed
 * the transaction's nonce with no receipt and no certificate. It
 * does not tell whether the transaction executed: a node
 * bootstrapped from a snapshot, or one that pruned receipts,
 * answers the same for one that executed.
 */
export interface UnknownOutcome {
  /** The account's next nonce: past the transaction's nonce. */
  nextNonce: number;
  /** The status by hash; missing when the lookup answered 404. */
  status?: TransactionStatusValue;
}

/**
 * Where an authority operation stands. Only a receipt or a
 * counter-signed status decides it; a missing one never does.
 */
export type AuthorityOperationState =
  /** The signer's nonce has not passed it; no receipt. */
  | { state: 'pending' }
  /** Counter-signed and final; its checkpoint decides it. Not a failure. */
  | { state: 'settling'; status: TransactionStatusValue }
  | {
      state: 'decided';
      receipt: TransactionReceipt;
      outcome: ReceiptOutcome;
    }
  /**
   * May have executed, or another transaction may have taken the
   * nonce. Never report it as failed. Do not sign the intent again
   * until a node with the full history shows no receipt for it.
   */
  | { state: 'unknown'; observed: UnknownOutcome };

/** Where a lane clawback stands. Nothing read says that it never executes. */
export type LaneClawbackFate =
  | {
      fate: 'executed';
      receipt: TransactionReceipt;
      outcome: ReceiptOutcome;
    }
  /** Counter-signed: it executes, as a payment does. Never claw back again for it. */
  | { fate: 'certified'; status: TransactionStatusValue }
  /** The holder's nonce has not passed `from_nonce`. */
  | { fate: 'pending' }
  /**
   * The holder's nonce passed `from_nonce` with no receipt and no
   * certificate. Never issue it again by itself: a replacement is an
   * explicit issuer action after a full-history check.
   */
  | { fate: 'unknown'; observed: UnknownOutcome };

type Evidence =
  | { kind: 'receipt'; receipt: TransactionReceipt }
  | { kind: 'certified'; status: TransactionStatusValue }
  | { kind: 'nonce_not_passed' }
  | { kind: 'no_receipt'; observed: UnknownOutcome };

// The nonce is read first, so a transaction that executes after
// that read is never "not passed": its receipt and status are read
// after it. A certificate wins over a nonce read from a node behind.
async function readEvidence(
  account: string,
  nonce: number,
  hash: string
): Promise<Evidence> {
  const nextNonce = await readAccountNonce(account);
  const [receipt, statusResponse] = await Promise.all([
    readReceipt(hash),
    readStatus(hash)
  ]);
  if (receipt) return { kind: 'receipt', receipt };
  const status = statusResponse?.status;
  if (status !== undefined && isCounterSigned(status)) {
    return { kind: 'certified', status };
  }
  if (nextNonce <= nonce) return { kind: 'nonce_not_passed' };
  return {
    kind: 'no_receipt',
    observed: {
      nextNonce,
      ...(status !== undefined && { status })
    }
  };
}

/**
 * Read, in one round, where an authority operation of `signer` at
 * `nonce` stands. Throws AuthorityReadError when a read does not
 * answer.
 */
export async function authorityOperationState(
  signer: string,
  nonce: number,
  transactionHash: string
): Promise<AuthorityOperationState> {
  const evidence = await readEvidence(
    signer,
    nonce,
    transactionHash
  );
  switch (evidence.kind) {
    case 'receipt':
      return {
        state: 'decided',
        receipt: evidence.receipt,
        outcome: receiptOutcomeOf(evidence.receipt)
      };
    case 'certified':
      return { state: 'settling', status: evidence.status };
    case 'nonce_not_passed':
      return { state: 'pending' };
    case 'no_receipt':
      return { state: 'unknown', observed: evidence.observed };
  }
}

/**
 * Read, in one round, where a signed lane clawback stands, on its
 * holder's lane. Throws as laneClawbackRecordOf before any read, and
 * AuthorityReadError when a read does not answer.
 */
export async function laneClawbackFate(
  authorized: AuthorizedTxV2
): Promise<LaneClawbackFate> {
  const { payload, transactionHash } =
    laneClawbackRecordOf(authorized);
  const evidence = await readEvidence(
    payload.holder,
    payload.from_nonce,
    transactionHash
  );
  switch (evidence.kind) {
    case 'receipt':
      return {
        fate: 'executed',
        receipt: evidence.receipt,
        outcome: receiptOutcomeOf(evidence.receipt)
      };
    case 'certified':
      return { fate: 'certified', status: evidence.status };
    case 'nonce_not_passed':
      return { fate: 'pending' };
    case 'no_receipt':
      return { fate: 'unknown', observed: evidence.observed };
  }
}
