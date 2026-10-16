import { expect } from 'chai';
import fc from 'fast-check';
import 'mocha';

import {
  TransactionHashMismatchError,
  TransactionLockedError,
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from '../errors';
import { runSettle, SETTLE_DEFAULTS } from '../settle';

import type { SubmitOutcome } from '../classify';
import type {
  SettleDeps,
  SettleObservation,
  SettleOptions
} from '../settle';
import type { AuthorizedTxV2 } from '@/signing/v2';

const HASH = `0x${'ab'.repeat(32)}`;
const OTHER = `0x${'cd'.repeat(32)}`;
const TYPE_PREFIX =
  'https://developer.1moneynetwork.com/problem/';

const AUTHORIZED: AuthorizedTxV2 = {
  operation: 'payment',
  path: '/v2/transactions/payment',
  request: { chain_id: 1212101, nonce: 7 },
  transactionHash: HASH as `0x${string}`
};

const ACCEPTED: SubmitOutcome = {
  kind: 'accepted',
  serverHash: HASH,
  response: { hash: HASH }
};
const LOCKED: SubmitOutcome = {
  kind: 'locked',
  status: 422,
  data: {},
  problemType: `${TYPE_PREFIX}submission_already_in_flight`
};
const SERVER_ERROR: SubmitOutcome = {
  kind: 'unknown',
  status: 500,
  data: { message: 'system error' }
};
const NONCE_TOO_LOW: SubmitOutcome = {
  kind: 'unknown',
  status: 422,
  data: {},
  action: 'check_status',
  problemType: `${TYPE_PREFIX}nonce_too_low`
};
// A legacy node: no `type`, no `action`.
const LEGACY_NONCE_TOO_LOW: SubmitOutcome = {
  kind: 'unknown',
  status: 422,
  data: {
    error_code: 'business_transaction_failed',
    message: 'nonce too low'
  }
};
const REJECTED: SubmitOutcome = {
  kind: 'rejected',
  refusal: 'request',
  status: 400,
  data: { error_code: 'validation_invalid_signature' },
  nodeMessage: 'bad signature',
  action: 'fix_request',
  problemType: `${TYPE_PREFIX}invalid_signature`
};

const RETRY_LATER: SubmitOutcome = {
  kind: 'rejected',
  refusal: 'request',
  status: 503,
  data: {},
  nodeMessage: 'submission queue full',
  action: 'retry_later',
  problemType: `${TYPE_PREFIX}submit_queue_full`
};

// A resend every 70 s until the 900 s deadline.
const RESEND_TIMES = Array.from(
  { length: 13 },
  (_, k) => k * 70_000
);

// The value `get()` gives for a 404 (src/client/core.ts).
function readError(status: number, data: unknown) {
  return {
    name: 'AxiosError',
    message: `Request failed with status code ${status}`,
    stack: '',
    status,
    data
  };
}

const NOT_FOUND = readError(404, {
  type: `${TYPE_PREFIX}transaction_not_found`,
  action: 'check_status',
  tx_hash: HASH
});
const RECEIPT = {
  success: true,
  transaction_hash: HASH,
  fee_used: '1',
  from: '0x0000000000000000000000000000000000000001'
};

interface Script {
  send?: (index: number, t: number) => SubmitOutcome;
  receipt?: (t: number) => unknown;
  lookup?: (t: number) => unknown;
  // Simulated request latency: the clock moves this much
  // while a lookup is in flight.
  lookupLatencyMs?: number;
}

// A fake clock: time moves only when the engine sleeps.
function fakeDeps(script: Script) {
  let t = 0;
  const sends: number[] = [];
  const receipts: number[] = [];
  const lookups: number[] = [];
  const waits: number[] = [];
  const sentBodies: string[] = [];
  const deps: SettleDeps = {
    send: async authorized => {
      sends.push(t);
      sentBodies.push(
        JSON.stringify([
          authorized.path,
          authorized.request,
          authorized.transactionHash
        ])
      );
      return (script.send ?? (() => LOCKED))(
        sends.length - 1,
        t
      );
    },
    receipt: async () => {
      receipts.push(t);
      return (script.receipt ?? (() => NOT_FOUND))(t);
    },
    lookup: async () => {
      lookups.push(t);
      t += script.lookupLatencyMs ?? 0;
      return (script.lookup ?? (() => NOT_FOUND))(t);
    },
    now: () => t,
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw new Error('aborted');
      waits.push(ms);
      t += ms;
    }
  };
  return { deps, sends, receipts, lookups, waits, sentBodies };
}

async function caught(
  promise: Promise<unknown>
): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

function observationsOf(error: unknown) {
  return (
    error as {
      observations?: readonly SettleObservation[];
    }
  ).observations as readonly SettleObservation[];
}

describe('runSettle', function () {
  describe('first send (submitAndSettle)', function () {
    it('resolves with the receipt once it appears, after a 2xx below quorum (UC16)', async function () {
      const f = fakeDeps({
        send: () => ACCEPTED,
        receipt: t =>
          t >= 100_000 ? RECEIPT : NOT_FOUND,
        // The node holds it: the lookup finds it.
        lookup: () => ({ hash: HASH })
      });
      const settled = await runSettle(
        AUTHORIZED,
        'clean',
        {},
        f.deps
      );

      expect(settled).to.deep.equal({
        transactionHash: HASH,
        receipt: RECEIPT
      });
      // The first send, then one resend on the node's
      // schedule re-broadcasts it.
      expect(f.sends).to.have.length(2);
      expect(f.sends[1]).to.be.at.least(70_000);
      // Accepted after a 2xx; the first lookup finds it,
      // so it is locked and needs no more lookups.
      expect(f.lookups).to.deep.equal([0]);
    });

    it('throws TransactionSubmissionError only for a rejected first send (UC14)', async function () {
      const f = fakeDeps({ send: () => REJECTED });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionSubmissionError
      );
      expect(error).to.include({
        status: 400,
        action: 'fix_request'
      });
      expect(f.receipts).to.deep.equal([]);
    });

    it('stays unknown when a resend is rejected after an inconclusive send (UC14b)', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR : REJECTED
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(error).to.not.be.instanceOf(
        TransactionSubmissionError
      );
    });

    it('throws a hash mismatch from any send', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0
            ? SERVER_ERROR
            : {
                kind: 'accepted',
                serverHash: OTHER,
                response: { hash: OTHER }
              }
      });
      expect(
        await caught(
          runSettle(AUTHORIZED, 'clean', {}, f.deps)
        )
      ).to.be.instanceOf(TransactionHashMismatchError);
    });
  });

  describe('resume (settle)', function () {
    it('resends at once, then resolves when the lookup and the receipt find it (UC11)', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? LOCKED : ACCEPTED,
        receipt: t =>
          t >= 30_000 ? RECEIPT : NOT_FOUND
      });
      const settled = await runSettle(
        AUTHORIZED,
        'sent',
        {},
        f.deps
      );

      expect(settled.receipt).to.equal(RECEIPT);
      expect(f.sends[0]).to.equal(0);
    });

    it('resolves when a resend gets nonce_too_low and the receipt exists (UC12)', async function () {
      const f = fakeDeps({
        send: () => NONCE_TOO_LOW,
        receipt: t => (t >= 3_000 ? RECEIPT : NOT_FOUND)
      });
      expect(
        (
          await runSettle(
            AUTHORIZED,
            'sent',
            {},
            f.deps
          )
        ).transactionHash
      ).to.equal(HASH);
    });

    it('ends unknown, with the observations, when the nonce is used and the hash is never found (UC13, UC15)', async function () {
      const f = fakeDeps({ send: () => NONCE_TOO_LOW });
      const error = await caught(
        runSettle(AUTHORIZED, 'sent', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      const sends = observationsOf(error).filter(
        o => o.request === 'send'
      );
      expect(sends[0]).to.include({
        result: 'unknown',
        status: 422,
        action: 'check_status',
        problemType: `${TYPE_PREFIX}nonce_too_low`
      });
    });

    it('never throws TransactionSubmissionError when every resend is refused for the request', async function () {
      const f = fakeDeps({ send: () => REJECTED });
      expect(
        await caught(
          runSettle(AUTHORIZED, 'sent', {}, f.deps)
        )
      ).to.be.instanceOf(TransactionOutcomeUnknownError);
    });

    it('becomes locked when the lookup finds the transaction', async function () {
      const f = fakeDeps({
        send: () => SERVER_ERROR,
        lookup: () => ({ hash: HASH.toUpperCase() })
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'sent', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionLockedError
      );
      // Locked: no further lookups after the first.
      expect(f.lookups).to.have.length(1);
    });
  });

  describe('state rules', function () {
    it('never goes back from locked to unknown', async function () {
      const f = fakeDeps({
        send: index => (index === 0 ? LOCKED : SERVER_ERROR)
      });
      expect(
        await caught(
          runSettle(AUTHORIZED, 'clean', {}, f.deps)
        )
      ).to.be.instanceOf(TransactionLockedError);
    });

    it('does not count a receipt or a transaction for another hash as found', async function () {
      const f = fakeDeps({
        send: () => SERVER_ERROR,
        receipt: () => ({
          ...RECEIPT,
          transaction_hash: OTHER
        }),
        lookup: () => ({ hash: OTHER })
      });
      expect(
        await caught(
          runSettle(AUTHORIZED, 'sent', {}, f.deps)
        )
      ).to.be.instanceOf(TransactionOutcomeUnknownError);
    });
  });

  describe('schedule', function () {
    it('resends every 70 s until the deadline', async function () {
      const f = fakeDeps({ send: () => LOCKED });
      await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(f.sends).to.deep.equal(RESEND_TIMES);
    });

    it('polls from 1 s, doubling to 10 s', async function () {
      const f = fakeDeps({});
      await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );
      expect(f.waits.slice(0, 6)).to.deep.equal([
        1_000, 2_000, 4_000, 8_000, 10_000, 10_000
      ]);
    });

    it('polls the receipt once more at the deadline', async function () {
      const f = fakeDeps({
        receipt: t => (t === 5_000 ? RECEIPT : NOT_FOUND)
      });
      const settled = await runSettle(
        AUTHORIZED,
        'clean',
        { deadlineMs: 5_000 },
        f.deps
      );
      expect(settled.receipt).to.equal(RECEIPT);
      expect(f.receipts).to.deep.equal([
        0, 1_000, 3_000, 5_000
      ]);
    });

    it('stops at the deadline with the last known state', async function () {
      const f = fakeDeps({});
      const error = await caught(
        runSettle(
          AUTHORIZED,
          'clean',
          { deadlineMs: 5_000 },
          f.deps
        )
      );

      expect(error).to.be.instanceOf(
        TransactionLockedError
      );
      // The last sleep is cut short at the deadline.
      expect(
        f.waits.reduce((a, b) => a + b, 0)
      ).to.equal(5_000);
    });
  });

  describe('nonce used (nonce_too_low)', function () {
    const GRACE = SETTLE_DEFAULTS.nonceUsedGraceMs;

    it('stops resending and resolves when the receipt appears', async function () {
      const f = fakeDeps({
        send: () => NONCE_TOO_LOW,
        receipt: t => (t >= 2_000 ? RECEIPT : NOT_FOUND)
      });
      const settled = await runSettle(
        AUTHORIZED,
        'sent',
        {},
        f.deps
      );

      expect(settled.receipt).to.equal(RECEIPT);
      expect(f.sends).to.deep.equal([0]);
    });

    it('ends unknown at the grace cap when the receipt reads keep failing, after one last poll', async function () {
      const f = fakeDeps({
        send: () => NONCE_TOO_LOW,
        receipt: () => readError(500, { message: 'x' })
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'sent', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(f.sends).to.deep.equal([0]);
      expect(f.receipts[f.receipts.length - 1]).to.equal(
        GRACE
      );
      expect(
        f.waits.reduce((a, b) => a + b, 0)
      ).to.equal(GRACE);
    });

    it('ends unknown, not locked, after a nonce answer even when a lookup had found it', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? ACCEPTED : NONCE_TOO_LOW,
        lookup: () => ({ hash: HASH })
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(error).to.have.property('endReason', 'nonce_used');
      expect(f.sends).to.deep.equal([0, 70_000]);
      // Three receipt 404s after the nonce answer.
      expect(f.receipts.slice(-3)).to.deep.equal([
        71_000, 72_000, 73_000
      ]);
    });

    it('reads only the receipt after a nonce_too_low first send of submitAndSettle, and ends unknown', async function () {
      // The SDK does not know whether these bytes were sent
      // before: this transaction may have used the nonce.
      const f = fakeDeps({ send: () => NONCE_TOO_LOW });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(error).to.have.property('endReason', 'nonce_used');
      expect(observationsOf(error)[0]).to.include({
        request: 'send',
        problemType: NONCE_TOO_LOW.problemType
      });
      expect(f.sends).to.deep.equal([0]);
      expect(f.lookups).to.deep.equal([]);
      expect(f.receipts).to.deep.equal([0, 1_000, 2_000]);
    });

    it('resolves after a nonce_too_low first send of submitAndSettle when the receipt exists', async function () {
      const f = fakeDeps({
        send: () => NONCE_TOO_LOW,
        receipt: () => RECEIPT
      });
      const settled = await runSettle(
        AUTHORIZED,
        'clean',
        {},
        f.deps
      );

      expect(settled.receipt).to.equal(RECEIPT);
      expect(f.sends).to.deep.equal([0]);
    });

    it('cuts the grace cap at the deadline', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR : NONCE_TOO_LOW,
        receipt: () => readError(500, { message: 'x' })
      });
      const error = await caught(
        runSettle(
          AUTHORIZED,
          'sent',
          { deadlineMs: 1_500 },
          f.deps
        )
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      // settle sends at once; the probe at 1 s gets the
      // nonce answer.
      expect(f.sends).to.deep.equal([0, 1_000]);
      expect(error).to.have.property('endReason', 'nonce_used');
      expect(f.receipts[f.receipts.length - 1]).to.equal(
        1_500
      );
    });

    it('reads only the receipt after the nonce answer, even when a lookup would find the hash', async function () {
      // A node can still hold a stale H in its pool after
      // another transaction used the nonce.
      const f = fakeDeps({
        send: () => NONCE_TOO_LOW,
        lookup: t => (t > 0 ? { hash: HASH } : NOT_FOUND)
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'sent', {}, f.deps)
      );

      // A lookup after the nonce answer would have made it
      // locked.
      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(f.lookups).to.deep.equal([0]);
      expect(f.sends).to.deep.equal([0]);
    });

    it('cuts a throttle back-off at the end of the grace window', async function () {
      const f = fakeDeps({
        send: () => NONCE_TOO_LOW,
        receipt: () =>
          readError(429, '<html>Too Many Requests</html>')
      });
      await caught(
        runSettle(AUTHORIZED, 'sent', {}, f.deps)
      );

      expect(f.sends).to.deep.equal([0]);
      expect(f.receipts).to.deep.equal([0, 60_000, GRACE]);
    });

    it('uses nonceUsedGraceMs', async function () {
      const f = fakeDeps({
        send: () => NONCE_TOO_LOW,
        receipt: () => readError(500, { message: 'x' })
      });
      await caught(
        runSettle(
          AUTHORIZED,
          'sent',
          { nonceUsedGraceMs: 5_000 },
          f.deps
        )
      );

      expect(f.sends).to.deep.equal([0]);
      expect(f.receipts[f.receipts.length - 1]).to.equal(
        5_000
      );
    });

    for (const [name, outcome] of [
      ['a legacy body without type', LEGACY_NONCE_TOO_LOW],
      [
        'a type that is not the exact URI',
        { ...NONCE_TOO_LOW, problemType: 'nonce_too_low' }
      ],
      [
        'the same identifier under another prefix',
        {
          ...NONCE_TOO_LOW,
          problemType:
            'https://example.com/problem/nonce_too_low'
        }
      ],
      [
        'a type with the URI as a prefix only',
        {
          ...NONCE_TOO_LOW,
          problemType: `${TYPE_PREFIX}nonce_too_low_v2`
        }
      ]
    ] as const) {
      it(`keeps the resend schedule for ${name}`, async function () {
        const f = fakeDeps({
          send: () => outcome as SubmitOutcome,
          lookup: () => ({ hash: HASH })
        });
        await caught(
          runSettle(AUTHORIZED, 'sent', {}, f.deps)
        );

        expect(f.sends).to.deep.equal(RESEND_TIMES);
      });
    }

    it('keeps the R2 rules for any answers and lookups (property)', async function () {
      const LEGACY_STATE_REFUSAL: SubmitOutcome = {
        kind: 'unknown',
        status: 422,
        data: {
          error_code: 'business_transaction_failed',
          message:
            'Transaction processing failed: insufficient balance'
        }
      };
      const BYTES: SubmitOutcome = {
        ...REJECTED,
        refusal: 'bytes'
      };
      const CHECK_STATUS_4XX: SubmitOutcome = {
        kind: 'unknown',
        status: 409,
        data: {},
        action: 'check_status'
      };
      const outcomes = [
        ACCEPTED,
        LOCKED,
        SERVER_ERROR,
        NONCE_TOO_LOW,
        LEGACY_NONCE_TOO_LOW,
        REJECTED,
        RETRY_LATER,
        LEGACY_STATE_REFUSAL,
        BYTES,
        CHECK_STATUS_4XX
      ];
      const FOUND = { hash: HASH };
      const reads = [
        NOT_FOUND,
        FOUND,
        readError(500, { message: 'x' }),
        readError(429, '<html>Too Many Requests</html>')
      ];
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<'clean' | 'sent'>(
            'clean',
            'sent'
          ),
          fc.array(fc.constantFrom(...outcomes), {
            minLength: 1,
            maxLength: 6
          }),
          fc.array(fc.constantFrom(...reads), {
            minLength: 1,
            maxLength: 12
          }),
          async (start, script, lookups) => {
            const f = fakeDeps({
              send: index =>
                script[Math.min(index, script.length - 1)],
              lookup: () =>
                lookups[
                  Math.min(
                    f.lookups.length - 1,
                    lookups.length - 1
                  )
                ]
            });
            const error = await caught(
              runSettle(AUTHORIZED, start, {}, f.deps)
            );
            const answer = (index: number) =>
              script[Math.min(index, script.length - 1)];
            const lookupAnswer = (index: number) =>
              lookups[Math.min(index, lookups.length - 1)];
            // A send or a found lookup before send i. The
            // first lookup of submitAndSettle comes after
            // its first send, at the same time.
            const admittedBefore = (i: number) =>
              f.sends
                .slice(0, i)
                .some(
                  (_, j) =>
                    answer(j).kind === 'accepted' ||
                    answer(j).kind === 'locked'
                ) ||
              (!(start === 'clean' && i === 0) &&
                f.lookups.some(
                  (t, k) =>
                    t <= f.sends[i] &&
                    lookupAnswer(k) === FOUND
                ));
            // The only answers that end a run as rejected:
            // (a) any rejection of the first send; (b) a
            // refusal of the bytes while no node is known
            // to have admitted the transaction.
            const endsRejected = (i: number) => {
              const o = answer(i);
              return (
                o.kind === 'rejected' &&
                ((start === 'clean' && i === 0) ||
                  (o.refusal === 'bytes' && !admittedBefore(i)))
              );
            };

            const stop = f.sends.findIndex((_, i) =>
              endsRejected(i)
            );
            if (stop >= 0) {
              expect(error).to.be.instanceOf(
                TransactionSubmissionError
              );
              expect(f.sends).to.have.length(stop + 1);
              return;
            }
            expect(error).to.not.be.instanceOf(
              TransactionSubmissionError
            );
            // No send after a nonce_too_low answer.
            const used = f.sends.findIndex(
              (_, index) => answer(index) === NONCE_TOO_LOW
            );
            if (used >= 0) {
              expect(f.sends).to.have.length(used + 1);
            }
            // A throttled send delivers nothing.
            const delivered = f.sends.filter(
              (_, index) =>
                !(
                  answer(index).kind === 'rejected' &&
                  (answer(index) === RETRY_LATER ||
                    (answer(index) as { status?: number })
                      .status === 429)
                )
            );
            // At most three delivered probes: no gate send
            // is due within 70 s of the first delivered send.
            const firstDelivered = delivered[0] ?? 0;
            expect(
              delivered.filter(
                t =>
                  t > firstDelivered &&
                  t < firstDelivered + 70_000
              )
            ).to.have.length.at.most(3);

            const observations = observationsOf(error);
            const lockedSeen = observations.some(
              o =>
                (o.request === 'lookup' &&
                  o.result === 'found') ||
                (o.request === 'send' &&
                  o.result === 'locked')
            );
            const reason = (error as { endReason?: unknown })
              .endReason;
            expect(error).to.be.instanceOf(
              lockedSeen && reason !== 'nonce_used'
                ? TransactionLockedError
                : TransactionOutcomeUnknownError
            );
            expect([
              'deadline',
              'nonce_used',
              'not_found_after_probes'
            ]).to.include(reason);
            if (reason === 'not_found_after_probes') {
              // The first send and three probes reached a
              // node.
              expect(delivered).to.have.length.at.least(4);
              const lastLookups = observations
                .filter(o => o.request === 'lookup')
                .slice(-3);
              expect(
                lastLookups.map(o => o.result)
              ).to.deep.equal([
                'not_found',
                'not_found',
                'not_found'
              ]);
            }
            if (reason === 'nonce_used') {
              expect(used).to.be.at.least(0);
            }
          }
        ),
        { numRuns: 2000 }
      );
    });
  });

  describe('throttling (429 or retry_later on a lookup)', function () {
    const THROTTLED = readError(429, '<html>Too Many Requests</html>');

    it('skips the second lookup, keeps the state, and backs off', async function () {
      const f = fakeDeps({
        send: () => SERVER_ERROR,
        receipt: t => (t === 0 ? THROTTLED : NOT_FOUND)
      });
      const error = await caught(
        runSettle(
          AUTHORIZED,
          'sent',
          { deadlineMs: 120_000 },
          f.deps
        )
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      // No lookup in the throttled pass at t = 0.
      expect(f.lookups[0]).to.be.above(0);
      expect(f.waits[0]).to.equal(
        SETTLE_DEFAULTS.throttleBackoffMs
      );
      // After the back-off: the maximum poll interval.
      expect(f.waits[1]).to.equal(
        SETTLE_DEFAULTS.maxPollIntervalMs
      );
      expect(observationsOf(error)[0]).to.include({
        request: 'receipt',
        result: 'throttled',
        status: 429
      });
    });

    it('treats a retry_later answer with any status as throttled', async function () {
      const retryLater = readError(503, {
        type: `${TYPE_PREFIX}node_syncing`,
        action: 'retry_later'
      });
      // On the receipt: no lookup in that pass.
      const onReceipt = fakeDeps({
        send: () => SERVER_ERROR,
        receipt: t => (t === 0 ? retryLater : NOT_FOUND)
      });
      const error = await caught(
        runSettle(
          AUTHORIZED,
          'sent',
          { deadlineMs: 120_000 },
          onReceipt.deps
        )
      );
      expect(onReceipt.waits[0]).to.equal(
        SETTLE_DEFAULTS.throttleBackoffMs
      );
      expect(onReceipt.lookups[0]).to.be.above(0);
      expect(observationsOf(error)[0]).to.include({
        result: 'throttled',
        status: 503,
        action: 'retry_later'
      });

      // On the lookup: the receipt was a plain 404.
      const onLookup = fakeDeps({
        send: () => SERVER_ERROR,
        lookup: t => (t === 0 ? retryLater : NOT_FOUND)
      });
      await caught(
        runSettle(
          AUTHORIZED,
          'sent',
          { deadlineMs: 120_000 },
          onLookup.deps
        )
      );
      expect(onLookup.waits[0]).to.equal(
        SETTLE_DEFAULTS.throttleBackoffMs
      );
    });

    it('records a read that failed for another reason as failed, not not_found', async function () {
      const f = fakeDeps({
        send: () => SERVER_ERROR,
        receipt: () =>
          readError(500, { message: 'system error' })
      });
      const error = await caught(
        runSettle(
          AUTHORIZED,
          'sent',
          { deadlineMs: 1_000 },
          f.deps
        )
      );
      expect(observationsOf(error)[0]).to.include({
        request: 'receipt',
        result: 'failed',
        status: 500
      });
      // A failed read is not throttled: normal polling.
      expect(f.waits[0]).to.equal(1_000);
    });

    it('keeps the resend schedule during a back-off', async function () {
      const f = fakeDeps({
        send: () => LOCKED,
        receipt: () => THROTTLED
      });
      await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );
      // Every pass is throttled (60 s back-off), and the
      // resends still go out exactly on the gate.
      expect(f.sends).to.deep.equal(RESEND_TIMES);
    });
  });

  describe('throttling (429 or retry_later on a send)', function () {
    const FIREWALL_429: SubmitOutcome = {
      kind: 'rejected',
      refusal: 'request',
      status: 429,
      data: '<html>Too Many Requests</html>',
      nodeMessage: 'Request failed with status code 429'
    };

    it('counts a throttled send as not delivered: no early end, a send every 60 s', async function () {
      const f = fakeDeps({ send: () => RETRY_LATER });
      const error = await caught(
        runSettle(AUTHORIZED, 'sent', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(error).to.have.property('endReason', 'deadline');
      expect(f.sends).to.deep.equal(
        Array.from({ length: 15 }, (_, k) => k * 60_000)
      );
    });

    it('holds a probe for 60 s after a throttled probe, then probes and ends early', async function () {
      const f = fakeDeps({
        send: index => (index === 1 ? FIREWALL_429 : ACCEPTED)
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.have.property(
        'endReason',
        'not_found_after_probes'
      );
      expect(f.sends.slice(0, 3)).to.deep.equal([
        0, 1_000, 61_000
      ]);
      // The first send and three delivered probes.
      expect(f.sends).to.have.length(5);
      // During the hold a 404 does not speed up the polls.
      expect(
        f.lookups.filter(t => t > 1_000 && t < 61_000)
      ).to.have.length.at.most(10);
    });

    it('counts a 429 that asks to check the status as delivered', async function () {
      const f = fakeDeps({
        send: index =>
          index === 1
            ? {
                kind: 'unknown',
                status: 429,
                data: {},
                action: 'check_status'
              }
            : ACCEPTED
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.have.property(
        'endReason',
        'not_found_after_probes'
      );
      expect(f.sends).to.deep.equal([
        0, 1_000, 3_000, 7_000
      ]);
    });

    it('resends 60 s after a throttled gate send, and keeps polling the receipt', async function () {
      const f = fakeDeps({
        send: index => (index === 1 ? FIREWALL_429 : LOCKED),
        receipt: t => (t >= 150_000 ? RECEIPT : NOT_FOUND)
      });
      const settled = await runSettle(
        AUTHORIZED,
        'clean',
        {},
        f.deps
      );

      expect(settled.receipt).to.deep.equal(RECEIPT);
      expect(f.sends).to.deep.equal([0, 70_000, 130_000]);
      const gaps = f.receipts
        .slice(1)
        .map((t, i) => t - f.receipts[i]);
      expect(Math.max(...gaps)).to.be.at.most(10_000);
    });
  });

  describe('the caller cannot change what is sent', function () {
    it('resends the request it had at the start, after the caller changes the object', async function () {
      const authorized: AuthorizedTxV2 = {
        ...AUTHORIZED,
        request: { ...AUTHORIZED.request }
      };
      const f = fakeDeps({
        send: index => {
          if (index === 0) {
            Object.assign(authorized, {
              path: '/v2/transactions/other',
              request: { chain_id: 1212101, nonce: 8 },
              transactionHash: OTHER
            });
          }
          return LOCKED;
        }
      });
      await caught(
        runSettle(authorized, 'clean', {}, f.deps)
      );

      expect(f.sends).to.have.length(13);
      expect(new Set(f.sentBodies)).to.have.lengthOf(1);
      expect(f.sentBodies[0]).to.equal(
        JSON.stringify([
          AUTHORIZED.path,
          AUTHORIZED.request,
          AUTHORIZED.transactionHash
        ])
      );
    });

    it('resends the request it had at the start, after the caller changes a nested member', async function () {
      const authorized: AuthorizedTxV2 = {
        ...AUTHORIZED,
        request: {
          ...AUTHORIZED.request,
          authorization: { r: '0x01', s: '0x02', v: 0 }
        }
      };
      const f = fakeDeps({
        send: index => {
          if (index === 0) {
            (
              authorized.request.authorization as {
                r: string;
              }
            ).r = '0x03';
          }
          return LOCKED;
        }
      });
      await caught(
        runSettle(authorized, 'clean', {}, f.deps)
      );

      expect(f.sends).to.have.length(13);
      expect(new Set(f.sentBodies)).to.have.lengthOf(1);
      expect(f.sentBodies[0]).to.include('"r":"0x01"');
    });
  });

  describe('deadline and request latency', function () {
    it('does not start a send after a slow lookup crosses the deadline', async function () {
      const f = fakeDeps({ lookupLatencyMs: 20 });
      const error = await caught(
        runSettle(
          AUTHORIZED,
          'sent',
          { deadlineMs: 10 },
          f.deps
        )
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(f.sends).to.deep.equal([]);
    });

    it('does not start a send when a lookup ends exactly at the deadline', async function () {
      const f = fakeDeps({ lookupLatencyMs: 10 });
      await caught(
        runSettle(
          AUTHORIZED,
          'sent',
          { deadlineMs: 10 },
          f.deps
        )
      );

      expect(f.sends).to.deep.equal([]);
    });
  });

  describe('abort and options', function () {
    it('throws the state error at once when the signal is already aborted', async function () {
      const controller = new AbortController();
      controller.abort();
      const f = fakeDeps({});
      const error = await caught(
        runSettle(
          AUTHORIZED,
          'sent',
          { signal: controller.signal },
          f.deps
        )
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(f.receipts).to.deep.equal([]);
    });

    it('does not send when aborted before the first send', async function () {
      const controller = new AbortController();
      controller.abort();
      const f = fakeDeps({});
      const error = await caught(
        runSettle(
          AUTHORIZED,
          'clean',
          { signal: controller.signal },
          f.deps
        )
      );

      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.match(
        /not sent/
      );
      expect(f.sends).to.deep.equal([]);
    });

    it('does not resend once aborted during a read', async function () {
      const controller = new AbortController();
      const f = fakeDeps({
        receipt: () => {
          controller.abort();
          return NOT_FOUND;
        }
      });
      const error = await caught(
        runSettle(
          AUTHORIZED,
          'sent',
          { signal: controller.signal },
          f.deps
        )
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(f.sends).to.deep.equal([]);
    });

    it('throws the state error when aborted during a wait', async function () {
      const controller = new AbortController();
      const f = fakeDeps({
        receipt: () => {
          controller.abort();
          return NOT_FOUND;
        }
      });
      expect(
        await caught(
          runSettle(
            AUTHORIZED,
            'clean',
            { signal: controller.signal },
            f.deps
          )
        )
      ).to.be.instanceOf(TransactionLockedError);
    });

    for (const [name, value] of [
      ['deadlineMs', 0],
      ['pollIntervalMs', -1],
      ['resendIntervalMs', Number.NaN],
      ['maxPollIntervalMs', Number.POSITIVE_INFINITY],
      ['throttleBackoffMs', 0],
      ['nonceUsedGraceMs', 0],
      ['nonceUsedGraceMs', 2_147_483_648],
      ['maxPollIntervalMs', 2_147_483_648]
    ] as const) {
      it(`rejects ${name} = ${value} before any request`, async function () {
        const f = fakeDeps({});
        const error = await caught(
          runSettle(
            AUTHORIZED,
            'clean',
            { [name]: value } as SettleOptions,
            f.deps
          )
        );

        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.match(
          new RegExp(name)
        );
        expect(f.sends).to.deep.equal([]);
      });
    }
  });

  it('keeps at most 200 observations, numbered so the dropped count shows', async function () {
    const f = fakeDeps({});
    const error = await caught(
      runSettle(
        AUTHORIZED,
        'clean',
        {
          pollIntervalMs: 1,
          maxPollIntervalMs: 1,
          deadlineMs: 1_000
        },
        f.deps
      )
    );
    const observations = observationsOf(error);

    expect(observations).to.have.length(200);
    expect(observations[0].seq).to.be.above(1);
    expect(
      observations[observations.length - 1].seq -
        observations[0].seq
    ).to.equal(199);
  });
});

// Revision R2 (3.1.1): first-send refusals, probes, the
// accepted state, the receipt-only nonce end, endReason.
describe('runSettle (R2)', function () {
  const SERVER_ERROR_500: SubmitOutcome = SERVER_ERROR;
  const STATE_REFUSAL: SubmitOutcome = {
    kind: 'unknown',
    status: 422,
    data: {
      error_code: 'business_transaction_failed',
      message:
        'Transaction processing failed: Execution admission denied: token process error: TokenProcessError: mint_address: 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed, error: Transfer failed: insufficient balance in source account'
    }
  };
  const BYTES_REFUSAL: SubmitOutcome = {
    kind: 'rejected',
    refusal: 'bytes',
    status: 422,
    data: {
      error_code: 'business_transaction_failed',
      message:
        'Transaction processing failed: Failed to recover REST envelope: invalid signature bytes'
    },
    nodeMessage:
      'Transaction processing failed: Failed to recover REST envelope: invalid signature bytes'
  };
  const LEGACY_IN_FLIGHT: SubmitOutcome = {
    kind: 'locked',
    status: 422,
    data: {
      error_code: 'business_transaction_failed',
      message:
        'Transaction processing failed: already inflight; please retry later'
    },
    legacyText: true
  };
  const LEGACY_NONCE_USED: SubmitOutcome = {
    kind: 'unknown',
    status: 422,
    data: {
      error_code: 'business_transaction_failed',
      message:
        'Transaction processing failed: nonce already used; state advanced'
    },
    nonceUsed: true
  };
  const FOUND = { hash: HASH };
  const READ_FAILED = readError(500, { message: 'system error' });

  function endReasonOf(error: unknown) {
    return (error as { endReason?: unknown }).endReason;
  }

  describe('first send of submitAndSettle (#63)', function () {
    it('throws TransactionSubmissionError at once for every rejection, with the node text', async function () {
      const FIREWALL_429: SubmitOutcome = {
        kind: 'rejected',
        refusal: 'request',
        status: 429,
        data: '<html>Too Many Requests</html>',
        nodeMessage: 'Request failed with status code 429'
      };
      for (const outcome of [
        REJECTED,
        { ...REJECTED, action: 'use_other_node' },
        RETRY_LATER,
        FIREWALL_429
      ] as SubmitOutcome[]) {
        const f = fakeDeps({ send: () => outcome });
        const error = await caught(
          runSettle(AUTHORIZED, 'clean', {}, f.deps)
        );

        expect(error).to.be.instanceOf(
          TransactionSubmissionError
        );
        if (outcome.kind !== 'rejected') {
          throw new Error('fixture is not rejected');
        }
        expect(error).to.include({
          status: outcome.status,
          action: outcome.action
        });
        expect((error as Error).message).to.include(
          outcome.nodeMessage
        );
        expect(f.sends).to.deep.equal([0]);
        expect(f.receipts).to.deep.equal([]);
      }
    });

    it('settles after a released node state refusal: it reads as unknown (UC17)', async function () {
      const f = fakeDeps({ send: () => STATE_REFUSAL });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(endReasonOf(error)).to.equal(
        'not_found_after_probes'
      );
      expect(f.sends).to.deep.equal([
        0, 1_000, 3_000, 7_000
      ]);
      expect(observationsOf(error)[0].message).to.include(
        'insufficient balance in source account'
      );
    });

    it('reads only the receipt after a nonce answer of either node kind', async function () {
      for (const outcome of [
        NONCE_TOO_LOW,
        LEGACY_NONCE_USED
      ]) {
        const f = fakeDeps({ send: () => outcome });
        const error = await caught(
          runSettle(AUTHORIZED, 'clean', {}, f.deps)
        );

        expect(error).to.be.instanceOf(
          TransactionOutcomeUnknownError
        );
        expect(endReasonOf(error)).to.equal('nonce_used');
        expect(f.sends).to.deep.equal([0]);
        expect(f.lookups).to.deep.equal([]);
      }
    });

    it('settles after a check_status 4xx: it can follow an earlier send of the same bytes', async function () {
      const f = fakeDeps({
        send: () => ({
          kind: 'unknown',
          status: 409,
          data: {},
          action: 'check_status',
          problemType: `${TYPE_PREFIX}sender_locked_by_other_transaction`
        })
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(endReasonOf(error)).to.equal(
        'not_found_after_probes'
      );
      expect(f.sends).to.deep.equal([
        0, 1_000, 3_000, 7_000
      ]);
    });

    it('never resends at once: a read comes first, and the next send waits at least 1 s', async function () {
      for (const first of [
        ACCEPTED,
        LOCKED,
        SERVER_ERROR_500,
        STATE_REFUSAL,
        NONCE_TOO_LOW,
        { kind: 'unknown', status: 408, data: {} },
        {
          kind: 'unknown',
          status: 409,
          data: {},
          action: 'check_status'
        }
      ] as SubmitOutcome[]) {
        const f = fakeDeps({
          send: index => (index === 0 ? first : ACCEPTED)
        });
        await caught(
          runSettle(AUTHORIZED, 'clean', {}, f.deps)
        );

        expect(f.receipts[0]).to.equal(0);
        if (f.sends.length > 1) {
          expect(f.sends[1]).to.be.at.least(1_000);
        }
      }
    });

    it('does not throw for a 408, a 5xx, a timeout, or in_progress for another hash', async function () {
      for (const outcome of [
        { kind: 'unknown', status: 408, data: {} },
        SERVER_ERROR_500,
        { kind: 'unknown' },
        {
          kind: 'unknown',
          status: 422,
          data: {},
          action: 'in_progress'
        }
      ] as SubmitOutcome[]) {
        const f = fakeDeps({
          send: index => (index === 0 ? outcome : ACCEPTED),
          lookup: () => FOUND,
          receipt: t => (t >= 2_000 ? RECEIPT : NOT_FOUND)
        });
        const settled = await runSettle(
          AUTHORIZED,
          'clean',
          {},
          f.deps
        );
        expect(settled.receipt).to.deep.equal(RECEIPT);
      }
    });

    it('is locked after a legacy in-flight text, with no action in the log (UC19)', async function () {
      const f = fakeDeps({
        send: () => LEGACY_IN_FLIGHT,
        receipt: t => (t >= 75_000 ? RECEIPT : NOT_FOUND)
      });
      await runSettle(AUTHORIZED, 'clean', {}, f.deps);

      expect(f.lookups).to.deep.equal([]);
      expect(f.sends).to.have.length(2);
      expect(f.sends[1]).to.equal(70_000);
    });
  });

  describe('refusal of the bytes on a later send (C4b, UC18)', function () {
    it('ends submitAndSettle as rejected', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR_500 : BYTES_REFUSAL
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionSubmissionError
      );
      expect(f.sends).to.deep.equal([0, 1_000]);
    });

    it('ends settle as rejected, but a refusal of the request does not', async function () {
      const bytes = fakeDeps({ send: () => BYTES_REFUSAL });
      expect(
        await caught(
          runSettle(AUTHORIZED, 'sent', {}, bytes.deps)
        )
      ).to.be.instanceOf(TransactionSubmissionError);
      expect(bytes.sends).to.deep.equal([0]);

      const request = fakeDeps({
        send: () => REJECTED,
        lookup: () => FOUND,
        receipt: t => (t >= 3_000 ? RECEIPT : NOT_FOUND)
      });
      const settled = await runSettle(
        AUTHORIZED,
        'sent',
        {},
        request.deps
      );
      expect(settled.receipt).to.deep.equal(RECEIPT);
    });
  });

  describe('probes and the probe end (C2)', function () {
    it('probes about 1 s after a lost first send, and settles (UC20)', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR_500 : ACCEPTED,
        receipt: t => (t >= 2_000 ? RECEIPT : NOT_FOUND)
      });
      const settled = await runSettle(
        AUTHORIZED,
        'clean',
        {},
        f.deps
      );

      expect(settled.receipt).to.deep.equal(RECEIPT);
      expect(f.sends).to.deep.equal([0, 1_000]);
    });

    it('probes after a 2xx when the lookup misses, and settles (C3, UC21)', async function () {
      const f = fakeDeps({
        send: () => ACCEPTED,
        receipt: t => (t >= 2_000 ? RECEIPT : NOT_FOUND)
      });
      await runSettle(AUTHORIZED, 'clean', {}, f.deps);

      expect(f.sends).to.deep.equal([0, 1_000]);
      expect(f.lookups[0]).to.equal(0);
    });

    it('ends unknown about 10 s after the first send when no node has it (UC22)', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR_500 : STATE_REFUSAL
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(endReasonOf(error)).to.equal(
        'not_found_after_probes'
      );
      expect(f.sends).to.deep.equal([
        0, 1_000, 3_000, 7_000
      ]);
      expect(f.lookups[f.lookups.length - 1]).to.equal(
        10_000
      );
      const messages = observationsOf(error)
        .filter(o => o.request === 'send')
        .map(o => o.message);
      expect(messages[1]).to.include(
        'insufficient balance in source account'
      );
    });

    it('ends unknown after the probes when a 2xx is never found', async function () {
      const f = fakeDeps({ send: () => ACCEPTED });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(endReasonOf(error)).to.equal(
        'not_found_after_probes'
      );
      expect(f.sends).to.have.length(4);
    });

    it('does not probe or end early while lookups fail, and keeps the gate schedule (UC24)', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR_500 : STATE_REFUSAL,
        lookup: () => READ_FAILED
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(endReasonOf(error)).to.equal('deadline');
      expect(f.sends).to.deep.equal(RESEND_TIMES);
    });

    it('starts the miss count again after a failed lookup', async function () {
      // Probes at 1, 3, 7 s; one failed lookup at 9 s.
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR_500 : STATE_REFUSAL,
        lookup: t => (t === 9_000 ? READ_FAILED : NOT_FOUND)
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(endReasonOf(error)).to.equal(
        'not_found_after_probes'
      );
      expect(f.lookups[f.lookups.length - 1]).to.be.above(
        10_000
      );
    });

    it('becomes locked when a lookup finds it after the probes, and does not end early (UC25)', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR_500 : STATE_REFUSAL,
        lookup: t => (t >= 8_000 ? FOUND : NOT_FOUND)
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(TransactionLockedError);
      expect(endReasonOf(error)).to.equal('deadline');
      // The gate schedule starts again when locked (8 s).
      expect(f.sends.slice(4, 6)).to.deep.equal([
        78_000, 148_000
      ]);
    });

    it('never probes once locked by the first send', async function () {
      const f = fakeDeps({ send: () => LOCKED });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(TransactionLockedError);
      expect(f.lookups).to.deep.equal([]);
      expect(f.sends).to.deep.equal(RESEND_TIMES);
    });

    it('settle resends at once, then probes', async function () {
      const f = fakeDeps({ send: () => STATE_REFUSAL });
      const error = await caught(
        runSettle(AUTHORIZED, 'sent', {}, f.deps)
      );

      expect(endReasonOf(error)).to.equal(
        'not_found_after_probes'
      );
      expect(f.sends).to.deep.equal([
        0, 1_000, 3_000, 7_000
      ]);
    });
  });

  describe('nonce end: the receipt alone decides (R1, UC23)', function () {
    for (const [name, nonceAnswer] of [
      ['the nonce_too_low type', NONCE_TOO_LOW],
      ['a legacy nonce text', LEGACY_NONCE_USED]
    ] as const) {
      it(`ends unknown after 3 receipt 404s for ${name}`, async function () {
        const f = fakeDeps({
          send: index =>
            index === 0 ? SERVER_ERROR_500 : nonceAnswer
        });
        const error = await caught(
          runSettle(AUTHORIZED, 'clean', {}, f.deps)
        );

        expect(error).to.be.instanceOf(
          TransactionOutcomeUnknownError
        );
        expect(endReasonOf(error)).to.equal('nonce_used');
        expect(f.sends).to.deep.equal([0, 1_000]);
        // No lookup after the nonce answer.
        expect(
          f.lookups.filter(t => t > 1_000)
        ).to.deep.equal([]);
        expect(f.receipts.slice(-3)).to.deep.equal([
          2_000, 3_000, 4_000
        ]);
      });
    }

    it('resolves when the receipt appears', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR_500 : NONCE_TOO_LOW,
        receipt: t => (t >= 3_000 ? RECEIPT : NOT_FOUND)
      });
      const settled = await runSettle(
        AUTHORIZED,
        'clean',
        {},
        f.deps
      );
      expect(settled.receipt).to.deep.equal(RECEIPT);
    });

    it('ends at nonceUsedGraceMs when the receipt reads keep failing', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR_500 : NONCE_TOO_LOW,
        receipt: () => READ_FAILED
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(endReasonOf(error)).to.equal('nonce_used');
      expect(f.receipts[f.receipts.length - 1]).to.equal(
        1_000 + SETTLE_DEFAULTS.nonceUsedGraceMs
      );
    });

    it('ends unknown with nonce_used when the first send was locked', async function () {
      const f = fakeDeps({
        send: index => (index === 0 ? LOCKED : NONCE_TOO_LOW)
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(endReasonOf(error)).to.equal('nonce_used');
      expect(f.sends).to.deep.equal([0, 70_000]);
    });
  });

  describe('endReason', function () {
    it('is deadline for a locked run, and aborted for an abort', async function () {
      const locked = fakeDeps({});
      expect(
        endReasonOf(
          await caught(
            runSettle(AUTHORIZED, 'clean', {}, locked.deps)
          )
        )
      ).to.equal('deadline');

      const controller = new AbortController();
      const aborted = fakeDeps({
        send: index => {
          if (index === 0) controller.abort();
          return LOCKED;
        }
      });
      expect(
        endReasonOf(
          await caught(
            runSettle(
              AUTHORIZED,
              'clean',
              { signal: controller.signal },
              aborted.deps
            )
          )
        )
      ).to.equal('aborted');
    });

    it('logs the node message of each send', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR_500 : STATE_REFUSAL
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );
      const sends = observationsOf(error).filter(
        o => o.request === 'send'
      );

      expect(sends[0].message).to.equal('system error');
      expect(sends[1].message).to.include(
        'Transaction processing failed:'
      );
    });
  });

  describe('review r1 cases', function () {
    it('counts 404s toward the early end only after the last send', async function () {
      const f = fakeDeps({
        send: index => (index < 4 ? SERVER_ERROR_500 : ACCEPTED),
        lookup: t =>
          t < 8_000 || t >= 69_000 ? NOT_FOUND : READ_FAILED
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(endReasonOf(error)).to.equal(
        'not_found_after_probes'
      );
      expect(f.sends).to.deep.equal([
        0, 1_000, 3_000, 7_000, 70_000
      ]);
      // Three 404s after the 2xx at 70 s, the first 1 s
      // after it.
      expect(f.lookups.slice(-3)).to.deep.equal([
        71_000, 72_000, 73_000
      ]);
    });

    it('sends again 70 s after a gate send answered locked', async function () {
      const f = fakeDeps({
        send: index => (index === 0 ? ACCEPTED : LOCKED),
        lookup: () => READ_FAILED
      });
      await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(f.sends.slice(0, 3)).to.deep.equal([
        0, 70_000, 140_000
      ]);
    });

    it('sends once when a probe and a gate send are due together', async function () {
      const f = fakeDeps({
        send: () => SERVER_ERROR_500
      });
      await caught(
        runSettle(
          AUTHORIZED,
          'clean',
          { resendIntervalMs: 1_000 },
          f.deps
        )
      );

      expect(new Set(f.sends).size).to.equal(
        f.sends.length
      );
    });

    it('does not probe when a lookup ends at or after the deadline', async function () {
      const f = fakeDeps({
        send: () => SERVER_ERROR_500,
        lookupLatencyMs: 200
      });
      const error = await caught(
        runSettle(
          AUTHORIZED,
          'clean',
          { pollIntervalMs: 400, deadlineMs: 1_300 },
          f.deps
        )
      );

      expect(endReasonOf(error)).to.equal('deadline');
      expect(f.sends).to.deep.equal([0]);
    });

    it('does not probe once aborted during a lookup', async function () {
      const controller = new AbortController();
      const f = fakeDeps({
        send: () => SERVER_ERROR_500,
        lookup: t => {
          if (t >= 1_000) controller.abort();
          return NOT_FOUND;
        }
      });
      const error = await caught(
        runSettle(
          AUTHORIZED,
          'clean',
          { signal: controller.signal },
          f.deps
        )
      );

      expect(endReasonOf(error)).to.equal('aborted');
      expect(f.sends).to.deep.equal([0]);
    });

    it('starts the receipt count again after a failed receipt read in the nonce end', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR_500 : NONCE_TOO_LOW,
        receipt: t => (t === 3_000 ? READ_FAILED : NOT_FOUND)
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(endReasonOf(error)).to.equal('nonce_used');
      expect(f.receipts.slice(-3)).to.deep.equal([
        4_000, 5_000, 6_000
      ]);
    });

    it('starts the miss count again after a throttled lookup', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR_500 : STATE_REFUSAL,
        lookup: t =>
          t === 9_000
            ? readError(429, '<html>Too Many Requests</html>')
            : NOT_FOUND
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(endReasonOf(error)).to.equal(
        'not_found_after_probes'
      );
      expect(f.lookups[f.lookups.length - 1]).to.be.above(
        69_000
      );
    });

    it('keeps the gate schedule after a 2xx when lookups keep failing, and ends unknown', async function () {
      const f = fakeDeps({
        send: () => ACCEPTED,
        lookup: () => READ_FAILED
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(endReasonOf(error)).to.equal('deadline');
      expect(f.sends).to.deep.equal(RESEND_TIMES);
    });

    it('ends nothing on a refusal of the bytes after a 2xx: nodes disagree', async function () {
      const f = fakeDeps({
        send: index => (index === 0 ? ACCEPTED : BYTES_REFUSAL),
        lookup: () => READ_FAILED
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(endReasonOf(error)).to.equal('deadline');
    });
  });
});
