// A released l1client node (v0.8.x) sends no problem
// `type` or `action`. Its only signal is the fixed reason
// text in `message`. This list pins the reasons whose class
// is certain from the text alone; any other reason reads as
// unknown. A missing entry costs a shortcut, a wrong entry a
// false "rejected", so an entry goes in only when its class
// is certain from the text and no text of another class
// starts with it. A `bytes` entry also needs the same check
// in every release that accepts v2 submits (v0.8.3 on):
// bytes that an older node admitted must not read as never
// admitted. Sources are l1client v0.8.11.
export type LegacyClass =
  | 'in_flight'
  | 'nonce_used'
  | 'bytes';

export interface LegacyText {
  cls: LegacyClass;
  text: string;
  // A prefix ends before the first variable part.
  match: 'exact' | 'prefix';
  source: string;
}

export const LEGACY_PREFIX =
  'Transaction processing failed: ';

export const LEGACY_TEXTS: readonly LegacyText[] = [
  {
    cls: 'in_flight',
    text: 'already inflight; please retry later',
    match: 'exact',
    source:
      'crates/consensus/om-counter-signer/src/local_submit_pipeline.rs:542-544, 751-753'
  },
  {
    cls: 'nonce_used',
    text: 'nonce already used; state advanced',
    match: 'exact',
    source:
      'crates/consensus/om-counter-signer/src/local_submit_pipeline.rs:722-726'
  },
  {
    cls: 'nonce_used',
    text: 'Execution admission denied: nonce too low to execute: ',
    match: 'prefix',
    source: 'crates/om-execution/src/error.rs:12'
  },
  // A refusal of the signed bytes: the same bytes fail on
  // every node with the same rules, so no send of them was
  // ever admitted.
  {
    cls: 'bytes',
    text: 'Failed to recover REST envelope: invalid signature bytes',
    match: 'exact',
    source: 'crates/api/om-api-core/src/transactions.rs:257'
  },
  {
    cls: 'bytes',
    text: 'Zero sender',
    match: 'exact',
    source: 'crates/om-verifier/src/transaction_verifier.rs:190-192'
  },
  {
    cls: 'bytes',
    text: 'Invalid chain id: expected ',
    match: 'prefix',
    source: 'crates/om-verifier/src/transaction_verifier.rs:179-184'
  },
  {
    cls: 'bytes',
    text: 'Governance reserved sender abused: ',
    match: 'prefix',
    source: 'crates/om-verifier/src/transaction_verifier.rs:186-188'
  },
  {
    cls: 'bytes',
    text: 'Invalid transaction memo: ',
    match: 'prefix',
    source: 'crates/om-verifier/src/transaction_verifier.rs:236-238'
  },
  {
    cls: 'bytes',
    text: 'Transaction signature is malformed: Other error: batch payment operations must not be empty',
    match: 'exact',
    source: 'crates/om-verifier/src/transaction_verifier.rs:306-310'
  },
  {
    cls: 'bytes',
    text: 'Internal error: batch payment total amount overflow',
    match: 'exact',
    source: 'crates/om-verifier/src/transaction_verifier.rs:709-714'
  }
];

function matches(
  entry: LegacyText,
  reason: string
): boolean {
  switch (entry.match) {
    case 'exact':
      return reason === entry.text;
    case 'prefix':
      return reason.startsWith(entry.text);
  }
}

// The class of a legacy `message`, or undefined when it has
// no pinned reason. No entry starts an entry of another
// class (a test checks it), so at most one class matches.
export function matchLegacyReason(
  message: string
): LegacyClass | undefined {
  if (!message.startsWith(LEGACY_PREFIX)) {
    return undefined;
  }
  const reason = message.slice(LEGACY_PREFIX.length);
  return LEGACY_TEXTS.find(entry =>
    matches(entry, reason)
  )?.cls;
}
