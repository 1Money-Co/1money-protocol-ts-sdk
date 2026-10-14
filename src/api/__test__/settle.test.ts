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
  status: 400,
  data: { error_code: 'validation_invalid_signature' },
  nodeMessage: 'bad signature',
  action: 'fix_request',
  problemType: `${TYPE_PREFIX}invalid_signature`
};

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
          t >= 100_000 ? RECEIPT : NOT_FOUND
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
      // Locked after a 2xx: no lookup is needed.
      expect(f.lookups).to.deep.equal([]);
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

    it('never throws TransactionSubmissionError, even when every resend is rejected', async function () {
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
    it('resends on the node retry gate: 70 s x k after send k, five times in the deadline', async function () {
      const f = fakeDeps({ send: () => LOCKED });
      await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(f.sends).to.deep.equal([
        0, 70_000, 210_000, 420_000, 700_000
      ]);
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

    it('stops resending and resolves when the receipt appears in the grace window', async function () {
      const f = fakeDeps({
        send: () => NONCE_TOO_LOW,
        receipt: t => (t >= 30_000 ? RECEIPT : NOT_FOUND)
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

    it('ends unknown when the grace window ends, after one last receipt poll', async function () {
      const f = fakeDeps({ send: () => NONCE_TOO_LOW });
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

    it('ends locked when an earlier send was accepted', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? ACCEPTED : NONCE_TOO_LOW
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionLockedError
      );
      expect(f.sends).to.deep.equal([0, 70_000]);
      expect(f.receipts[f.receipts.length - 1]).to.equal(
        70_000 + GRACE
      );
    });

    it('rejects a nonce_too_low first send of submitAndSettle: another transaction used the nonce', async function () {
      const f = fakeDeps({ send: () => NONCE_TOO_LOW });
      const error = await caught(
        runSettle(AUTHORIZED, 'clean', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionSubmissionError
      );
      expect(error)
        .to.have.property('problemType')
        .that.equals(NONCE_TOO_LOW.problemType);
      expect(f.sends).to.deep.equal([0]);
      expect(f.receipts).to.deep.equal([]);
    });

    it('cuts the grace window at the deadline', async function () {
      const f = fakeDeps({
        send: index =>
          index === 0 ? SERVER_ERROR : NONCE_TOO_LOW
      });
      const error = await caught(
        runSettle(
          AUTHORIZED,
          'sent',
          { deadlineMs: 100_000 },
          f.deps
        )
      );

      expect(error).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(f.sends).to.deep.equal([0, 70_000]);
      expect(f.receipts[f.receipts.length - 1]).to.equal(
        100_000
      );
    });

    it('keeps looking up the hash in the grace window, and ends locked when it is found', async function () {
      const f = fakeDeps({
        send: () => NONCE_TOO_LOW,
        lookup: t =>
          t >= 10_000 ? { hash: HASH } : NOT_FOUND
      });
      const error = await caught(
        runSettle(AUTHORIZED, 'sent', {}, f.deps)
      );

      expect(error).to.be.instanceOf(
        TransactionLockedError
      );
      expect(f.lookups).to.deep.equal([
        0, 1_000, 3_000, 7_000, 15_000
      ]);
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
      const f = fakeDeps({ send: () => NONCE_TOO_LOW });
      await caught(
        runSettle(
          AUTHORIZED,
          'sent',
          { nonceUsedGraceMs: 5_000 },
          f.deps
        )
      );

      expect(f.receipts).to.deep.equal([
        0, 1_000, 3_000, 5_000
      ]);
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
          send: () => outcome as SubmitOutcome
        });
        await caught(
          runSettle(AUTHORIZED, 'sent', {}, f.deps)
        );

        expect(f.sends).to.deep.equal([
          0, 70_000, 210_000, 420_000, 700_000
        ]);
      });
    }

    it('never sends after nonce_too_low, and never rejects after the first send (property)', async function () {
      const outcomes = [
        ACCEPTED,
        LOCKED,
        SERVER_ERROR,
        NONCE_TOO_LOW,
        LEGACY_NONCE_TOO_LOW,
        REJECTED
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
          fc.integer({ min: 1, max: 200_000 }),
          async (start, script, grace) => {
            const f = fakeDeps({
              send: index =>
                script[Math.min(index, script.length - 1)]
            });
            const error = await caught(
              runSettle(
                AUTHORIZED,
                start,
                { nonceUsedGraceMs: grace },
                f.deps
              )
            );
            const rejectedFirst =
              start === 'clean' &&
              (script[0] === REJECTED ||
                script[0] === NONCE_TOO_LOW);
            const used = f.sends.findIndex(
              (_, index) =>
                script[
                  Math.min(index, script.length - 1)
                ] === NONCE_TOO_LOW
            );
            const sent = f.sends.map(
              (_, index) =>
                script[Math.min(index, script.length - 1)]
            );
            if (rejectedFirst) {
              expect(error).to.be.instanceOf(
                TransactionSubmissionError
              );
              expect(f.sends).to.have.length(1);
              expect(f.receipts).to.deep.equal([]);
              return;
            }
            if (used >= 0) {
              expect(f.sends).to.have.length(used + 1);
              expect(
                f.receipts[f.receipts.length - 1]
              ).to.equal(
                Math.min(
                  SETTLE_DEFAULTS.deadlineMs,
                  f.sends[used] + grace
                )
              );
            }
            if (
              sent.some(o => o === ACCEPTED || o === LOCKED)
            ) {
              expect(error).to.be.instanceOf(
                TransactionLockedError
              );
            } else {
              expect(error).to.be.instanceOf(
                TransactionOutcomeUnknownError
              );
            }
          }
        ),
        { numRuns: 500 }
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
      expect(f.sends).to.deep.equal([
        0, 70_000, 210_000, 420_000, 700_000
      ]);
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

      expect(f.sends).to.have.length(5);
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

      expect(f.sends).to.have.length(5);
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
