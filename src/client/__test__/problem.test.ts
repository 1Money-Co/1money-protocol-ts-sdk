import { expect } from 'chai';
import { createServer } from 'http';
import 'mocha';

import Request from '../core';

import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { ParsedError } from '../core';

const TYPE_PREFIX = 'https://developer.1moneynetwork.com/problem/';
const INSTANCE = 'urn:uuid:0192f0c4-7d2e-7a51-9b0e-3c1d2e4f5a6b';

type Reply = { status: number; contentType?: string; body: string };

// Answers each path with a fixed reply: the problem bodies a
// node with the API error contract sends, and the empty or
// plain-text bodies an older node sent for the same requests.
const REPLIES: Record<string, Reply> = {
  '/v1/unknown_route': {
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({
      type: `${TYPE_PREFIX}route_not_found`,
      title: 'Route not found',
      status: 404,
      instance: INSTANCE,
      action: 'fix_request',
      path: '/v1/unknown_route'
    })
  },
  '/v1/wrong_method': {
    status: 405,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: `${TYPE_PREFIX}method_not_allowed`,
      title: 'Method not allowed',
      status: 405,
      instance: INSTANCE,
      action: 'fix_request',
      method: 'GET'
    })
  },
  '/v1/legacy_empty_404': { status: 404, body: '' },
  '/v1/legacy_text_405': {
    status: 405,
    contentType: 'text/plain',
    body: 'Method Not Allowed'
  },
  '/v1/legacy_error_code': {
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({
      error_code: 'invalid_request',
      message: 'bad address'
    })
  }
};

function errorOf(
  client: Request,
  url: string
): Promise<ParsedError> {
  return new Promise((resolve, reject) => {
    client
      .request({ method: 'get', url })
      .success(() => {
        reject(new Error(`expected an error from ${url}`));
      })
      .error(err => {
        resolve(err);
        return err;
      })
      .timeout(err => {
        reject(new Error(`timeout from ${url}`));
        return err;
      });
  });
}

describe('ParsedError problem details', function () {
  let server: Server;
  let baseURL: string;
  const client = new Request({ timeout: 5000 });

  before(function (done) {
    server = createServer((req, res) => {
      const reply = REPLIES[req.url ?? ''];
      if (reply === undefined) {
        res.writeHead(500);
        res.end();
        return;
      }
      res.writeHead(
        reply.status,
        reply.contentType === undefined
          ? {}
          : { 'Content-Type': reply.contentType }
      );
      res.end(reply.body);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      baseURL = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after(function (done) {
    server.close(() => done());
  });

  it('exposes the problem of an unknown-route 404', async function () {
    const err = await errorOf(
      client,
      `${baseURL}/v1/unknown_route`
    );
    expect(err.status).to.equal(404);
    expect(err.problem?.type).to.equal(
      `${TYPE_PREFIX}route_not_found`
    );
    expect(err.problem?.instance).to.equal(INSTANCE);
    expect(err.problem?.action).to.equal('fix_request');
    expect(err.problem?.members).to.deep.equal({
      path: '/v1/unknown_route'
    });
  });

  it('exposes the problem of a wrong-method 405 sent as problem+json', async function () {
    const err = await errorOf(
      client,
      `${baseURL}/v1/wrong_method`
    );
    expect(err.status).to.equal(405);
    expect(err.problem?.type).to.equal(
      `${TYPE_PREFIX}method_not_allowed`
    );
    expect(err.problem?.status).to.equal(405);
    expect(err.problem?.members).to.deep.equal({
      method: 'GET'
    });
  });

  it('has no problem for the empty 404 and the plain-text 405 of an older node', async function () {
    for (const path of [
      '/v1/legacy_empty_404',
      '/v1/legacy_text_405'
    ]) {
      const err = await errorOf(client, `${baseURL}${path}`);
      expect(err.status).to.be.oneOf([404, 405]);
      expect(err).to.not.have.property('problem');
    }
  });

  it('has no problem for a legacy body, and keeps its data', async function () {
    const err = await errorOf(
      client,
      `${baseURL}/v1/legacy_error_code`
    );
    expect(err.status).to.equal(400);
    expect(err).to.not.have.property('problem');
    expect(err.data).to.deep.equal({
      error_code: 'invalid_request',
      message: 'bad address'
    });
  });
});
