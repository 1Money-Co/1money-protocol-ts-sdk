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

  it('still logs a 404 without the option', async function () {
    await rejectedRead(rejectWith(404));
    expect(logged).to.have.length(1);
    expect(String(logged[0][0])).to.contain(
      '[1Money SDK]: Error(404'
    );
  });
});
