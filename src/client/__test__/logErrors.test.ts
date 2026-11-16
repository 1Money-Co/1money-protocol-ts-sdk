import { expect } from 'chai';
import 'mocha';

import Request from '../core';

import type { AxiosAdapter } from 'axios';

const notFound: AxiosAdapter = config =>
  Promise.reject({
    message: 'Request failed with status code 404',
    name: 'AxiosError',
    status: 404,
    config,
    response: {
      status: 404,
      statusText: 'Not Found',
      headers: {},
      config,
      data: { action: 'check_status' }
    }
  });

describe('logErrors request option', function () {
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

  async function rejectedRead(logErrors?: boolean) {
    const client = new Request();
    const answer = await client
      .request({
        method: 'get',
        url: 'http://node.invalid/v1/transactions/receipt/by_hash',
        adapter: notFound,
        ...(logErrors === undefined ? {} : { logErrors })
      })
      .catch((error: unknown) => error);
    expect(answer).to.include({ status: 404 });
  }

  it('logs nothing for a rejected request with logErrors: false', async function () {
    await rejectedRead(false);
    expect(logged).to.deep.equal([]);
  });

  it('still logs a rejected request without the option', async function () {
    await rejectedRead();
    expect(logged).to.have.length(1);
    expect(String(logged[0][0])).to.contain(
      '[1Money SDK]: Error(404'
    );
  });

  it('still logs a rejected request with logErrors: true', async function () {
    await rejectedRead(true);
    expect(logged).to.have.length(1);
  });
});
