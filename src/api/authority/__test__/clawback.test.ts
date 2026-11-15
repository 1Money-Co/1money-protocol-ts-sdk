import { expect } from 'chai';
import 'mocha';

import {
  ClawbackIntentNonceUsedError,
  clawbackByMode,
  prepareLaneClawbackReissue,
  sendClawback
} from '../clawback';
import { UpgradeGapError } from '../envelopeMode';
import { authorityRefusalOf } from '../refusals';
import { signLaneClawback } from '../send';
import { createPrivateKeySigner } from '@/signing/signer';
import { VERIFY_TOKEN_ADDRESS } from '@/signing/builders/laneClawback';
import { MockNode, notFound, ok, refusal } from './helpers/mockNode';

import type {
  FullHistoryCheck,
  SendClawbackParams
} from '../clawback';
import type { AuthorizedTxV2 } from '@/signing/v2';

// A fixed test key with no value anywhere.
const SIGNER = createPrivateKeySigner(`0x${'11'.repeat(32)}`);
const SIGNER_ADDRESS = `0x${'0a'.repeat(20)}`;
const TOKEN = `0x${'01'.repeat(20)}`;
const HOLDER = `0x${'0b'.repeat(20)}`;
const RECIPIENT = `0x${'0c'.repeat(20)}`;

const STATUS = '/api/status';
const CHECKPOINT = '/v1/checkpoints/number';
const NONCE = '/v1/accounts/nonce';
const STATUS_BY_HASH = '/v1/transactions/status/by_hash';
const CHECKED: FullHistoryCheck = { fullHistoryChecked: true };

function params(
  overrides: Partial<SendClawbackParams['clawback']> = {},
  source: SendClawbackParams['source'] = 'account'
): SendClawbackParams {
  return {
    clawback: {
      chain_id: 1212101,
      nonce: 7,
      token: TOKEN,
      from: HOLDER,
      recipient: RECIPIENT,
      value: '9',
      ...overrides
    },
    source,
    signer: SIGNER,
    signerAddress: SIGNER_ADDRESS
  };
}

function mode(envelope_mode?: string) {
  return ok({
    native_write_mode: 'v2_only',
    ...(envelope_mode && { envelope_mode })
  });
}

// The signer's nonce answers `signer`, the holder's `holder`.
function nonces(signer: number, holder: number | number[]) {
  const holderNonces = Array.isArray(holder) ? holder : [holder];
  let holderReads = 0;
  return (url: string) => {
    if (url.includes(SIGNER_ADDRESS)) return ok({ nonce: signer });
    const nonce =
      holderNonces[Math.min(holderReads, holderNonces.length - 1)];
    holderReads += 1;
    return ok({ nonce });
  };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('the by-mode clawback router', function () {
  let node: MockNode;

  function install(
    routes: Record<string, ReturnType<typeof ok>>,
    posts: ConstructorParameters<typeof MockNode>[1] = [],
    nonce = nonces(7, 4)
  ) {
    node = new MockNode(
      {
        [CHECKPOINT]: ok({ number: 30 }),
        ...routes,
        [NONCE]: nonce
      },
      posts
    ).install();
  }

  afterEach(function () {
    node.uninstall();
  });

  it('issues the lane clawback in the settled mode, at the holder next nonce', async function () {
    install({ [STATUS]: mode('settled') });
    const sent = await clawbackByMode(params());
    expect(sent.kind).to.equal('lane');
    expect(node.posts.map(p => p.path)).to.deep.equal([
      '/v2/tokens/lane_clawback'
    ]);
    expect(node.posts[0].body).to.deep.include({
      holder: HOLDER,
      from_nonce: 4,
      reference_checkpoint: 30,
      recipient: RECIPIENT,
      value: '9'
    });
  });

  it('keeps VERIFY and a hold on the legacy clawback, with no mode read', async function () {
    install({ [STATUS]: mode('upgrade_gap') });
    const verify = await clawbackByMode(
      params({ token: VERIFY_TOKEN_ADDRESS })
    );
    const hold = await clawbackByMode(params({}, 'hold'));
    expect([verify.kind, hold.kind]).to.deep.equal([
      'legacy',
      'legacy'
    ]);
    expect(node.posts.map(p => p.path)).to.deep.equal([
      '/v2/tokens/clawback',
      '/v2/tokens/clawback'
    ]);
    expect(node.gets.some(url => url.includes(STATUS))).to.equal(
      false
    );
  });

  it('sends nothing in the upgrade gap', async function () {
    install({ [STATUS]: mode('upgrade_gap') });
    expect(await rejection(clawbackByMode(params()))).to.be.instanceOf(
      UpgradeGapError
    );
    expect(node.posts).to.have.length(0);
  });

  it('signs no lane clawback once the signer nonce passed the intent', async function () {
    install({ [STATUS]: mode('settled') }, [], nonces(8, 4));
    const error = await rejection(sendClawback('settled', params()));
    expect(error).to.be.instanceOf(ClawbackIntentNonceUsedError);
    expect(node.posts).to.have.length(0);
  });

  it('turns a retired legacy clawback into a lane clawback once settled', async function () {
    install({ [STATUS]: mode('settled') }, [
      refusal('legacy_envelope_retired')
    ]);
    const sent = await sendClawback('legacy', params());
    expect(sent.kind).to.equal('lane');
    expect(node.posts.map(p => p.path)).to.deep.equal([
      '/v2/tokens/clawback',
      '/v2/tokens/lane_clawback'
    ]);
  });

  it('returns the retired refusal of a clawback that stays legacy', async function () {
    install({ [STATUS]: mode('settled') }, [
      refusal('legacy_envelope_retired')
    ]);
    const error = await rejection(
      sendClawback('settled', params({}, 'hold'))
    );
    expect(authorityRefusalOf(error)?.kind).to.equal(
      'legacy_envelope_retired'
    );
    expect(node.posts).to.have.length(1);
  });

  it('returns the retired refusal while the node reports no mode', async function () {
    install({ [STATUS]: mode() }, [
      refusal('legacy_envelope_retired')
    ]);
    const error = await rejection(sendClawback('legacy', params()));
    expect(authorityRefusalOf(error)?.kind).to.equal(
      'legacy_envelope_retired'
    );
    expect(node.posts).to.have.length(1);
  });
});

describe('the explicit lane clawback re-issue', function () {
  let node: MockNode;
  let dead: AuthorizedTxV2;

  before(async function () {
    dead = await signLaneClawback(
      {
        chain_id: 1212101,
        token: TOKEN,
        holder: HOLDER,
        from_nonce: 3,
        reference_checkpoint: 20,
        recipient: RECIPIENT,
        value: '9'
      },
      SIGNER,
      { type: 'purpose/CLAW', format: 'text/plain', data: 'case-1' }
    );
  });

  function install(
    holderNonces: number[],
    routes: Record<string, ReturnType<typeof ok>> = {}
  ) {
    node = new MockNode({
      [CHECKPOINT]: ok({ number: 40 }),
      [STATUS_BY_HASH]: notFound(),
      ...routes,
      [NONCE]: holderNonces.map(nonce => ok({ nonce }))
    }).install();
  }

  afterEach(function () {
    node.uninstall();
  });

  it('needs the issuer full-history statement', async function () {
    install([5]);
    const error = await rejection(
      prepareLaneClawbackReissue(dead, SIGNER, {} as FullHistoryCheck)
    );
    expect(String(error)).to.include('fullHistoryChecked');
    expect(node.gets).to.have.length(0);
  });

  it('signs the replacement on the next slot, with the same memo, and sends nothing', async function () {
    install([5]);
    const reissue = await prepareLaneClawbackReissue(
      dead,
      SIGNER,
      CHECKED
    );
    expect(reissue.kind).to.equal('prepared');
    const authorized =
      reissue.kind === 'prepared' ? reissue.authorized : dead;
    expect(authorized.request).to.deep.include({
      from_nonce: 5,
      reference_checkpoint: 40,
      memo: dead.request.memo
    });
    expect(authorized.transactionHash).to.not.equal(
      dead.transactionHash
    );
    expect(node.posts).to.have.length(0);
  });

  it('refuses while a node knows the dead hash', async function () {
    install([5], {
      [STATUS_BY_HASH]: ok({ hash: dead.transactionHash, status: 'pending' })
    });
    const reissue = await prepareLaneClawbackReissue(
      dead,
      SIGNER,
      CHECKED
    );
    expect(reissue).to.deep.equal({
      kind: 'refused',
      fate: {
        fate: 'unknown',
        observed: { nextNonce: 5, status: 'pending' }
      }
    });
  });

  it('refuses a clawback that is certified, or whose slot has not passed', async function () {
    install([5], {
      [STATUS_BY_HASH]: ok({
        hash: dead.transactionHash,
        status: 'finalized'
      })
    });
    expect(
      (await prepareLaneClawbackReissue(dead, SIGNER, CHECKED)).kind
    ).to.equal('refused');
    node.uninstall();
    install([3]);
    expect(
      await prepareLaneClawbackReissue(dead, SIGNER, CHECKED)
    ).to.deep.equal({ kind: 'refused', fate: { fate: 'pending' } });
  });

  it('refuses when the second nonce read comes from a node behind', async function () {
    install([5, 3]);
    expect(
      await prepareLaneClawbackReissue(dead, SIGNER, CHECKED)
    ).to.deep.equal({ kind: 'refused', fate: { fate: 'pending' } });
  });
});
