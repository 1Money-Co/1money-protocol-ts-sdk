import { expect } from 'chai';
import { createServer } from 'http';
import 'mocha';

import { axiosStatic, get } from '../index';
import {
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from '@/api/errors';
import transactionsApi from '@/api/transactions';
import { createPrivateKeySigner } from '@/signing/signer';
import { prepareTransactionV2 } from '@/signing/v2';

import type { AddressInfo } from 'net';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import type { AuthorizedTxV2 } from '@/signing/v2';

// A fixed test key with no value anywhere.
const SIGNER = createPrivateKeySigner(`0x${'11'.repeat(32)}`);
const PROBLEM = 'https://developer.1moneynetwork.com/problem/';
const PAYMENT = '/v2/transactions/payment';
const ELSEWHERE = '/elsewhere';

async function signedPayment(): Promise<AuthorizedTxV2> {
  const prepared = prepareTransactionV2('payment', {
    chain_id: 1212101,
    nonce: 1,
    recipient: `0x${'02'.repeat(20)}`,
    value: '1',
    token: `0x${'01'.repeat(20)}`
  });
  return prepared.authorize(
    await SIGNER.signDigest(prepared.signingHash)
  );
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

// A node that redirects every request to ELSEWHERE, which answers the
// node's own refusal. Following the redirect would turn the submit
// into a false "rejected".
describe('the SDK client follows no redirect (Node)', function () {
  let server: Server;
  let requests: string[];
  let redirectStatus: number;
  const originalBaseURL = axiosStatic.defaults.baseURL;
  const originalAdapter = axiosStatic.defaults.adapter;

  before(async function () {
    server = createServer(
      (request: IncomingMessage, response: ServerResponse) => {
        requests.push(`${request.method} ${request.url}`);
        request.resume();
        if (request.url?.startsWith(ELSEWHERE)) {
          response.writeHead(422, {
            'Content-Type': 'application/json'
          });
          response.end(
            JSON.stringify({
              type: `${PROBLEM}chain_id_mismatch`,
              status: 422,
              action: 'fix_request'
            })
          );
          return;
        }
        response.writeHead(redirectStatus, { Location: ELSEWHERE });
        response.end();
      }
    );
    await new Promise<void>(resolve =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;
    axiosStatic.defaults.baseURL = `http://127.0.0.1:${port}`;
    axiosStatic.defaults.adapter = 'http';
  });

  after(async function () {
    axiosStatic.defaults.baseURL = originalBaseURL;
    axiosStatic.defaults.adapter = originalAdapter;
    await new Promise(resolve => server.close(resolve));
  });

  beforeEach(function () {
    requests = [];
  });

  for (const status of [303, 307, 308]) {
    it(`reads a submit answered ${status} as unknown and sends no second request`, async function () {
      redirectStatus = status;
      const error = await rejection(
        transactionsApi.payment(await signedPayment())
      );
      expect(error).to.be.instanceOf(TransactionOutcomeUnknownError);
      expect(error).to.not.be.instanceOf(TransactionSubmissionError);
      expect(error).to.have.property('status', status);
      expect(requests).to.deep.equal([`POST ${PAYMENT}`]);
    });
  }

  it('makes a read answered 302 an error, with no second request', async function () {
    redirectStatus = 302;
    const error = await rejection(
      get('/v1/transactions/receipt/by_hash?hash=0x00', {
        withCredentials: false
      })
    );
    expect(error).to.include({ status: 302 });
    expect(requests).to.have.length(1);
  });

  it('sends maxRedirects 0 and fetch redirect "manual" on every request', async function () {
    redirectStatus = 302;
    let seen: Record<string, unknown> = {};
    const id = axiosStatic.interceptors.request.use(config => {
      seen = {
        maxRedirects: config.maxRedirects,
        redirect: (config.fetchOptions as { redirect?: string })
          ?.redirect
      };
      return config;
    });
    try {
      await rejection(get('/v1/any', { withCredentials: false }));
    } finally {
      axiosStatic.interceptors.request.eject(id);
    }
    expect(seen).to.deep.equal({ maxRedirects: 0, redirect: 'manual' });
  });
});

// A browser's XMLHttpRequest follows every redirect; axios then reports
// the final URL in response.request.responseURL.
describe('an answer after a redirect that a browser followed', function () {
  const originalAdapter = axiosStatic.defaults.adapter;
  const originalBaseURL = axiosStatic.defaults.baseURL;

  function browserFollowed(status: number, body: unknown) {
    axiosStatic.defaults.adapter = (config =>
      status < 300
        ? Promise.resolve({
            data: body,
            status,
            statusText: 'OK',
            headers: {},
            config,
            request: { responseURL: 'https://proxy.example/elsewhere' }
          })
        : Promise.reject({
            message: `Request failed with status code ${status}`,
            name: 'AxiosError',
            config,
            response: {
              data: body,
              status,
              statusText: 'Error',
              headers: {},
              config,
              request: { responseURL: 'https://proxy.example/elsewhere' }
            }
          })) as typeof originalAdapter;
  }

  before(function () {
    axiosStatic.defaults.baseURL = 'https://node.example';
  });

  after(function () {
    axiosStatic.defaults.adapter = originalAdapter;
    axiosStatic.defaults.baseURL = originalBaseURL;
  });

  it('reads a submit as unknown, never accepted or rejected', async function () {
    const authorized = await signedPayment();
    for (const [status, body] of [
      [200, { hash: authorized.transactionHash }],
      [
        422,
        { type: `${PROBLEM}chain_id_mismatch`, action: 'fix_request' }
      ]
    ] as const) {
      browserFollowed(status, body);
      const error = await rejection(transactionsApi.payment(authorized));
      expect(error, String(status)).to.be.instanceOf(
        TransactionOutcomeUnknownError
      );
    }
  });

  it('makes a read an error that says so', async function () {
    browserFollowed(200, { transaction_hash: '0x00' });
    const error = await rejection(
      get('/v1/any', { withCredentials: false })
    );
    expect(error).to.include({ status: 200, redirected: true });
    expect(String((error as { message: string }).message)).to.include(
      'redirect'
    );
  });

  it('is not a redirect when the final URL is the one asked for', async function () {
    axiosStatic.defaults.adapter = (config =>
      Promise.resolve({
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        request: { responseURL: 'https://node.example/v1/any?x=1' }
      })) as typeof originalAdapter;
    expect(
      await get('/v1/any?x=1', { withCredentials: false })
    ).to.deep.equal({ ok: true });
  });
});
