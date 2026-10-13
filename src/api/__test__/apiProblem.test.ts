import { expect } from 'chai';
import fc from 'fast-check';
import 'mocha';

import { CLIENT_ACTIONS, parseProblem } from '../problem';

const TYPE_PREFIX = 'https://developer.1moneynetwork.com/problem/';
const HASH = `0x${'ab'.repeat(32)}`;
const INSTANCE = 'urn:uuid:0192f0c4-7d2e-7a51-9b0e-3c1d2e4f5a6b';

const RESERVED = [
  'type',
  'title',
  'status',
  'instance',
  'action',
  'error_code',
  'message'
];

describe('parseProblem', function () {
  it('reads every member of a problem body', function () {
    const problem = parseProblem({
      type: `${TYPE_PREFIX}submission_already_in_flight`,
      title: 'Transaction already in flight',
      status: 422,
      instance: INSTANCE,
      action: 'in_progress',
      tx_hash: HASH,
      error_code: 'business_transaction_failed',
      message: 'Transaction processing failed: already inflight'
    });
    expect(problem).to.deep.equal({
      type: `${TYPE_PREFIX}submission_already_in_flight`,
      title: 'Transaction already in flight',
      status: 422,
      instance: INSTANCE,
      action: 'in_progress',
      members: { tx_hash: HASH },
      txHash: HASH
    });
  });

  it('gives no problem for a legacy body without `type`', function () {
    for (const body of [
      {
        error_code: 'business_transaction_failed',
        message: 'Transaction processing failed'
      },
      { action: 'fix_request', status: 400 },
      { type: 42, action: 'fix_request' },
      { type: null }
    ]) {
      expect(parseProblem(body)).to.equal(undefined);
    }
  });

  it('gives no problem for a body that is not an object', function () {
    for (const body of [
      undefined,
      null,
      '',
      'Not Found',
      404,
      true,
      [{ type: `${TYPE_PREFIX}route_not_found` }]
    ]) {
      expect(parseProblem(body)).to.equal(undefined);
    }
  });

  it('keeps an unknown type and leaves out an unknown action', function () {
    const problem = parseProblem({
      type: `${TYPE_PREFIX}added_by_a_newer_node`,
      title: 'Newer',
      status: 409,
      instance: INSTANCE,
      action: 'wait_for_quorum',
      quorum: 5
    });
    expect(problem?.type).to.equal(
      `${TYPE_PREFIX}added_by_a_newer_node`
    );
    expect(problem).to.not.have.property('action');
    expect(problem?.members).to.deep.equal({ quorum: 5 });
  });

  it('accepts `about:blank` with only `type`', function () {
    expect(parseProblem({ type: 'about:blank' })).to.deep.equal({
      type: 'about:blank',
      members: {}
    });
  });

  it('reads each of the five client actions', function () {
    for (const action of CLIENT_ACTIONS) {
      expect(
        parseProblem({ type: 'about:blank', action })?.action
      ).to.equal(action);
    }
  });

  it('leaves out a member of the wrong type and keeps the rest', function () {
    const problem = parseProblem({
      type: `${TYPE_PREFIX}rate_limited`,
      title: 7,
      status: '429',
      instance: { id: 1 },
      action: 'Retry_Later',
      retry_after_secs: '3',
      tx_hash: 12
    });
    expect(problem).to.deep.equal({
      type: `${TYPE_PREFIX}rate_limited`,
      members: { retry_after_secs: '3', tx_hash: 12 }
    });
  });

  it('leaves out a status that is not an HTTP status', function () {
    for (const status of [1.5, 99, 600, -404, NaN]) {
      expect(
        parseProblem({ type: 'about:blank', status })
      ).to.not.have.property('status');
    }
    for (const status of [100, 599]) {
      expect(
        parseProblem({ type: 'about:blank', status })?.status
      ).to.equal(status);
    }
  });

  it('leaves out a `retry_after_secs` that is not whole seconds', function () {
    for (const seconds of [-3, 1.5, Infinity, 2 ** 53]) {
      const problem = parseProblem({
        type: 'about:blank',
        retry_after_secs: seconds
      });
      expect(problem).to.not.have.property('retryAfterSecs');
      expect(problem?.members.retry_after_secs).to.equal(seconds);
    }
    expect(
      parseProblem({ type: 'about:blank', retry_after_secs: 0 })
        ?.retryAfterSecs
    ).to.equal(0);
  });

  it('reads `retry_after_secs` when it is a number', function () {
    const problem = parseProblem({
      type: `${TYPE_PREFIX}rate_limited`,
      action: 'retry_later',
      retry_after_secs: 3
    });
    expect(problem?.retryAfterSecs).to.equal(3);
    expect(problem?.members).to.deep.equal({
      retry_after_secs: 3
    });
  });

  it('reads own members only', function () {
    const body = Object.create({
      type: `${TYPE_PREFIX}inherited`,
      title: 'Inherited',
      status: 422,
      instance: 'urn:uuid:inherited',
      action: 'fix_request',
      tx_hash: HASH,
      retry_after_secs: 3,
      inherited_member: true
    }) as Record<string, unknown>;
    expect(parseProblem(body)).to.equal(undefined);

    body.type = 'about:blank';
    expect(parseProblem(body)).to.deep.equal({
      type: 'about:blank',
      members: {}
    });
  });

  it('keeps a `__proto__` member as an own member', function () {
    const problem = parseProblem(
      JSON.parse(
        `{"type":"about:blank","__proto__":{"polluted":true}}`
      )
    );
    const members = problem?.members as Record<string, unknown>;
    expect(Object.keys(members)).to.deep.equal(['__proto__']);
    expect(members).to.not.have.property('polluted');
    expect(({} as Record<string, unknown>).polluted).to.equal(
      undefined
    );
  });

  it('returns a frozen problem the caller cannot change', function () {
    const body = {
      type: 'about:blank',
      tx_hash: HASH
    };
    const problem = parseProblem(body);
    expect(Object.isFrozen(problem)).to.equal(true);
    expect(Object.isFrozen(problem?.members)).to.equal(true);
    body.tx_hash = 'changed';
    expect(problem?.txHash).to.equal(HASH);
  });

  it('never throws, and its members never hold a reserved member', function () {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.jsonValue()),
        fc.oneof(
          fc.constantFrom(...RESERVED),
          fc.string()
        ),
        fc.jsonValue(),
        (extra, key, value) => {
          const body: Record<string, unknown> = {
            ...extra,
            type: 'about:blank'
          };
          Object.defineProperty(body, key, {
            value,
            enumerable: true,
            writable: true,
            configurable: true
          });
          const problem = parseProblem(body);
          if (key === 'type' && typeof value !== 'string') {
            return problem === undefined;
          }
          if (problem === undefined) return false;
          for (const reserved of RESERVED) {
            if (
              Object.prototype.hasOwnProperty.call(
                problem.members,
                reserved
              )
            ) {
              return false;
            }
          }
          for (const name of Object.keys(body)) {
            if (
              !RESERVED.includes(name) &&
              problem.members[name] !== body[name]
            ) {
              return false;
            }
          }
          return true;
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('never throws on any JSON value', function () {
    fc.assert(
      fc.property(fc.jsonValue(), body => {
        parseProblem(body);
      }),
      { numRuns: 1000 }
    );
  });
});
