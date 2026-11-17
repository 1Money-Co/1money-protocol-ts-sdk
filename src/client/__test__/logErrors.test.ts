import { expect } from 'chai';
import 'mocha';

import Request from '../core';

import type { AxiosAdapter } from 'axios';

function rejectWith(status: number): AxiosAdapter {
  return config =>
    Promise.reject({
      message: `Request failed with status code ${status}`,
      name: 'AxiosError',
      status,
      config,
      response: {
        status,
        statusText: 'Error',
        headers: {},
        config,
        data: { action: 'check_status' }
      }
    });
}

const networkError: AxiosAdapter = config =>
  Promise.reject({
    message: 'Network Error',
    name: 'AxiosError',
    code: 'ERR_NETWORK',
    config
  });

// A custom adapter may reject with `response: null`; stock adapters
// omit `response` when no response came.
const nullResponse: AxiosAdapter = config =>
  Promise.reject({
    message: 'Custom adapter error',
    name: 'AxiosError',
    config,
    response: null
  });

const neverAnswers: AxiosAdapter = config =>
  new Promise((_resolve, reject) => {
    config.signal?.addEventListener?.('abort', () =>
      reject({
        message: 'canceled',
        name: 'CanceledError',
        code: 'ERR_CANCELED',
        config
      })
    );
  });

describe('quietStatuses request option', function () {
  const originalError = console.error;
  let logged: unknown[][];

  beforeEach(function () {
    logged = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
  });

  afterEach(function () {
    console.error = originalError;
  });

  async function rejectedRead(
    adapter: AxiosAdapter,
    quietStatuses?: readonly number[]
  ) {
    await new Request()
      .request({
        method: 'get',
        url: 'http://node.invalid/v1/transactions/receipt/by_hash',
        adapter,
        ...(quietStatuses && { quietStatuses })
      })
      .catch((error: unknown) => error);
  }

  it('logs nothing for a rejection with a quiet status', async function () {
    await rejectedRead(rejectWith(404), [404]);
    expect(logged).to.deep.equal([]);
  });

  it('still logs a rejection whose status is not quiet', async function () {
    await rejectedRead(rejectWith(500), [404]);
    expect(logged).to.have.length(1);
    expect(String(logged[0][0])).to.contain(
      '[1Money SDK]: Error(500'
    );
  });

  it('still logs a network error, which has no status', async function () {
    await rejectedRead(networkError, [404]);
    expect(logged).to.have.length(1);
  });

  it('settles and logs a rejection whose response is null', async function () {
    this.timeout(2000);
    const error = await new Request()
      .request({
        method: 'get',
        url: 'http://node.invalid/v1/transactions/receipt/by_hash',
        adapter: nullResponse,
        quietStatuses: [404]
      })
      .catch((caught: unknown) => caught);
    expect(error).to.include({ status: 500 });
    expect(logged).to.have.length(1);
  });

  it('logs nothing when the request timeout expires', async function () {
    let timedOut = false;
    await new Request()
      .request({
        method: 'get',
        url: 'http://node.invalid/v1/transactions/receipt/by_hash',
        adapter: neverAnswers,
        timeout: 20
      })
      .timeout(() => {
        timedOut = true;
      });
    expect(timedOut).to.equal(true);
    expect(logged).to.deep.equal([]);
  });

  it('still logs a 404 without the option', async function () {
    await rejectedRead(rejectWith(404));
    expect(logged).to.have.length(1);
    expect(String(logged[0][0])).to.contain(
      '[1Money SDK]: Error(404'
    );
  });
});
