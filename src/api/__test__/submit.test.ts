import { expect } from 'chai';
import 'mocha';

import { LOCAL_API_URL } from '../constants';
import { axiosStatic } from '../../client';
import { TransactionHashMismatchError } from '../errors';
import { submitAuthorized } from '../submit';

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
    await submitAuthorized(AUTHORIZED);
    expect(seenUrl).to.equal(
      '/v2/transactions/payment'
    );
    expect(seenBody).to.deep.equal(
      AUTHORIZED.request
    );
  });

  it('resolves when the hashes match, ignoring case', async function () {
    respondWith(LOCAL_HASH.toUpperCase());
    const response =
      await submitAuthorized(AUTHORIZED);
    expect(
      response.hash.toLowerCase()
    ).to.equal(LOCAL_HASH);
  });

  it('rejects, flagged as submitted, when the node returns a different hash', async function () {
    const serverHash = `0x${'cd'.repeat(32)}`;
    respondWith(serverHash);

    let caught: unknown;
    try {
      await submitAuthorized(AUTHORIZED);
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
});
