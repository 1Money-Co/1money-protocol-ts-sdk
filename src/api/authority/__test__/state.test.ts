import { expect } from 'chai';
import 'mocha';

import { AuthorityReadError } from '../reads';
import {
  authorityOperationState,
  laneClawbackFate
} from '../state';
import { MockNode, notFound, ok } from './helpers/mockNode';

const SIGNER = `0x${'0a'.repeat(20)}`;
const HOLDER = `0x${'0b'.repeat(20)}`;
const HASH = `0x${'ab'.repeat(32)}`;

const NONCE = '/v1/accounts/nonce';
const RECEIPT = '/v1/transactions/receipt/by_hash';
const STATUS = '/v1/transactions/status/by_hash';

function receipt(extra: object) {
  return ok({
    transaction_hash: HASH,
    fee_used: '0',
    from: SIGNER,
    checkpoint_number: 86,
    ...extra
  });
}

function status(value: string) {
  return ok({ hash: HASH, status: value });
}

describe('authority operation state (positive evidence only)', function () {
  let node: MockNode;

  afterEach(function () {
    node.uninstall();
  });

  function at(
    nextNonce: number,
    routes: Record<string, ReturnType<typeof ok>>
  ) {
    node = new MockNode({
      [NONCE]: ok({ nonce: nextNonce }),
      ...routes
    }).install();
  }

  it('is decided by a success receipt', async function () {
    at(6, { [RECEIPT]: receipt({ success: true }) });
    const state = await authorityOperationState(SIGNER, 5, HASH);
    expect(state.state).to.equal('decided');
    expect(state.state === 'decided' && state.outcome).to.deep.equal(
      { outcome: 'success', warnings: [] }
    );
  });

  it('reports a no-op revoke with its warning', async function () {
    const warning = { type: 'no_op_revoke', target: HOLDER };
    at(6, {
      [RECEIPT]: receipt({
        success: true,
        execution_events: [{ event_type: 'NoOp', target: HOLDER }],
        warnings: [warning]
      })
    });
    const state = await authorityOperationState(SIGNER, 5, HASH);
    expect(state.state === 'decided' && state.outcome).to.deep.equal(
      { outcome: 'no_op', target: HOLDER, warnings: [warning] }
    );
  });

  it('reports a soft fail with its reason', async function () {
    at(6, {
      [RECEIPT]: receipt({
        success: false,
        execution_events: [
          { event_type: 'SweepSummary' },
          { event_type: 'SoftFail', reason: 'RoleMissing' }
        ]
      })
    });
    const state = await authorityOperationState(SIGNER, 5, HASH);
    expect(state.state === 'decided' && state.outcome).to.deep.equal(
      { outcome: 'soft_fail', reason: 'RoleMissing' }
    );
  });

  it('is settling on a counter-signed status, even with the nonce not passed', async function () {
    for (const value of [
      'certified_pending_checkpoint',
      'checkpointed',
      'finalized'
    ]) {
      at(5, { [STATUS]: status(value) });
      expect(
        await authorityOperationState(SIGNER, 5, HASH)
      ).to.deep.equal({ state: 'settling', status: value });
      node.uninstall();
    }
    at(5, {});
  });

  it('is pending while the nonce has not passed', async function () {
    at(5, { [STATUS]: status('pending') });
    expect(
      await authorityOperationState(SIGNER, 5, HASH)
    ).to.deep.equal({ state: 'pending' });
  });

  it('is unknown, never failed, when the nonce passed with no receipt', async function () {
    at(6, {});
    expect(
      await authorityOperationState(SIGNER, 5, HASH)
    ).to.deep.equal({ state: 'unknown', observed: { nextNonce: 6 } });
    node.uninstall();
    at(9, { [STATUS]: status('pending') });
    expect(
      await authorityOperationState(SIGNER, 5, HASH)
    ).to.deep.equal({
      state: 'unknown',
      observed: { nextNonce: 9, status: 'pending' }
    });
  });

  it('throws when a read does not answer', async function () {
    at(6, { [RECEIPT]: { status: 500, body: 'boom' } });
    let caught: unknown;
    try {
      await authorityOperationState(SIGNER, 5, HASH);
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(AuthorityReadError);
  });

  it('never reads a receipt for another hash as found', async function () {
    at(5, {
      [RECEIPT]: ok({ transaction_hash: `0x${'cd'.repeat(32)}` })
    });
    let caught: unknown;
    try {
      await authorityOperationState(SIGNER, 5, HASH);
    } catch (error) {
      caught = error;
    }
    expect(caught).to.be.instanceOf(AuthorityReadError);
  });
});

describe('lane clawback fate (on the holder lane)', function () {
  let node: MockNode;
  const clawback = { holder: HOLDER, from_nonce: 3 };

  afterEach(function () {
    node.uninstall();
  });

  it('reads the holder nonce, not the signer nonce', async function () {
    node = new MockNode({
      [NONCE]: ok({ nonce: 3 }),
      [STATUS]: notFound()
    }).install();
    expect(await laneClawbackFate(clawback, HASH)).to.deep.equal({
      fate: 'pending'
    });
    expect(node.gets[0]).to.include(`address=${HOLDER}`);
  });

  it('is certified on finalized: it executes, as a payment does', async function () {
    node = new MockNode({
      [NONCE]: ok({ nonce: 4 }),
      [STATUS]: status('finalized')
    }).install();
    expect(await laneClawbackFate(clawback, HASH)).to.deep.equal({
      fate: 'certified',
      status: 'finalized'
    });
  });

  it('is unknown when another transaction may have taken the slot', async function () {
    node = new MockNode({ [NONCE]: ok({ nonce: 4 }) }).install();
    expect(await laneClawbackFate(clawback, HASH)).to.deep.equal({
      fate: 'unknown',
      observed: { nextNonce: 4 }
    });
  });

  it('is executed on its receipt', async function () {
    node = new MockNode({
      [NONCE]: ok({ nonce: 4 }),
      [RECEIPT]: receipt({ success: true })
    }).install();
    const fate = await laneClawbackFate(clawback, HASH);
    expect(fate.fate).to.equal('executed');
  });
});
