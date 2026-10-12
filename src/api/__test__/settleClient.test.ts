import { expect } from 'chai';
import 'mocha';

import { LOCAL_API_URL } from '../constants';
import { axiosStatic, setInitConfig } from '../../client';
import { TransactionLockedError } from '../errors';
import { settle, submitAndSettle } from '../settle';

import type { AuthorizedTxV2 } from '@/signing/v2';

const HASH = `0x${'ab'.repeat(32)}`;

const AUTHORIZED: AuthorizedTxV2 = {
  operation: 'payment',
  path: '/v2/transactions/payment',
  request: { chain_id: 1212101, nonce: 7 },
  transactionHash: HASH as `0x${string}`
};

const RECEIPT = {
  success: true,
  transaction_hash: HASH,
  fee_used: '1',
  from: '0x0000000000000000000000000000000000000001'
};

const FAST = {
  pollIntervalMs: 5,
  maxPollIntervalMs: 5,
  deadlineMs: 5_000
};

type Adapter = typeof axiosStatic.defaults.adapter;

// The real dependencies (client reads, sleep), with the
// HTTP adapter replaced. axiosStatic is a process-wide
// singleton, so both fields are restored afterwards.
describe('submitAndSettle and settle (real dependencies)', function () {
  let originalAdapter: Adapter;
  let originalBaseURL: string | undefined;
  let receiptReads: number;

  function answer(
    config: unknown,
    status: number,
    data: unknown
  ) {
    if (status < 400) {
      return Promise.resolve({
        data,
        status,
        statusText: 'OK',
        headers: {},
        config
      });
    }
    return Promise.reject({
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
    });
  }

  // POST answers `post`; the receipt is found on the
  // `foundOn`-th read.
  function node(post: [number, unknown], foundOn: number) {
    axiosStatic.defaults.adapter = (config => {
      if (config.method === 'post') {
        return answer(config, post[0], post[1]);
      }
      if (String(config.url).includes('/receipt/')) {
        receiptReads += 1;
        return receiptReads >= foundOn
          ? answer(config, 200, RECEIPT)
          : answer(config, 404, {
              action: 'check_status'
            });
      }
      return answer(config, 404, {
        action: 'check_status'
      });
    }) as Adapter;
  }

  before(function () {
    originalAdapter = axiosStatic.defaults.adapter;
    originalBaseURL = axiosStatic.defaults.baseURL;
    axiosStatic.defaults.baseURL = LOCAL_API_URL;
  });

  after(function () {
    axiosStatic.defaults.adapter = originalAdapter;
    axiosStatic.defaults.baseURL = originalBaseURL;
  });

  beforeEach(function () {
    receiptReads = 0;
  });

  it('submitAndSettle sends once and resolves with the receipt', async function () {
    node([200, { hash: HASH }], 3);
    const settled = await submitAndSettle(
      AUTHORIZED,
      FAST
    );
    expect(settled).to.deep.equal({
      transactionHash: HASH,
      receipt: RECEIPT
    });
    expect(receiptReads).to.equal(3);
  });

  it('settle reads the same way when the client resolves errors (global onError)', async function () {
    setInitConfig({
      baseURL: LOCAL_API_URL,
      onError: (err: unknown) => err
    });
    try {
      node(
        [
          422,
          {
            action: 'in_progress',
            tx_hash: HASH
          }
        ],
        2
      );
      const settled = await settle(AUTHORIZED, FAST);
      expect(settled.receipt).to.deep.equal(RECEIPT);
    } finally {
      setInitConfig({
        baseURL: originalBaseURL,
        onError: undefined
      });
      axiosStatic.defaults.baseURL = LOCAL_API_URL;
    }
  });

  it('stops a wait at once on abort', async function () {
    node([200, { hash: HASH }], 1_000);
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 20);
    let caught: unknown;
    try {
      await submitAndSettle(AUTHORIZED, {
        pollIntervalMs: 10_000,
        signal: controller.signal
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(
      TransactionLockedError
    );
    expect(Date.now() - started).to.be.below(2_000);
  });
});
