import { expect } from 'chai';
import 'mocha';

import { AuthorityReadError } from '../reads';
import { signLaneClawback } from '../send';
import {
  authorityOperationState,
  laneClawbackFate
} from '../state';
import { createPrivateKeySigner } from '@/signing/signer';
import { MockNode, notFound, ok } from './helpers/mockNode';

import type { AuthorizedTxV2 } from '@/signing/v2';

const SIGNER = `0x${'0a'.repeat(20)}`;
const HOLDER = `0x${'0b'.repeat(20)}`;
const HASH = `0x${'ab'.repeat(32)}`;

const NONCE = '/v1/accounts/nonce';
const RECEIPT = '/v1/transactions/receipt/by_hash';
const STATUS = '/v1/transactions/status/by_hash';

function receipt(extra: object, hash = HASH) {
  return ok({
    transaction_hash: hash,
    fee_used: '0',
    from: SIGNER,
    checkpoint_number: 86,
    ...extra
  });
}

function status(value: string, hash = HASH) {
  return ok({ hash, status: value });
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
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

  it('reads a receipt or a status whose hash has no 0x', async function () {
    const bare = HASH.slice(2).toUpperCase();
    at(6, { [RECEIPT]: receipt({ success: true }, bare) });
    expect((await authorityOperationState(SIGNER, 5, HASH)).state).to.equal(
      'decided'
    );
    node.uninstall();
    at(5, { [STATUS]: status('finalized', bare) });
    expect(
      await authorityOperationState(SIGNER, 5, HASH)
    ).to.deep.equal({ state: 'settling', status: 'finalized' });
  });

  it('is decided by a receipt when the status lookup fails', async function () {
    at(6, {
      [RECEIPT]: receipt({ success: true }),
      [STATUS]: { status: 503, body: 'down' }
    });
    const state = await authorityOperationState(SIGNER, 5, HASH);
    expect(state.state).to.equal('decided');
  });

  it('throws when the status lookup fails with no receipt', async function () {
    at(6, {
      [RECEIPT]: notFound(),
      [STATUS]: { status: 503, body: 'down' }
    });
    expect(
      await rejection(authorityOperationState(SIGNER, 5, HASH))
    ).to.be.instanceOf(AuthorityReadError);
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

  it('never reads a status it does not know as pending or unknown', async function () {
    at(6, { [STATUS]: status('evicted') });
    expect(
      await rejection(authorityOperationState(SIGNER, 5, HASH))
    ).to.be.instanceOf(AuthorityReadError);
  });

  it('never reads a receipt it cannot read as decided', async function () {
    for (const unreadable of [
      receipt({}),
      receipt({ success: 'false' }),
      receipt({
        success: false,
        execution_events: [{ event_type: 'SoftFail', reason: 'Gone' }]
      }),
      receipt({
        success: true,
        execution_events: [{ event_type: 'NoOp', target: 7 }]
      }),
      receipt({ success: true, execution_events: {} }),
      receipt({ success: true, warnings: [{}] })
    ]) {
      at(6, { [RECEIPT]: unreadable });
      expect(
        await rejection(authorityOperationState(SIGNER, 5, HASH))
      ).to.be.instanceOf(AuthorityReadError);
      node.uninstall();
    }
    at(6, {});
  });
});

describe('lane clawback fate (on the holder lane)', function () {
  let node: MockNode;
  let clawback: AuthorizedTxV2;
  let other: AuthorizedTxV2;

  // A fixed test key with no value anywhere.
  const signer = createPrivateKeySigner(`0x${'11'.repeat(32)}`);
  const payload = {
    chain_id: 1212101,
    token: `0x${'01'.repeat(20)}`,
    holder: HOLDER,
    from_nonce: 3,
    reference_checkpoint: 20,
    recipient: `0x${'0c'.repeat(20)}`,
    value: '9'
  };

  before(async function () {
    clawback = await signLaneClawback(payload, signer);
    other = await signLaneClawback(
      { ...payload, value: '10' },
      signer
    );
  });

  afterEach(function () {
    node.uninstall();
  });

  it('reads the holder nonce, not the signer nonce', async function () {
    node = new MockNode({
      [NONCE]: ok({ nonce: 3 }),
      [STATUS]: notFound()
    }).install();
    expect(await laneClawbackFate(clawback)).to.deep.equal({
      fate: 'pending'
    });
    expect(node.gets[0]).to.include(`address=${HOLDER}`);
  });

  it('is certified on finalized: it executes, as a payment does', async function () {
    node = new MockNode({
      [NONCE]: ok({ nonce: 4 }),
      [STATUS]: status('finalized', clawback.transactionHash)
    }).install();
    expect(await laneClawbackFate(clawback)).to.deep.equal({
      fate: 'certified',
      status: 'finalized'
    });
  });

  it('is unknown when another transaction may have taken the slot', async function () {
    node = new MockNode({ [NONCE]: ok({ nonce: 4 }) }).install();
    expect(await laneClawbackFate(clawback)).to.deep.equal({
      fate: 'unknown',
      observed: { nextNonce: 4 }
    });
  });

  it('refuses anything but a signed lane clawback', async function () {
    node = new MockNode().install();
    const error = await rejection(
      laneClawbackFate({ ...clawback, operation: 'tokenClawback' })
    );
    expect(String(error)).to.include('another operation');
  });

  it('refuses a record whose hash belongs to another clawback, before any read', async function () {
    node = new MockNode().install();
    for (const broken of [
      { ...clawback, transactionHash: other.transactionHash },
      { ...other, transactionHash: clawback.transactionHash },
      {
        ...clawback,
        request: { ...clawback.request, from_nonce: 4 }
      },
      {
        ...clawback,
        request: { ...clawback.request, memo: { ...other.request.memo as object, data: 'x' } }
      },
      {
        ...clawback,
        request: { ...clawback.request, nonce: 3 }
      }
    ]) {
      expect(String(await rejection(laneClawbackFate(broken)))).to.include(
        'Not a valid signed lane clawback'
      );
    }
    expect(node.gets).to.have.length(0);
  });

  it('takes a record that crossed a JSON boundary', async function () {
    node = new MockNode({ [NONCE]: ok({ nonce: 3 }) }).install();
    const stored = JSON.parse(JSON.stringify(clawback));
    expect(await laneClawbackFate(stored)).to.deep.equal({
      fate: 'pending'
    });
  });

  it('is executed on its receipt', async function () {
    node = new MockNode({
      [NONCE]: ok({ nonce: 4 }),
      [RECEIPT]: receipt({ success: true }, clawback.transactionHash)
    }).install();
    const fate = await laneClawbackFate(clawback);
    expect(fate.fate).to.equal('executed');
  });

  it('is executed on its receipt when the status lookup fails', async function () {
    node = new MockNode({
      [NONCE]: ok({ nonce: 4 }),
      [RECEIPT]: receipt({ success: true }, clawback.transactionHash),
      [STATUS]: { status: 503, body: 'down' }
    }).install();
    const fate = await laneClawbackFate(clawback);
    expect(fate.fate).to.equal('executed');
  });
});

// Issue #73: a poll reads 404 until the receipt or the status
// exists. That answer is expected there, so it logs nothing; every
// other rejection still logs.
describe('authority reads that expect a 404 log nothing for it', function () {
  let node: MockNode | undefined;

  afterEach(function () {
    node?.uninstall();
    node = undefined;
  });

  async function errorsLoggedBy(
    run: () => Promise<unknown>
  ): Promise<string[]> {
    const originalError = console.error;
    const logged: string[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(String(args[0]));
    };
    try {
      await run();
    } finally {
      console.error = originalError;
    }
    return logged;
  }

  it('logs nothing when a poll of authorityOperationState reads 404', async function () {
    node = new MockNode({ [NONCE]: ok({ nonce: 6 }) }).install();
    const logged = await errorsLoggedBy(async () => {
      expect(
        await authorityOperationState(SIGNER, 5, HASH)
      ).to.deep.equal({
        state: 'unknown',
        observed: { nextNonce: 6 }
      });
    });
    expect(node.gets.some(url => url.includes(RECEIPT))).to.equal(
      true
    );
    expect(node.gets.some(url => url.includes(STATUS))).to.equal(
      true
    );
    expect(logged).to.deep.equal([]);
  });

  it('logs nothing when laneClawbackFate reads 404', async function () {
    // A fixed test key with no value anywhere.
    const signer = createPrivateKeySigner(`0x${'11'.repeat(32)}`);
    const clawback = await signLaneClawback(
      {
        chain_id: 1212101,
        token: `0x${'01'.repeat(20)}`,
        holder: HOLDER,
        from_nonce: 3,
        reference_checkpoint: 20,
        recipient: `0x${'0c'.repeat(20)}`,
        value: '9'
      },
      signer
    );
    node = new MockNode({ [NONCE]: ok({ nonce: 3 }) }).install();
    const logged = await errorsLoggedBy(async () => {
      expect(await laneClawbackFate(clawback)).to.deep.equal({
        fate: 'pending'
      });
    });
    expect(logged).to.deep.equal([]);
  });

  it('still logs a receipt read that gets a 500', async function () {
    node = new MockNode({
      [NONCE]: ok({ nonce: 6 }),
      [RECEIPT]: { status: 500, body: 'boom' }
    }).install();
    const logged = await errorsLoggedBy(async () => {
      expect(
        await rejection(authorityOperationState(SIGNER, 5, HASH))
      ).to.be.instanceOf(AuthorityReadError);
    });
    expect(logged).to.have.length(1);
    expect(logged[0]).to.include('500');
  });

  it('still logs a 404 of a read that expects an answer: the nonce', async function () {
    node = new MockNode({}).install();
    const logged = await errorsLoggedBy(async () => {
      expect(
        await rejection(authorityOperationState(SIGNER, 5, HASH))
      ).to.be.instanceOf(AuthorityReadError);
    });
    expect(logged).to.have.length(1);
    expect(logged[0]).to.include('404');
  });
});
