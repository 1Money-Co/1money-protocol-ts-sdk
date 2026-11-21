import { expect } from 'chai';
import 'mocha';

import { signLaneClawback } from '../authority/send';
import { MockNode } from '../authority/__test__/helpers/mockNode';
import { submitAndSettle } from '../settle';
import tokensApi from '../tokens';
import transactionsApi from '../transactions';
import { createPrivateKeySigner } from '@/signing/signer';
import { prepareTransactionV2 } from '@/signing/v2';

import type { AuthorizedTxV2 } from '@/signing/v2';

// A fixed test key with no value anywhere.
const SIGNER = createPrivateKeySigner(`0x${'11'.repeat(32)}`);
const TOKEN = `0x${'01'.repeat(20)}`;
const ACCOUNT = `0x${'02'.repeat(20)}`;
const CLAWBACK = {
  chain_id: 1212101,
  token: TOKEN,
  holder: ACCOUNT,
  recipient: `0x${'03'.repeat(20)}`,
  value: '9',
  from_nonce: 4,
  reference_checkpoint: 126
};

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

async function signedPayment(): Promise<AuthorizedTxV2> {
  const prepared = prepareTransactionV2('payment', {
    chain_id: 1212101,
    nonce: 1,
    recipient: ACCOUNT,
    value: '1',
    token: TOKEN
  });
  return prepared.authorize(
    await SIGNER.signDigest(prepared.signingHash)
  );
}

describe('the signed copy of a submission', function () {
  let node: MockNode;

  afterEach(function () {
    node.uninstall();
  });

  it('sends the bytes it checked when the caller changes its object', async function () {
    const first = await signLaneClawback(CLAWBACK, SIGNER);
    const second = await signLaneClawback(
      { ...CLAWBACK, value: '10' },
      SIGNER
    );
    const sent = JSON.parse(JSON.stringify(first.request));
    node = new MockNode().install();
    const pending = tokensApi.laneClawback(first);
    Object.assign(first.request, second.request);
    await pending;
    expect(node.posts).to.have.length(1);
    expect(node.posts[0].body).to.deep.equal(sent);
  });

  it('sends nothing when the label and the route name two operations', async function () {
    const clawback = await signLaneClawback(CLAWBACK, SIGNER);
    const mixed: AuthorizedTxV2 = {
      ...(await signedPayment()),
      path: clawback.path,
      request: clawback.request
    };
    node = new MockNode().install();
    for (const send of [
      () => transactionsApi.payment(mixed),
      () => submitAndSettle(mixed)
    ]) {
      expect(String(await rejection(send()))).to.include(
        'is not the route of a "payment" authorization'
      );
    }
    expect(node.posts).to.have.length(0);
  });

  it('checks the copy, not a label that changes between reads', async function () {
    const clawback = await signLaneClawback(CLAWBACK, SIGNER);
    let reads = 0;
    // The first read says payment; every later read says lane
    // clawback, the operation that settle refuses.
    const shifting = {
      path: clawback.path,
      request: clawback.request,
      transactionHash: clawback.transactionHash,
      get operation() {
        reads += 1;
        return reads === 1 ? 'payment' : 'laneClawback';
      }
    } as AuthorizedTxV2;
    node = new MockNode().install();
    await rejection(submitAndSettle(shifting));
    expect(node.posts).to.have.length(0);
  });
});
