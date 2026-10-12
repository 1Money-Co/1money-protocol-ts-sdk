import { expect } from 'chai';
import 'mocha';

import { LOCAL_API_URL } from '../constants';
import { axiosStatic, setInitConfig } from '../../client';
import {
  isNativeV2NotActive,
  TransactionHashMismatchError,
  TransactionLockedError,
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from '../errors';
import {
  sendAuthorized,
  submitAuthorized
} from '../submit';

import type { AuthorizedTxV2 } from '@/signing/v2';

const LOCAL_HASH = `0x${'ab'.repeat(32)}`;

const AUTHORIZED: AuthorizedTxV2 = {
  operation: 'payment',
  path: '/v2/transactions/payment',
  request: { chain_id: 1212101, nonce: 0 },
  transactionHash: LOCAL_HASH as `0x${string}`
};

describe('submitAuthorized', function () {
  // axiosStatic.defaults is a process-wide singleton shared with
  // every other suite (they configure it once via api({ network })
  // at file-load time and never touch it again). Snapshot both
  // fields we mutate in `before` -- at the moment just prior to
  // mutation, not at file-load time, since file-load order across
  // suites is not something this test controls -- and restore them
  // in `after` so no other suite observes a different baseURL or
  // adapter than the one it configured for itself. This suite talks
  // to axiosStatic directly instead of calling api({ network }),
  // since that call is a global singleton configurator, not a
  // per-test tool: it also touches internal isSuccess/timeout state
  // this suite has no business changing.
  let originalAdapter: typeof axiosStatic.defaults.adapter;
  let originalBaseURL: string | undefined;
  let seenUrl: string | undefined;
  let seenBody: unknown;

  function respondWith(hash: string) {
    axiosStatic.defaults.adapter = (config =>
      Promise.resolve({
        data: { hash },
        status: 200,
        statusText: 'OK',
        headers: {},
        config
      })) as typeof originalAdapter;
  }

  before(function () {
    originalAdapter =
      axiosStatic.defaults.adapter;
    originalBaseURL =
      axiosStatic.defaults.baseURL;
    // Only needs to be a valid absolute URL so axios can resolve
    // the relative authorized.path -- the adapter below is mocked,
    // so no request ever actually leaves the process.
    axiosStatic.defaults.baseURL =
      LOCAL_API_URL;
  });

  after(function () {
    axiosStatic.defaults.adapter =
      originalAdapter;
    axiosStatic.defaults.baseURL =
      originalBaseURL;
  });

  beforeEach(function () {
    seenUrl = undefined;
    seenBody = undefined;
    axiosStatic.defaults.adapter = (config => {
      seenUrl = config.url;
      seenBody =
        typeof config.data === 'string'
          ? JSON.parse(config.data)
          : config.data;
      return Promise.resolve({
        data: { hash: LOCAL_HASH },
        status: 200,
        statusText: 'OK',
        headers: {},
        config
      });
    }) as typeof originalAdapter;
  });

  afterEach(function () {
    axiosStatic.defaults.adapter =
      originalAdapter;
  });

  it('posts the request body to the authorized path', async function () {
    await submitAuthorized(AUTHORIZED, 'payment');
    expect(seenUrl).to.equal(
      '/v2/transactions/payment'
    );
    expect(seenBody).to.deep.equal(
      AUTHORIZED.request
    );
  });

  it('resolves when the hashes match, ignoring case', async function () {
    respondWith(LOCAL_HASH.toUpperCase());
    const response = await submitAuthorized(
      AUTHORIZED,
      'payment'
    );
    expect(
      response.hash.toLowerCase()
    ).to.equal(LOCAL_HASH);
  });

  it('rejects, flagged as submitted, when the node returns a different hash', async function () {
    const serverHash = `0x${'cd'.repeat(32)}`;
    respondWith(serverHash);

    let caught: unknown;
    try {
      await submitAuthorized(AUTHORIZED, 'payment');
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.instanceOf(
      TransactionHashMismatchError
    );
    const err =
      caught as TransactionHashMismatchError;
    // The transaction is already on the node. A caller that
    // retries here double-spends the nonce.
    expect(err.submitted).to.equal(true);
    expect(err.serverHash).to.equal(serverHash);
    expect(err.localHash).to.equal(LOCAL_HASH);
  });

  it('rejects with an operation mismatch before making any request', async function () {
    let caught: unknown;
    try {
      await submitAuthorized(AUTHORIZED, 'tokenBurn');
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.instanceOf(Error);
    expect((caught as Error).message).to.match(
      /Expected a "tokenBurn" authorization but received "payment"/
    );
    // No request should have been sent for a rejected mismatch.
    expect(seenUrl).to.equal(undefined);
  });

  // Regression coverage for the issue-1038 follow-up bug: core.ts's
  // promise wrapper RESOLVES instead of REJECTS whenever the caller
  // has a global onError configured (existedHandler.error is then
  // true) -- see core.ts's errorHandler. Before this fix,
  // submitAuthorized treated that resolved ParsedError as a
  // hash-bearing response and threw TransactionHashMismatchError
  // (submitted: true) for a transaction that was never admitted. A
  // test that omits the global onError below would still pass
  // against the broken code, since without it the promise correctly
  // rejects -- so onError here is load-bearing, not incidental.
  describe('refused writes (global onError configured)', function () {
    let originalOnErrorAdapter: typeof axiosStatic.defaults.adapter;

    before(function () {
      originalOnErrorAdapter =
        axiosStatic.defaults.adapter;
      // setInitConfig always reassigns axiosStatic.defaults.baseURL
      // (falling back to `undefined` in Node when no baseURL is
      // given), so baseURL must be re-supplied on every call here,
      // not just once -- otherwise this describe block would wipe
      // out the baseURL every other suite in the process relies on.
      setInitConfig({
        baseURL: LOCAL_API_URL,
        onError: (err: unknown) => err
      });
    });

    after(function () {
      axiosStatic.defaults.adapter =
        originalOnErrorAdapter;
      // No other suite in this repo configures a global onError, so
      // the pre-suite value is undefined -- restore exactly that
      // (rather than leaving the identity handler above installed
      // for every later suite in this process).
      setInitConfig({
        baseURL: originalBaseURL,
        onError: undefined
      });
    });

    it('throws TransactionSubmissionError (submitted: false), not TransactionHashMismatchError', async function () {
      axiosStatic.defaults.adapter = (config =>
        Promise.reject({
          message:
            'Request failed with status code 403',
          name: 'AxiosError',
          config,
          response: {
            status: 403,
            statusText: 'Forbidden',
            headers: {},
            config,
            data: {
              error_code:
                'DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE',
              message:
                'native v2 writes are not active on this node'
            }
          }
        })) as typeof originalOnErrorAdapter;

      let caught: unknown;
      try {
        await submitAuthorized(AUTHORIZED, 'payment');
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(
        TransactionSubmissionError
      );
      const err =
        caught as TransactionSubmissionError;
      // Rejected before admission -- send again once /v2 is
      // active.
      expect(err.submitted).to.equal(false);
      expect(err.status).to.equal(403);
      expect(err.errorCode).to.equal(
        'DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE'
      );
      expect(caught).to.not.be.instanceOf(
        TransactionHashMismatchError
      );
      // isNativeV2NotActive reads `.data.error_code` -- confirm
      // TransactionSubmissionError still satisfies it exactly as a
      // raw ParsedError would have, so migration-window callers that
      // branch on it don't need to change anything.
      expect(isNativeV2NotActive(err)).to.equal(
        true
      );
    });
  });

  // Regression coverage for the round-2 finding: a 5xx with a body was
  // previously classified the same as a 4xx (TransactionSubmissionError,
  // submitted: false, "safe to retry") -- dangerous, since l1client's own
  // 500 bucket mixes pre-admission pool rejections with failures that can
  // follow a successful admission (om-api-types/src/native/error.rs
  // `http_status_code`), and a gateway 502/503/504 can just as easily
  // follow a successful admission as precede one.
  describe('ambiguous outcome for a 5xx (never trusted as refused)', function () {
    function respondWithHttpError(
      status: number,
      statusText: string
    ) {
      axiosStatic.defaults.adapter = (config =>
        Promise.reject({
          message: `Request failed with status code ${status}`,
          name: 'AxiosError',
          config,
          response: {
            status,
            statusText,
            headers: {},
            config,
            data: {
              message: 'downstream failure'
            }
          }
        })) as typeof originalAdapter;
    }

    it('throws TransactionOutcomeUnknownError for a 502 (gateway may have already admitted the write)', async function () {
      respondWithHttpError(502, 'Bad Gateway');

      let caught: unknown;
      try {
        await submitAuthorized(AUTHORIZED, 'payment');
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(
        (caught as TransactionOutcomeUnknownError)
          .submitted
      ).to.equal('unknown');
      expect(
        (caught as TransactionOutcomeUnknownError).status
      ).to.equal(502);
      expect(
        (caught as TransactionOutcomeUnknownError).data
      ).to.deep.equal({
        message: 'downstream failure'
      });
      expect(
        (
          (caught as TransactionOutcomeUnknownError)
            .cause as { status?: unknown }
        ).status
      ).to.equal(502);
      expect(caught).to.not.be.instanceOf(
        TransactionSubmissionError
      );
    });

    it('throws TransactionOutcomeUnknownError for a 500 (may be a post-pool-insertion failure)', async function () {
      respondWithHttpError(
        500,
        'Internal Server Error'
      );

      let caught: unknown;
      try {
        await submitAuthorized(AUTHORIZED, 'payment');
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(
        (caught as TransactionOutcomeUnknownError)
          .submitted
      ).to.equal('unknown');
    });

    it('throws TransactionOutcomeUnknownError for a 408 (can follow a successful admission)', async function () {
      respondWithHttpError(408, 'Request Timeout');

      let caught: unknown;
      try {
        await submitAuthorized(AUTHORIZED, 'payment');
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(
        (caught as TransactionOutcomeUnknownError)
          .submitted
      ).to.equal('unknown');
    });

    it('still throws TransactionSubmissionError for a genuine 4xx refusal (e.g. 400)', async function () {
      respondWithHttpError(400, 'Bad Request');

      let caught: unknown;
      try {
        await submitAuthorized(AUTHORIZED, 'payment');
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(
        TransactionSubmissionError
      );
      expect(
        (caught as TransactionSubmissionError)
          .submitted
      ).to.equal(false);
      expect(
        (caught as TransactionSubmissionError).status
      ).to.equal(400);
    });
  });

  // Regression coverage for the round-2 finding: core.ts's login branch
  // (src/client/core.ts) resolves with just the response body, discarding
  // the numeric HTTP status -- so a status check can never see a refusal
  // that arrived this way (e.g. a WAF/gateway 401 in front of the node).
  // Before the fix this fell through to TransactionOutcomeUnknownError
  // even though it is exactly as pre-admission as any other 4xx.
  describe('401 refused via the login branch (status discarded by core.ts)', function () {
    it('throws TransactionSubmissionError (submitted: false), not TransactionOutcomeUnknownError', async function () {
      axiosStatic.defaults.adapter = (config =>
        Promise.reject({
          message:
            'Request failed with status code 401',
          name: 'AxiosError',
          config,
          response: {
            status: 401,
            statusText: 'Unauthorized',
            headers: {},
            config,
            data: {
              code: 401,
              data: null,
              msg: 'authentication required'
            }
          }
        })) as typeof originalAdapter;

      let caught: unknown;
      try {
        await submitAuthorized(AUTHORIZED, 'payment');
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(
        TransactionSubmissionError
      );
      const err =
        caught as TransactionSubmissionError;
      expect(err.submitted).to.equal(false);
      expect(err.status).to.equal(401);
      expect(err.message).to.match(
        /authentication required/
      );
      expect(caught).to.not.be.instanceOf(
        TransactionOutcomeUnknownError
      );
    });
  });

  // Issue #49: the node answers 422 to a resend of a
  // transaction it already holds. That answer must never
  // read as "NOT submitted".
  describe('node action decides the outcome', function () {
    const TYPE_PREFIX =
      'https://developer.1moneynetwork.com/problem/';

    function respondWithProblem(
      status: number,
      data: unknown
    ) {
      axiosStatic.defaults.adapter = (config =>
        Promise.reject({
          message: `Request failed with status code ${status}`,
          name: 'AxiosError',
          config,
          response: {
            status,
            statusText: 'Error',
            headers: {},
            config,
            data
          }
        })) as typeof originalAdapter;
    }

    async function caughtFrom(): Promise<unknown> {
      try {
        await submitAuthorized(AUTHORIZED, 'payment');
      } catch (error) {
        return error;
      }
      throw new Error('expected a rejection');
    }

    const IN_FLIGHT = {
      type: `${TYPE_PREFIX}submission_already_in_flight`,
      title: 'Transaction already in flight',
      status: 422,
      instance: 'urn:uuid:0192f0c4',
      action: 'in_progress',
      tx_hash: LOCAL_HASH,
      error_code: 'business_transaction_failed',
      message:
        'Transaction processing failed: already inflight; please retry later'
    };

    it('throws TransactionLockedError, not TransactionSubmissionError, for a 422 in-flight answer', async function () {
      respondWithProblem(422, IN_FLIGHT);
      const caught = await caughtFrom();

      expect(caught).to.be.instanceOf(
        TransactionLockedError
      );
      expect(caught).to.not.be.instanceOf(
        TransactionSubmissionError
      );
      const err = caught as TransactionLockedError;
      expect(err.submitted).to.equal(true);
      expect(err.action).to.equal('in_progress');
      expect(err.transactionHash).to.equal(
        LOCAL_HASH
      );
      expect(err.status).to.equal(422);
      expect(err.data).to.deep.equal(IN_FLIGHT);
      expect(err.problemType).to.equal(
        `${TYPE_PREFIX}submission_already_in_flight`
      );
      expect(err.message).to.not.match(
        /NOT submitted|safe to retry/i
      );
    });

    it('throws TransactionOutcomeUnknownError for the legacy 422 without an action', async function () {
      respondWithProblem(422, {
        error_code: 'business_transaction_failed',
        message:
          'Transaction processing failed: already inflight; please retry later'
      });
      const caught = await caughtFrom();

      expect(caught).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(
        (caught as TransactionOutcomeUnknownError)
          .status
      ).to.equal(422);
    });

    it('throws TransactionOutcomeUnknownError with the action for check_status', async function () {
      respondWithProblem(422, {
        type: `${TYPE_PREFIX}nonce_too_low`,
        status: 422,
        action: 'check_status',
        error_code: 'business_transaction_failed'
      });
      const err =
        (await caughtFrom()) as TransactionOutcomeUnknownError;

      expect(err).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      expect(err.action).to.equal('check_status');
      expect(err.problemType).to.equal(
        `${TYPE_PREFIX}nonce_too_low`
      );
    });

    it('throws TransactionSubmissionError with the action for a no-effect action', async function () {
      respondWithProblem(400, {
        type: `${TYPE_PREFIX}invalid_signature`,
        status: 400,
        action: 'fix_request',
        error_code: 'validation_invalid_signature'
      });
      const err =
        (await caughtFrom()) as TransactionSubmissionError;

      expect(err).to.be.instanceOf(
        TransactionSubmissionError
      );
      expect(err.submitted).to.equal(false);
      expect(err.action).to.equal('fix_request');
      expect(err.problemType).to.equal(
        `${TYPE_PREFIX}invalid_signature`
      );
      expect(err.errorCode).to.equal(
        'validation_invalid_signature'
      );
      expect(err.message).to.match(
        /rejected before admission/
      );
    });

    it('gives the same error whether the client rejects or resolves', async function () {
      respondWithProblem(422, IN_FLIGHT);
      const rejected = await caughtFrom();

      setInitConfig({
        baseURL: LOCAL_API_URL,
        onError: (err: unknown) => err
      });
      try {
        respondWithProblem(422, IN_FLIGHT);
        const resolved = await caughtFrom();
        expect(resolved).to.be.instanceOf(
          TransactionLockedError
        );
        expect(
          (resolved as TransactionLockedError).message
        ).to.equal(
          (rejected as TransactionLockedError).message
        );
      } finally {
        setInitConfig({
          baseURL: originalBaseURL,
          onError: undefined
        });
        axiosStatic.defaults.baseURL = LOCAL_API_URL;
      }
    });
  });

  describe('sendAuthorized', function () {
    it('returns the outcome and does not throw for a node answer', async function () {
      axiosStatic.defaults.adapter = (config =>
        Promise.reject({
          message: 'Request failed with status code 500',
          name: 'AxiosError',
          config,
          response: {
            status: 500,
            statusText: 'Internal Server Error',
            headers: {},
            config,
            data: { message: 'system error' }
          }
        })) as typeof originalAdapter;

      const outcome = await sendAuthorized(AUTHORIZED);
      expect(outcome.kind).to.equal('unknown');
    });

    it('returns accepted with the node hash', async function () {
      respondWith(LOCAL_HASH);
      expect(
        await sendAuthorized(AUTHORIZED)
      ).to.deep.equal({
        kind: 'accepted',
        serverHash: LOCAL_HASH,
        response: { hash: LOCAL_HASH }
      });
    });
  });

  describe('ambiguous outcome (no hash in the response)', function () {
    it('throws TransactionOutcomeUnknownError, neither submitted nor safe to retry', async function () {
      axiosStatic.defaults.adapter = (config =>
        Promise.resolve({
          // A 2xx body that never carries a `hash`: genuinely
          // ambiguous -- the SDK cannot tell whether the node
          // admitted this transaction.
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config
        })) as typeof originalAdapter;

      let caught: unknown;
      try {
        await submitAuthorized(AUTHORIZED, 'payment');
      } catch (error) {
        caught = error;
      }

      expect(caught).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
      const err =
        caught as TransactionOutcomeUnknownError;
      expect(err.transactionHash).to.equal(
        LOCAL_HASH
      );
      // `submitted` is the literal string 'unknown' -- not
      // `undefined`/absent, and not `false`
      // (TransactionSubmissionError's contract). Both distinctions
      // matter:
      expect(err.submitted).to.equal('unknown');
      expect(err.submitted).to.not.equal(false);
      expect(err.submitted).to.not.equal(true);
      // The point of the change: 'unknown' must be truthy, so a
      // caller writing the natural-but-wrong `if (!err.submitted)
      // retry()` does NOT retry on the one outcome where retrying is
      // most dangerous (possibly already on-chain).
      expect(Boolean(err.submitted)).to.equal(
        true
      );
    });
  });
});
