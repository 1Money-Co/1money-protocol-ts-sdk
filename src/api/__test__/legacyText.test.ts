import { expect } from 'chai';
import fc from 'fast-check';
import 'mocha';

import {
  LEGACY_PREFIX,
  LEGACY_TEXTS,
  matchLegacyReason
} from '../legacyText';

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const HASH = `0x${'ab'.repeat(32)}`;

// Reasons as an l1client v0.8.11 node writes them after
// "Transaction processing failed: ", with sample values in
// the variable parts. Each text is copied from the
// v0.8.11 source.
const PINNED: [string, string][] = [
  ['in_flight', 'already inflight; please retry later'],
  ['nonce_used', 'nonce already used; state advanced'],
  [
    'nonce_used',
    `Execution admission denied: nonce too low to execute: expected 6, got 5 of tx ${HASH}`
  ],
  ['bytes', 'Failed to recover REST envelope: invalid signature bytes'],
  ['bytes', 'Zero sender'],
  ['bytes', 'Invalid chain id: expected 21210, actual 1212101'],
  [
    'bytes',
    'Governance reserved sender abused: 0x1111111111111111111111110000000000000005'
  ],
  ['bytes', 'Invalid transaction memo: memo.type exceeds 128 bytes (got 129)'],
  ['bytes', 'Invalid transaction memo: memo.type contains non-URL-safe characters'],
  ['bytes', 'Invalid transaction memo: memo.format exceeds 64 bytes (got 65)'],
  ['bytes', 'Invalid transaction memo: memo.format contains non-URL-safe characters'],
  ['bytes', 'Invalid transaction memo: memo.data exceeds 256 bytes (got 257)'],
  [
    'bytes',
    'Invalid transaction memo: memo.data contains null bytes or Unicode control/surrogate codepoints'
  ],
  [
    'bytes',
    'Transaction signature is malformed: Other error: batch payment operations must not be empty'
  ],
  ['bytes', 'Internal error: batch payment total amount overflow']
];

// Reasons that must never match: every state refusal of
// the v0.8.11 submit path, and the refusals of the bytes
// that are left out because their text alone cannot tell
// their class.
const NO_MATCH: string[] = [
  // Refusals of the bytes whose check is newer than v0.8.3:
  // bytes an older node admitted can get them on a resend.
  'payment value must be greater than 0',
  `BurnAndBridge payload sender ${ADDRESS} does not match authenticated signer 0x0000000000000000000000000000000000000001`,
  'value must be zero for Revoke Pause; only Grant MintBurnTokens carries an allowance',
  'authority address cannot be the zero address for Grant Bridge',
  'nonce higher than expected; local submit does not queue',
  'admission datastore unavailable',
  'batch payments are disabled',
  'non-local origin',
  'tx already locked; entry missing',
  'Read-only node: transaction-write APIs are disabled',
  `Execution admission denied: nonce too high to execute: expected 5, got 7 of tx ${HASH}`,
  `sender already locked: ${ADDRESS}, locked_nonce: 5, locked_tx_hash: ${HASH}, origin: Local`,
  `Invariant violation: sender: ${ADDRESS}, nonce: 5, tx_hash: ${HASH}, error: lock exists but not found in by_hash`,
  `pricing state read failed for tx ${HASH} sender ${ADDRESS} nonce 5: Governance certificate not found of epoch 3`,
  `fee pricing epoch unavailable for tx ${HASH} sender ${ADDRESS} nonce 5: tx_epoch 3, committed_epoch 5`,
  `fee pricing not yet committed for tx ${HASH} sender ${ADDRESS} nonce 5 at transaction epoch 7`,
  'Pricing state read failed: Governance certificate not found of epoch 3',
  'Fee pricing not yet committed for transaction epoch 7',
  'Fee pricing epoch unavailable: tx_epoch 3, committed_epoch 5',
  'Input size is too large: 40000',
  'Transaction signature is malformed: Other error: batch payments are disabled',
  'Transaction signature is malformed: Other error: batch payment operations exceed configured limit: 300 > 200',
  `Transaction signature is malformed: Other error: batch payment token ${ADDRESS} does not match configured fee asset 0x0000000000000000000000000000000000000002`,
  'Transaction signature is malformed: Other error: batch payment operation 2 has an invalid recipient',
  'Transaction signature is malformed: Other error: batch payment operation 2 amount must be greater than 0',
  `Execution admission denied: account view error (provider): Mint account not found at ${ADDRESS}`,
  `Execution admission denied: token process error: TokenProcessError: mint_address: ${ADDRESS}, error: Transfer failed: insufficient balance in source account`,
  `Execution admission denied: token process error: TokenProcessError: mint_address: ${ADDRESS}, error: Transfer failed: token is currently paused`,
  `Execution admission denied: token process error: TokenProcessError: mint_address: ${ADDRESS}, error: sender address is blacklisted`,
  'Execution admission denied: input error: Multi-sig threshold verification failed: insufficient signature weight: required 3, provided 2',
  'Execution admission denied: input error: Multi-sig account must have at least two valid signers'
];

// Written out here, not read from LEGACY_TEXTS, so that a
// changed text or match kind fails a test.
const EXPECTED_ENTRIES: [string, string][] = [
  ['exact', 'already inflight; please retry later'],
  ['exact', 'nonce already used; state advanced'],
  ['prefix', 'Execution admission denied: nonce too low to execute: '],
  ['exact', 'Failed to recover REST envelope: invalid signature bytes'],
  ['exact', 'Zero sender'],
  ['prefix', 'Invalid chain id: expected '],
  ['prefix', 'Governance reserved sender abused: '],
  ['prefix', 'Invalid transaction memo: '],
  [
    'exact',
    'Transaction signature is malformed: Other error: batch payment operations must not be empty'
  ],
  ['exact', 'Internal error: batch payment total amount overflow']
];

describe('matchLegacyReason', function () {
  it('gives the pinned class of every v0.8.11 text', function () {
    for (const [cls, reason] of PINNED) {
      expect(
        matchLegacyReason(`${LEGACY_PREFIX}${reason}`),
        reason
      ).to.equal(cls);
    }
  });

  it('gives no class for a state refusal or a left-out text', function () {
    for (const reason of NO_MATCH) {
      expect(
        matchLegacyReason(`${LEGACY_PREFIX}${reason}`),
        reason
      ).to.equal(undefined);
    }
  });

  it('gives no class without the legacy prefix', function () {
    const sameLength = 'x'.repeat(LEGACY_PREFIX.length);
    for (const [, reason] of PINNED) {
      expect(matchLegacyReason(reason), reason).to.equal(
        undefined
      );
      expect(
        matchLegacyReason(`Transaction failed: ${reason}`)
      ).to.equal(undefined);
      expect(
        matchLegacyReason(`${sameLength}${reason}`)
      ).to.equal(undefined);
    }
  });

  it('pins each text with its match kind', function () {
    expect(
      LEGACY_TEXTS.map(entry => [entry.match, entry.text])
    ).to.deep.equal(EXPECTED_ENTRIES);
  });

  it('matches an exact entry only as the whole reason', function () {
    for (const [match, text] of EXPECTED_ENTRIES) {
      if (match !== 'exact') continue;
      expect(
        matchLegacyReason(`${LEGACY_PREFIX}${text}`)
      ).to.not.equal(undefined);
      expect(
        matchLegacyReason(`${LEGACY_PREFIX}${text} (extra)`)
      ).to.equal(undefined);
      expect(
        matchLegacyReason(
          `${LEGACY_PREFIX}${text.slice(0, -1)}`
        )
      ).to.equal(undefined);
    }
  });

  it('has no entry that starts another entry of a different class', function () {
    for (const a of LEGACY_TEXTS) {
      for (const b of LEGACY_TEXTS) {
        if (a === b || a.cls === b.cls) continue;
        expect(
          b.text.startsWith(a.text),
          `${a.text} | ${b.text}`
        ).to.equal(false);
      }
    }
  });

  it('cites a v0.8.11 source line for every entry', function () {
    for (const entry of LEGACY_TEXTS) {
      expect(entry.source).to.match(
        /^crates\/[\w/-]+\.rs:\d+(-\d+)?(, \d+(-\d+)?)*$/
      );
    }
  });

  it('never matches a state refusal, whatever follows it', function () {
    fc.assert(
      fc.property(
        fc.constantFrom(...NO_MATCH),
        fc.string(),
        (reason, tail) =>
          matchLegacyReason(
            `${LEGACY_PREFIX}${reason}${tail}`
          ) === undefined
      ),
      { numRuns: 2000 }
    );
  });

  it('never throws, and gives a class only after the prefix', function () {
    fc.assert(
      fc.property(fc.string(), message => {
        const cls = matchLegacyReason(message);
        return (
          cls === undefined ||
          message.startsWith(LEGACY_PREFIX)
        );
      }),
      { numRuns: 2000 }
    );
  });
});
