import { expect } from 'chai';
import 'mocha';

import TransactionBuilder, {
  LegacyV1TransactionBuilder,
  deriveMultisigAddress,
  prepareTransactionV2
} from '../';

const PAYMENT = {
  chain_id: 1212101,
  nonce: 1,
  recipient: `0x${'02'.repeat(20)}`,
  value: '1000000000000000000',
  token: `0x${'01'.repeat(20)}`
};

describe('signing exports', function () {
  it('defaults TransactionBuilder to v2', function () {
    const prepared =
      TransactionBuilder.payment(PAYMENT);
    expect(prepared.signingHash).to.equal(
      prepareTransactionV2('payment', PAYMENT)
        .signingHash
    );
    expect(prepared).to.have.property(
      'authorize'
    );
  });

  it('covers all fourteen operations', function () {
    expect(
      Object.keys(TransactionBuilder).sort()
    ).to.deep.equal(
      [
        'batchPayment',
        'createMultisig',
        'payment',
        'tokenAuthority',
        'tokenBlacklist',
        'tokenBridgeAndMint',
        'tokenBurn',
        'tokenBurnAndBridge',
        'tokenClawback',
        'tokenIssue',
        'tokenMetadata',
        'tokenMint',
        'tokenPause',
        'tokenWhitelist'
      ].sort()
    );
  });

  it('keeps the legacy builder reachable and distinct', function () {
    const legacy =
      LegacyV1TransactionBuilder.payment(
        PAYMENT
      );
    expect(legacy).to.have.property(
      'signatureHash'
    );
    expect(legacy.signatureHash).to.not.equal(
      TransactionBuilder.payment(PAYMENT)
        .signingHash
    );
  });

  it('drops the ambiguous tokenManageList entry from v2', function () {
    expect(
      (
        TransactionBuilder as Record<
          string,
          unknown
        >
      ).tokenManageList
    ).to.equal(undefined);
    expect(
      LegacyV1TransactionBuilder.tokenManageList
    ).to.be.a('function');
  });

  it('exports the multisig address helper', function () {
    expect(deriveMultisigAddress).to.be.a(
      'function'
    );
  });
});
