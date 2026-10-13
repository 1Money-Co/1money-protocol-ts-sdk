import { expect } from 'chai';
import 'mocha';

import {
  CLIENT_ACTIONS,
  NO_EFFECT_ACTIONS,
  readProblem
} from '../problem';

const HASH = `0x${'ab'.repeat(32)}`;
const OTHER = `0x${'cd'.repeat(32)}`;

describe('readProblem', function () {
  it('accepts each of the five client actions', function () {
    for (const action of CLIENT_ACTIONS) {
      const p = readProblem({ action });
      expect(p.hasAction).to.equal(true);
      expect(p.action).to.equal(action);
      expect(p.actionRaw).to.equal(action);
    }
  });

  it('lists only the actions that prove no effect', function () {
    expect(NO_EFFECT_ACTIONS).to.have.members([
      'fix_request',
      'retry_later',
      'use_other_node'
    ]);
  });

  it('keeps an action it does not know as raw only', function () {
    for (const raw of [
      'Retry_Later',
      'IN_PROGRESS',
      'wait',
      '',
      null,
      42,
      { nested: true }
    ]) {
      const p = readProblem({ action: raw });
      expect(p.hasAction).to.equal(true);
      expect(p.action).to.equal(undefined);
      expect(p.actionRaw).to.deep.equal(raw);
    }
  });

  it('gives no action for a body without the member', function () {
    const p = readProblem({
      error_code: 'business_transaction_failed',
      message: 'already inflight; please retry later'
    });
    expect(p.hasAction).to.equal(false);
    expect(p.action).to.equal(undefined);
    expect(p.actionRaw).to.equal(undefined);
  });

  it('does not read an inherited action', function () {
    const body = Object.create({
      action: 'fix_request'
    }) as object;
    expect(readProblem(body).hasAction).to.equal(
      false
    );
  });

  it('gives an empty result for a body that is not a plain object', function () {
    for (const body of [
      undefined,
      null,
      'in_progress',
      42,
      true,
      ['in_progress'],
      [{ action: 'fix_request' }]
    ]) {
      expect(readProblem(body)).to.deep.equal({
        hasAction: false,
        hasTxHash: false
      });
    }
  });

  it('reads the type and the typed members when they are strings', function () {
    const p = readProblem({
      type: 'https://developer.1moneynetwork.com/problem/sender_locked_by_other_transaction',
      action: 'check_status',
      tx_hash: HASH,
      tx_hash_locked: OTHER
    });
    expect(p.problemType).to.equal(
      'https://developer.1moneynetwork.com/problem/sender_locked_by_other_transaction'
    );
    expect(p.hasTxHash).to.equal(true);
    expect(p.txHash).to.equal(HASH);
  });

  it('marks a tx_hash member of any value as present, but types only a string', function () {
    for (const raw of [42, null, false, {}]) {
      const p = readProblem({
        action: 'in_progress',
        tx_hash: raw
      });
      expect(p.hasTxHash).to.equal(true);
      expect(p.txHash).to.equal(undefined);
    }
    expect(
      readProblem({ action: 'in_progress' })
        .hasTxHash
    ).to.equal(false);
  });

  it('ignores a type that is not a string', function () {
    expect(
      readProblem({ type: 7 }).problemType
    ).to.equal(undefined);
  });

  it('sets only the members it found', function () {
    expect(
      readProblem({ message: 'refused' })
    ).to.deep.equal({
      hasAction: false,
      hasTxHash: false
    });
  });

  it('never reads the message or the title', function () {
    const p = readProblem({
      title: 'in_progress',
      message: 'action: in_progress'
    });
    expect(p.hasAction).to.equal(false);
  });
});
