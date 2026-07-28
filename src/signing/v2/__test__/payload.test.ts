import { expect } from 'chai';
import 'mocha';

import { vectorHash } from './helpers/vectors';
import { prepareTransactionV2 } from '../prepare';
import {
  AuthorityAction,
  AuthorityType,
  ManageListAction,
  PauseAction
} from '../../../api/tokens/types';

const CHAIN_ID = 1212101;

function repeatAddr(byte: string): string {
  return `0x${byte.repeat(20)}`;
}

const POPULATED_MEMO = {
  type: 'purpose/SALA',
  format: 'text/plain',
  data: 'invoice-0001'
};

describe('native v2 payload encoders', function () {
  it('Payment', function () {
    expect(
      prepareTransactionV2(
        'payment',
        {
          chain_id: CHAIN_ID,
          nonce: 1,
          recipient: repeatAddr('02'),
          value: '1000000000000000000',
          token: repeatAddr('01')
        },
        { memo: POPULATED_MEMO }
      ).signingHash
    ).to.equal(vectorHash('Payment_single'));
  });

  it('TokenIssue', function () {
    expect(
      prepareTransactionV2('tokenIssue', {
        chain_id: CHAIN_ID,
        nonce: 2,
        symbol: 'TEST',
        name: 'Test Token',
        decimals: 8,
        master_authority: repeatAddr('03'),
        is_private: false,
        clawback_enabled: true
      }).signingHash
    ).to.equal(vectorHash('TokenIssue_single'));
  });

  it('TokenMint', function () {
    expect(
      prepareTransactionV2('tokenMint', {
        chain_id: CHAIN_ID,
        nonce: 3,
        recipient: repeatAddr('04'),
        value: '500000000000',
        token: repeatAddr('01')
      }).signingHash
    ).to.equal(vectorHash('TokenMint_single'));
  });

  it('TokenAuthority', function () {
    expect(
      prepareTransactionV2('tokenAuthority', {
        chain_id: CHAIN_ID,
        nonce: 4,
        action: AuthorityAction.Grant,
        authority_type:
          AuthorityType.MintBurnTokens,
        authority_address: repeatAddr('05'),
        token: repeatAddr('01'),
        value: '100000000'
      }).signingHash
    ).to.equal(
      vectorHash('TokenAuthority_single')
    );
  });

  it('TokenBlacklist', function () {
    expect(
      prepareTransactionV2('tokenBlacklist', {
        chain_id: CHAIN_ID,
        nonce: 5,
        action: ManageListAction.Add,
        address: repeatAddr('06'),
        token: repeatAddr('01')
      }).signingHash
    ).to.equal(
      vectorHash('TokenBlacklist_single')
    );
  });

  it('TokenWhitelist', function () {
    expect(
      prepareTransactionV2('tokenWhitelist', {
        chain_id: CHAIN_ID,
        nonce: 6,
        action: ManageListAction.Add,
        address: repeatAddr('07'),
        token: repeatAddr('01')
      }).signingHash
    ).to.equal(
      vectorHash('TokenWhitelist_single')
    );
  });

  it('TokenPause', function () {
    expect(
      prepareTransactionV2('tokenPause', {
        chain_id: CHAIN_ID,
        nonce: 7,
        action: PauseAction.Pause,
        token: repeatAddr('01')
      }).signingHash
    ).to.equal(vectorHash('TokenPause_single'));
  });

  it('TokenBurn', function () {
    expect(
      prepareTransactionV2('tokenBurn', {
        chain_id: CHAIN_ID,
        nonce: 8,
        value: '250000000',
        token: repeatAddr('01')
      }).signingHash
    ).to.equal(vectorHash('TokenBurn_single'));
  });

  it('TokenClawback', function () {
    expect(
      prepareTransactionV2('tokenClawback', {
        chain_id: CHAIN_ID,
        nonce: 9,
        token: repeatAddr('01'),
        from: repeatAddr('08'),
        recipient: repeatAddr('09'),
        value: '42000000'
      }).signingHash
    ).to.equal(
      vectorHash('TokenClawback_single')
    );
  });

  it('TokenMetadata', function () {
    expect(
      prepareTransactionV2('tokenMetadata', {
        chain_id: CHAIN_ID,
        nonce: 10,
        name: 'Test Token',
        uri: 'https://example.com/token.json',
        token: repeatAddr('01'),
        additional_metadata: [
          { key: 'version', value: '1.0' },
          {
            key: 'author',
            value: 'OneMoney Team'
          }
        ]
      }).signingHash
    ).to.equal(
      vectorHash('TokenMetadata_single')
    );
  });

  it('TokenBridgeAndMint', function () {
    expect(
      prepareTransactionV2(
        'tokenBridgeAndMint',
        {
          chain_id: CHAIN_ID,
          nonce: 11,
          recipient: repeatAddr('0a'),
          value: '1000000000',
          token: repeatAddr('01'),
          source_chain_id: 1,
          source_tx_hash: `0x${'1234567890abcdef'.repeat(4)}`,
          bridge_metadata: ''
        }
      ).signingHash
    ).to.equal(
      vectorHash('TokenBridgeAndMint_single')
    );
  });

  it('TokenBurnAndBridge', function () {
    expect(
      prepareTransactionV2(
        'tokenBurnAndBridge',
        {
          chain_id: CHAIN_ID,
          nonce: 12,
          sender: repeatAddr('0b'),
          value: '500000000',
          token: repeatAddr('01'),
          destination_chain_id: 1,
          destination_address:
            '0x1234567890abcdef1234567890abcdef12345678',
          escrow_fee: '1000000',
          bridge_metadata: '',
          bridge_param: '0x'
        }
      ).signingHash
    ).to.equal(
      vectorHash('TokenBurnAndBridge_single')
    );
  });

  it('Payment with an empty memo differs from the populated one', function () {
    const empty = prepareTransactionV2(
      'payment',
      {
        chain_id: CHAIN_ID,
        nonce: 1,
        recipient: repeatAddr('02'),
        value: '1000000000000000000',
        token: repeatAddr('01')
      }
    );
    expect(empty.signingHash).to.equal(
      vectorHash('payment_memo_empty')
    );
    expect(empty.signingHash).to.not.equal(
      vectorHash('payment_memo_populated')
    );
  });
});
