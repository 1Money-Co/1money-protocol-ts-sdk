import { expect } from 'chai';
import 'mocha';

import { del, get } from '@/client';

import { getIntegrationContext } from './context';

import type { ParsedError } from '@/client';

const TYPE_PREFIX =
  'https://developer.1moneynetwork.com/problem/';
const REQUEST_ID = /^urn:uuid:[0-9a-f-]{36}$/;

async function errorOf(
  request: () => PromiseLike<unknown>
): Promise<ParsedError> {
  try {
    await request();
  } catch (err) {
    return err as ParsedError;
  }
  throw new Error('expected the node to answer with an error');
}

// A node without the API error contract answered these
// requests with an empty or plain-text body.
function expectLegacyAnswer(err: ParsedError): void {
  expect(err.problem).to.equal(undefined);
  expect(err.data ?? '').to.not.have.property('type');
}

describe('problem details integration', function () {
  before(function () {
    if (!getIntegrationContext().config.enabled) {
      this.skip();
    }
  });

  it('exposes the problem of an unknown route', async function () {
    const err = await errorOf(() =>
      get('/v1/chains/no_such_route', {
        withCredentials: false
      })
    );
    expect(err.status).to.equal(404);
    if (err.problem === undefined) {
      expectLegacyAnswer(err);
      return;
    }
    expect(err.problem.type).to.equal(
      `${TYPE_PREFIX}route_not_found`
    );
    expect(err.problem.status).to.equal(404);
    expect(err.problem.action).to.equal('fix_request');
    expect(err.problem.instance).to.match(REQUEST_ID);
    expect(err.problem.members).to.deep.equal({
      path: '/v1/chains/no_such_route'
    });
  });

  it('exposes the problem of a wrong method', async function () {
    const err = await errorOf(() =>
      del(
        '/v1/chains/chain_id',
        {},
        { withCredentials: false }
      )
    );
    expect(err.status).to.equal(405);
    if (err.problem === undefined) {
      expectLegacyAnswer(err);
      return;
    }
    expect(err.problem.type).to.equal(
      `${TYPE_PREFIX}method_not_allowed`
    );
    expect(err.problem.status).to.equal(405);
    expect(err.problem.action).to.equal('fix_request');
    expect(err.problem.instance).to.match(REQUEST_ID);
    expect(err.problem.members).to.deep.equal({
      method: 'DELETE'
    });
  });
});
