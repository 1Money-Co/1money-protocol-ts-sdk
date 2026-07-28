import { expect } from 'chai';
import 'mocha';

import api from '@/api';
import {
  createPrivateKeySigner,
  TransactionBuilder
} from '@/signing';
import { getConfig } from './config';

const config = getConfig();

describe('native v2 integration', function () {
  this.timeout(config.timeout);

  const client = api({
    network: config.network
  });
  let activated = false;

  before(async function () {
    if (!config.enabled) {
      this.skip();
    }
    const status =
      await client.status.getNativeWriteStatus();
    activated =
      status.native_write_mode === 'dual' ||
      status.native_write_mode === 'v2_only';
    if (!activated) {
      this.skip();
    }
  });

  it('reports a health probe', async function () {
    const health =
      await client.status.getHealth();
    expect(String(health).trim()).to.equal('UP');
  });

  it('submits a v2 payment and matches the local hash', async function () {
    const signer = createPrivateKeySigner(
      config.operatorKey as `0x${string}`
    );
    const chainId = (
      await client.chain.getChainId()
    ).chain_id;
    const sender = (
      await client.accounts.getNonce(
        process.env
          .INTEGRATION_TEST_OPERATOR_ADDRESS as string
      )
    ).nonce;

    const prepared = TransactionBuilder.payment({
      chain_id: Number(chainId),
      nonce: Number(sender),
      recipient: process.env
        .INTEGRATION_TEST_RECIPIENT as string,
      value: '1',
      token: process.env
        .INTEGRATION_TEST_TOKEN as string
    });

    const authorized = prepared.authorize(
      await signer.signDigest(
        prepared.signingHash
      )
    );

    // submitAuthorized throws TransactionHashMismatchError if the
    // node's hash differs, so reaching this line already proves
    // the encodings agree.
    const response =
      await client.transactions.payment(
        authorized
      );
    expect(
      response.hash.toLowerCase()
    ).to.equal(
      authorized.transactionHash.toLowerCase()
    );
  });
});
