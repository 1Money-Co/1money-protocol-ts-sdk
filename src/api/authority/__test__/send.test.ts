import { expect } from 'chai';
import 'mocha';

import {
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from '../../errors';
import tokensApi from '../../tokens';
import { PauseAction, ManageListAction } from '../../tokens/types';
import { UpgradeGapError } from '../envelopeMode';
import { authorityRefusalOf } from '../refusals';
import {
  authorityOperationByMode,
  buildLaneClawback,
  buildSettledAuthority,
  issueLaneClawback,
  sendAuthorityOperation,
  signLaneClawback
} from '../send';
import { createPrivateKeySigner } from '@/signing/signer';
import { VERIFY_TOKEN_ADDRESS } from '@/signing/builders/laneClawback';
import {
  MockNode,
  ok,
  PROBLEM,
  refusal
} from './helpers/mockNode';

import type { LegacyAuthorityOperation } from '../legacyMap';
import type { SignedContext } from '../send';
import type { AuthorizedTxV2 } from '@/signing/v2';

// A fixed test key with no value anywhere.
const SIGNER = createPrivateKeySigner(`0x${'11'.repeat(32)}`);
const TOKEN = `0x${'01'.repeat(20)}`;
const ACCOUNT = `0x${'02'.repeat(20)}`;
const HEADER = { chain_id: 1212101, nonce: 9, token: TOKEN };
const MINT: LegacyAuthorityOperation = {
  kind: 'mint',
  payload: { ...HEADER, recipient: ACCOUNT, value: '1000' }
};
const FAST = { referenceRetryDelayMs: 0 };

const STATUS = '/api/status';
const CHECKPOINT = '/v1/checkpoints/number';
const NONCE = '/v1/accounts/nonce';
const METADATA = '/v1/tokens/token_metadata';

function mode(envelope_mode?: string) {
  return ok({
    native_write_mode: 'v2_only',
    ...(envelope_mode && { envelope_mode })
  });
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('sending authority operations by envelope', function () {
  let node: MockNode;

  afterEach(function () {
    node.uninstall();
  });

  it('builds the default reference from the latest committed checkpoint', async function () {
    node = new MockNode({ [CHECKPOINT]: ok({ number: 3557 }) }).install();
    const payload = await buildSettledAuthority({
      ...HEADER,
      operation: { type: 'mint', recipient: ACCOUNT, value: '1' }
    });
    expect(payload.reference_checkpoint).to.equal(3557);
    const named = await buildSettledAuthority({
      ...HEADER,
      reference_checkpoint: 12,
      operation: { type: 'pause' }
    });
    expect(named.reference_checkpoint).to.equal(12);
  });

  it('sends the new envelope at the same nonce in the settled mode', async function () {
    node = new MockNode({
      [STATUS]: mode('settled'),
      [CHECKPOINT]: ok({ number: 40 })
    }).install();
    const sent = await authorityOperationByMode(MINT, SIGNER, FAST);
    expect(sent.envelope).to.equal('settled');
    expect(node.posts).to.have.length(1);
    expect(node.posts[0].path).to.equal(
      '/v2/tokens/authority_operation'
    );
    expect(node.posts[0].body).to.deep.include({
      nonce: 9,
      reference_checkpoint: 40,
      operation: { type: 'mint', recipient: ACCOUNT, value: '1000' }
    });
    expect(sent.transactionHash).to.equal(
      sent.authorized.transactionHash
    );
  });

  it('sends the legacy envelope to a node that reports no mode', async function () {
    node = new MockNode({ [STATUS]: mode() }).install();
    const sent = await authorityOperationByMode(MINT, SIGNER, FAST);
    expect(sent.envelope).to.equal('legacy');
    expect(node.posts.map(p => p.path)).to.deep.equal([
      '/v2/tokens/mint'
    ]);
  });

  it('sends nothing in the upgrade gap', async function () {
    node = new MockNode({ [STATUS]: mode('upgrade_gap') }).install();
    expect(
      await rejection(authorityOperationByMode(MINT, SIGNER, FAST))
    ).to.be.instanceOf(UpgradeGapError);
    expect(node.posts).to.have.length(0);
  });

  it('signs a retired legacy envelope again as settled, at the same nonce, once', async function () {
    node = new MockNode(
      {
        [STATUS]: mode('settled'),
        [CHECKPOINT]: ok({ number: 41 })
      },
      [refusal('legacy_envelope_retired')]
    ).install();
    const sent = await sendAuthorityOperation(
      'legacy',
      MINT,
      SIGNER,
      FAST
    );
    expect(sent.envelope).to.equal('settled');
    expect(node.posts.map(p => [p.path, p.body.nonce])).to.deep.equal(
      [
        ['/v2/tokens/mint', 9],
        ['/v2/tokens/authority_operation', 9]
      ]
    );
  });

  it('tries later after a retired refusal while the node is in the gap', async function () {
    node = new MockNode(
      { [STATUS]: mode('upgrade_gap') },
      [refusal('legacy_envelope_retired')]
    ).install();
    expect(
      await rejection(
        sendAuthorityOperation('legacy', MINT, SIGNER, FAST)
      )
    ).to.be.instanceOf(UpgradeGapError);
    expect(node.posts).to.have.length(1);
  });

  it('returns the retired refusal when the node still reports no mode', async function () {
    node = new MockNode(
      { [STATUS]: mode() },
      [refusal('legacy_envelope_retired')]
    ).install();
    const error = await rejection(
      sendAuthorityOperation('legacy', MINT, SIGNER, FAST)
    );
    expect(authorityRefusalOf(error)).to.deep.equal({
      kind: 'legacy_envelope_retired'
    });
    expect(node.posts).to.have.length(1);
  });

  it('returns settled_envelope_not_active without a retry', async function () {
    node = new MockNode(
      { [CHECKPOINT]: ok({ number: 41 }) },
      [refusal('settled_envelope_not_active')]
    ).install();
    const error = await rejection(
      sendAuthorityOperation('settled', MINT, SIGNER, FAST)
    );
    expect(authorityRefusalOf(error)?.kind).to.equal(
      'settled_envelope_not_active'
    );
    expect(node.posts).to.have.length(1);
  });

  it('signs once more with a new reference when it was not committed', async function () {
    node = new MockNode(
      {
        [CHECKPOINT]: [ok({ number: 50 }), ok({ number: 51 })]
      },
      [
        refusal('reference_checkpoint_not_committed', {
          checkpoint_id: 50,
          checkpoint_id_latest: 49
        })
      ]
    ).install();
    await sendAuthorityOperation('settled', MINT, SIGNER, FAST);
    expect(
      node.posts.map(p => p.body.reference_checkpoint)
    ).to.deep.equal([50, 51]);
  });

  it('returns a second not-ready refusal', async function () {
    node = new MockNode(
      { [CHECKPOINT]: ok({ number: 50 }) },
      [
        refusal('token_not_at_reference_checkpoint'),
        refusal('token_not_at_reference_checkpoint')
      ]
    ).install();
    const error = await rejection(
      sendAuthorityOperation('settled', MINT, SIGNER, FAST)
    );
    expect(error).to.be.instanceOf(TransactionSubmissionError);
    expect(node.posts).to.have.length(2);
  });

  it('never retries a reference that is too old', async function () {
    node = new MockNode(
      { [CHECKPOINT]: ok({ number: 50 }) },
      [refusal('reference_checkpoint_too_old', {}, 'fix_request')]
    ).install();
    await rejection(
      sendAuthorityOperation('settled', MINT, SIGNER, FAST)
    );
    expect(node.posts).to.have.length(1);
  });

  it('hands each envelope to onSigned before its send, naming the one it replaces', async function () {
    node = new MockNode(
      {
        [STATUS]: mode('settled'),
        [CHECKPOINT]: [ok({ number: 41 }), ok({ number: 42 })]
      },
      [
        refusal('legacy_envelope_retired'),
        refusal('reference_checkpoint_not_committed')
      ]
    ).install();
    const handed: [AuthorizedTxV2, SignedContext][] = [];
    const sent = await sendAuthorityOperation('legacy', MINT, SIGNER, {
      ...FAST,
      onSigned: (authorized, context) => {
        expect(node.posts).to.have.length(handed.length);
        handed.push([authorized, context]);
      }
    });
    expect(handed.map(([a]) => a.operation)).to.deep.equal([
      'tokenMint',
      'settledAuthority',
      'settledAuthority'
    ]);
    expect(handed.map(([, c]) => c.replaces)).to.deep.equal([
      undefined,
      handed[0][0],
      handed[1][0]
    ]);
    expect(handed[2][0]).to.equal(sent.authorized);
  });

  it('sends nothing when onSigned fails', async function () {
    node = new MockNode({
      [STATUS]: mode('settled'),
      [CHECKPOINT]: ok({ number: 41 })
    }).install();
    await rejection(
      authorityOperationByMode(MINT, SIGNER, {
        ...FAST,
        onSigned: () => {
          throw new Error('disk full');
        }
      })
    );
    expect(node.posts).to.have.length(0);
  });

  it('signs and sends nothing for a pause action it does not know', async function () {
    node = new MockNode({
      [STATUS]: mode('settled'),
      [CHECKPOINT]: ok({ number: 40 })
    }).install();
    const signed: AuthorizedTxV2[] = [];
    const lowercase = {
      kind: 'pause',
      payload: { ...HEADER, action: 'pause' }
    } as unknown as LegacyAuthorityOperation;
    expect(
      String(
        await rejection(
          sendAuthorityOperation('settled', lowercase, SIGNER, {
            ...FAST,
            onSigned: authorized => {
              signed.push(authorized);
            }
          })
        )
      )
    ).to.include('Invalid action');
    expect(signed).to.have.length(0);
    expect(node.posts).to.have.length(0);
  });

  it('reads the token privacy for a list operation', async function () {
    node = new MockNode({
      [CHECKPOINT]: ok({ number: 60 }),
      [METADATA]: ok({ is_private: true })
    }).install();
    await sendAuthorityOperation(
      'settled',
      {
        kind: 'blacklist',
        payload: {
          ...HEADER,
          action: ManageListAction.Add,
          address: ACCOUNT
        }
      },
      SIGNER,
      FAST
    );
    expect(node.posts[0].body.operation).to.deep.equal({
      type: 'list',
      list: 'whitelist',
      action: 'remove',
      account: ACCOUNT
    });
  });

  it('reads no privacy for other operations', async function () {
    node = new MockNode({ [CHECKPOINT]: ok({ number: 60 }) }).install();
    await sendAuthorityOperation(
      'settled',
      { kind: 'pause', payload: { ...HEADER, action: PauseAction.Pause } },
      SIGNER,
      FAST
    );
    expect(node.gets.some(url => url.includes(METADATA))).to.equal(
      false
    );
  });
});

describe('lane clawback build and issue', function () {
  let node: MockNode;
  const intent = {
    chain_id: 1212101,
    token: TOKEN,
    holder: ACCOUNT,
    recipient: `0x${'03'.repeat(20)}`,
    value: '9'
  };

  afterEach(function () {
    node?.uninstall();
  });

  it('names the holder next nonce and the latest checkpoint', async function () {
    node = new MockNode({
      [NONCE]: ok({ nonce: 4 }),
      [CHECKPOINT]: ok({ number: 126 })
    }).install();
    expect(await buildLaneClawback(intent)).to.deep.equal({
      ...intent,
      from_nonce: 4,
      reference_checkpoint: 126
    });
    expect(node.gets[0]).to.include(`address=${ACCOUNT}`);
  });

  it('refuses a holder with no lane', async function () {
    node = new MockNode({
      [NONCE]: ok({ nonce: 0 }),
      [CHECKPOINT]: ok({ number: 126 })
    }).install();
    expect(
      String(await rejection(buildLaneClawback(intent)))
    ).to.include('no lane yet');
  });

  it('refuses VERIFY before any read', async function () {
    node = new MockNode().install();
    expect(
      String(
        await rejection(
          buildLaneClawback({ ...intent, token: VERIFY_TOKEN_ADDRESS })
        )
      )
    ).to.include('VERIFY has no lane clawback');
    expect(node.gets).to.have.length(0);
  });

  it('hands over each signed clawback before it is sent', async function () {
    node = new MockNode({
      [NONCE]: ok({ nonce: 4 }),
      [CHECKPOINT]: ok({ number: 126 })
    }).install();
    const stored: AuthorizedTxV2[] = [];
    const sent = await issueLaneClawback(intent, SIGNER, {
      ...FAST,
      onSigned: authorized => {
        expect(node.posts).to.have.length(stored.length);
        stored.push(authorized);
      }
    });
    expect(stored).to.deep.equal([sent]);
    expect(node.posts[0].path).to.equal('/v2/tokens/lane_clawback');
    expect(node.posts[0].body).to.not.have.property('nonce');
  });

  it('builds one more clawback after a reference not ready, naming the refused one', async function () {
    node = new MockNode(
      {
        [NONCE]: ok({ nonce: 4 }),
        [CHECKPOINT]: [ok({ number: 126 }), ok({ number: 127 })]
      },
      [refusal('reference_checkpoint_not_committed')]
    ).install();
    const handed: [AuthorizedTxV2, SignedContext][] = [];
    const sent = await issueLaneClawback(intent, SIGNER, {
      ...FAST,
      onSigned: (authorized, context) => {
        handed.push([authorized, context]);
      }
    });
    expect(
      node.posts.map(p => p.body.reference_checkpoint)
    ).to.deep.equal([126, 127]);
    expect(handed).to.have.length(2);
    expect(handed[0][1]).to.deep.equal({});
    expect(handed[1]).to.deep.equal([
      sent,
      { replaces: handed[0][0] }
    ]);
  });

  it('names nothing in replaces when the retry signs the same clawback', async function () {
    node = new MockNode(
      {
        [NONCE]: ok({ nonce: 4 }),
        [CHECKPOINT]: ok({ number: 126 })
      },
      [refusal('reference_checkpoint_not_committed')]
    ).install();
    const handed: [AuthorizedTxV2, SignedContext][] = [];
    const sent = await issueLaneClawback(intent, SIGNER, {
      ...FAST,
      onSigned: (authorized, context) => {
        handed.push([authorized, context]);
      }
    });
    expect(node.posts).to.have.length(2);
    expect(handed.map(([a]) => a.transactionHash)).to.deep.equal([
      sent.transactionHash,
      sent.transactionHash
    ]);
    expect(handed.map(([, context]) => context)).to.deep.equal([
      {},
      {}
    ]);
  });

  it('returns a second not-ready refusal, and a too-old one at once', async function () {
    node = new MockNode(
      {
        [NONCE]: ok({ nonce: 4 }),
        [CHECKPOINT]: ok({ number: 126 })
      },
      [
        refusal('token_not_at_reference_checkpoint'),
        refusal('token_not_at_reference_checkpoint'),
        refusal('reference_checkpoint_too_old', {}, 'fix_request')
      ]
    ).install();
    expect(
      authorityRefusalOf(
        await rejection(issueLaneClawback(intent, SIGNER, FAST))
      )?.kind
    ).to.equal('token_not_at_reference_checkpoint');
    expect(node.posts).to.have.length(2);
    await rejection(issueLaneClawback(intent, SIGNER, FAST));
    expect(node.posts).to.have.length(3);
  });

  it('sends nothing when onSigned rethrows a reference refusal of another request', async function () {
    for (const send of [
      (onSigned: () => void) =>
        issueLaneClawback(intent, SIGNER, { ...FAST, onSigned }),
      (onSigned: () => void) =>
        sendAuthorityOperation('settled', MINT, SIGNER, {
          ...FAST,
          onSigned
        })
    ]) {
      node = new MockNode({
        [NONCE]: ok({ nonce: 4 }),
        [CHECKPOINT]: ok({ number: 126 })
      }).install();
      const foreign = new TransactionSubmissionError(
        422,
        refusal('reference_checkpoint_not_committed').body,
        'another request',
        {
          problemType: `${PROBLEM}reference_checkpoint_not_committed`
        }
      );
      let calls = 0;
      const error = await rejection(
        send(() => {
          calls += 1;
          if (calls === 1) throw foreign;
        })
      );
      expect(error).to.equal(foreign);
      expect(calls).to.equal(1);
      expect(node.posts).to.have.length(0);
      node.uninstall();
    }
  });

  it('sends no stored clawback whose hash belongs to another clawback', async function () {
    const payload = {
      ...intent,
      from_nonce: 4,
      reference_checkpoint: 126
    };
    const first = await signLaneClawback(payload, SIGNER);
    const second = await signLaneClawback(
      { ...payload, value: '10' },
      SIGNER
    );
    const swapped = JSON.parse(
      JSON.stringify({
        ...second,
        transactionHash: first.transactionHash
      })
    ) as AuthorizedTxV2;
    node = new MockNode().install();
    expect(
      String(await rejection(tokensApi.laneClawback(swapped)))
    ).to.include('its hash does not match its request');
    expect(node.posts).to.have.length(0);
    const stored = JSON.parse(
      JSON.stringify(first)
    ) as AuthorizedTxV2;
    await tokensApi.laneClawback(stored);
    expect(node.posts).to.have.length(1);
  });

  it('hands back the sent clawback when its answer is lost', async function () {
    node = new MockNode(
      {
        [NONCE]: ok({ nonce: 4 }),
        [CHECKPOINT]: ok({ number: 126 })
      },
      [{ status: 408, body: {} }]
    ).install();
    const error = await rejection(
      issueLaneClawback(intent, SIGNER, FAST)
    );
    expect(error).to.be.instanceOf(TransactionOutcomeUnknownError);
    const sent = (error as TransactionOutcomeUnknownError)
      .authorized as AuthorizedTxV2;
    expect(sent.request).to.deep.equal(node.posts[0].body);
    expect(sent.transactionHash).to.equal(
      (error as TransactionOutcomeUnknownError).transactionHash
    );
  });

  it('sends nothing when storing fails', async function () {
    node = new MockNode({
      [NONCE]: ok({ nonce: 4 }),
      [CHECKPOINT]: ok({ number: 126 })
    }).install();
    await rejection(
      issueLaneClawback(intent, SIGNER, {
        onSigned: () => {
          throw new Error('disk full');
        }
      })
    );
    expect(node.posts).to.have.length(0);
  });
});
