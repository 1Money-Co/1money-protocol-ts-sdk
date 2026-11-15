import { expect } from 'chai';
import 'mocha';

import { vectorHash } from './helpers/vectors';
import { prepareTransactionV2 } from '../prepare';
import { VERIFY_TOKEN_ADDRESS } from '../../builders/laneClawback';

import type {
  AuthorityOperation,
  LaneClawbackPayload,
  SettledAuthorityPayload
} from '../../../api/tokens/types';

const CHAIN_ID = 1212101;
const ONE = '1000000000000000000';

function repeatAddr(byte: string): string {
  return `0x${byte.repeat(20)}`;
}

const POPULATED_MEMO = {
  type: 'purpose/SALA',
  format: 'text/plain',
  data: 'invoice-0001'
};

function settled(
  operation: AuthorityOperation
): SettledAuthorityPayload {
  return {
    chain_id: CHAIN_ID,
    nonce: 1,
    token: repeatAddr('01'),
    reference_checkpoint: 42,
    operation
  };
}

function laneClawback(
  overrides: Partial<LaneClawbackPayload> = {}
): LaneClawbackPayload {
  return {
    chain_id: CHAIN_ID,
    token: repeatAddr('01'),
    holder: repeatAddr('02'),
    from_nonce: 7,
    reference_checkpoint: 42,
    recipient: repeatAddr('03'),
    value: ONE,
    ...overrides
  };
}

function settledHash(
  operation: AuthorityOperation,
  memo?: typeof POPULATED_MEMO
): string {
  return prepareTransactionV2(
    'settledAuthority',
    settled(operation),
    memo && { memo }
  ).signingHash;
}

describe('settled authority envelope encoding', function () {
  it('matches SettledAuthority_single (grant role, populated memo)', function () {
    expect(
      settledHash(
        {
          type: 'grant_role',
          role: 'clawback',
          account: repeatAddr('02')
        },
        POPULATED_MEMO
      )
    ).to.equal(vectorHash('SettledAuthority_single'));
  });

  it('matches settled_authority_pause', function () {
    expect(settledHash({ type: 'pause' })).to.equal(
      vectorHash('settled_authority_pause')
    );
  });

  it('matches settled_authority_list', function () {
    expect(
      settledHash({
        type: 'list',
        list: 'whitelist',
        action: 'remove',
        account: repeatAddr('02')
      })
    ).to.equal(vectorHash('settled_authority_list'));
  });

  it('matches settled_authority_update_metadata_pairs', function () {
    expect(
      settledHash({
        type: 'update_metadata',
        name: 'Token',
        uri: 'https://example.com/token.json',
        additional_metadata: [
          { key: 'version', value: '1' },
          { key: 'issuer', value: '1money' }
        ]
      })
    ).to.equal(
      vectorHash('settled_authority_update_metadata_pairs')
    );
  });

  it('separates a mint from a minter allowance with the same fields', function () {
    const allowance = settledHash({
      type: 'set_minter_allowance',
      minter: repeatAddr('02'),
      allowance: ONE
    });
    const mint = settledHash({
      type: 'mint',
      recipient: repeatAddr('02'),
      value: ONE
    });
    expect(allowance).to.equal(
      vectorHash('collision_settled_set_minter_allowance')
    );
    expect(mint).to.equal(
      vectorHash('collision_settled_mint')
    );
  });

  it('gives every operation its own signing hash', function () {
    const account = repeatAddr('02');
    const operations: AuthorityOperation[] = [
      { type: 'pause' },
      { type: 'unpause' },
      { type: 'revoke_master_mint_burn' },
      { type: 'revoke_minter', minter: account },
      { type: 'rotate_master_mint_burn', account },
      {
        type: 'set_minter_allowance',
        minter: account,
        allowance: ONE
      },
      { type: 'mint', recipient: account, value: ONE },
      ...(['grant_role', 'revoke_role'] as const).flatMap(
        type =>
          (
            [
              'pause',
              'manage_list',
              'update_metadata',
              'bridge',
              'clawback'
            ] as const
          ).map(role => ({ type, role, account }))
      ),
      ...(['blacklist', 'whitelist'] as const).flatMap(list =>
        (['add', 'remove'] as const).map(action => ({
          type: 'list' as const,
          list,
          action,
          account
        }))
      ),
      {
        type: 'update_metadata',
        name: 'n',
        uri: 'https://u.example',
        additional_metadata: []
      }
    ];
    const hashes = operations.map(op => settledHash(op));
    expect(new Set(hashes).size).to.equal(hashes.length);
  });

  it('posts the REST body to /v2/tokens/authority_operation', function () {
    const authorized = prepareTransactionV2(
      'settledAuthority',
      settled({ type: 'mint', recipient: repeatAddr('02'), value: ONE })
    ).authorize({
      r: `0x${'11'.repeat(32)}`,
      s: `0x${'22'.repeat(32)}`,
      v: 0
    });
    expect(authorized.path).to.equal(
      '/v2/tokens/authority_operation'
    );
    expect(authorized.request).to.deep.include({
      chain_id: CHAIN_ID,
      nonce: 1,
      token: repeatAddr('01'),
      reference_checkpoint: 42,
      operation: {
        type: 'mint',
        recipient: repeatAddr('02'),
        value: ONE
      },
      memo: { type: '', format: '', data: '' }
    });
  });

  it('does not alias the caller metadata pairs in the body', function () {
    const pairs = [{ key: 'k', value: 'v' }];
    const authorized = prepareTransactionV2(
      'settledAuthority',
      settled({
        type: 'update_metadata',
        name: 'n',
        uri: 'https://u.example',
        additional_metadata: pairs
      })
    ).authorize({
      r: `0x${'11'.repeat(32)}`,
      s: `0x${'22'.repeat(32)}`,
      v: 0
    });
    pairs[0].value = 'changed';
    const operation = authorized.request.operation as {
      additional_metadata: { value: string }[];
    };
    expect(operation.additional_metadata[0].value).to.equal(
      'v'
    );
  });

  it('refuses an unknown operation, role or list', function () {
    const bad = [
      { type: 'freeze' },
      { type: 'grant_role', role: 'mint', account: repeatAddr('02') },
      {
        type: 'list',
        list: 'greylist',
        action: 'add',
        account: repeatAddr('02')
      },
      { type: 'mint', recipient: repeatAddr('02'), value: '-1' },
      // A member the operation does not sign must not reach the body.
      { type: 'revoke_master_mint_burn', account: repeatAddr('02') },
      {
        type: 'update_metadata',
        name: 'n',
        uri: 'https://u.example',
        additional_metadata: [{ key: 'k' }]
      }
    ];
    for (const operation of bad) {
      expect(() =>
        prepareTransactionV2(
          'settledAuthority',
          settled(operation as AuthorityOperation)
        )
      ).to.throw('[1Money SDK]: Invalid');
    }
  });

  it('refuses metadata past the node limits, counted in UTF-8 bytes', function () {
    const metadata = (fields: object) => ({
      type: 'update_metadata',
      name: 'n',
      uri: 'https://u.example',
      additional_metadata: [],
      ...fields
    });
    const pair = (key: string, value: string) => ({
      additional_metadata: [{ key, value }]
    });
    const sign = (operation: object) =>
      prepareTransactionV2(
        'settledAuthority',
        settled(operation as AuthorityOperation)
      );
    for (const fields of [
      { name: '' },
      { name: 'n'.repeat(121) },
      { name: '\u00e9'.repeat(61) },
      { uri: '' },
      { uri: 'not a url' },
      { uri: `https://u.example/${'p'.repeat(495)}` },
      pair('', 'v'),
      pair('k'.repeat(21), 'v'),
      pair('k', ''),
      pair('k', 'v'.repeat(101))
    ]) {
      expect(() => sign(metadata(fields))).to.throw(
        '[1Money SDK]: Invalid'
      );
    }
    for (const fields of [
      { name: 'n'.repeat(120) },
      { name: '\u00e9'.repeat(60) },
      { uri: `https://u.example/${'p'.repeat(494)}` },
      pair('k'.repeat(20), 'v'.repeat(100))
    ]) {
      expect(() => sign(metadata(fields))).to.not.throw();
    }
  });
});

describe('lane clawback encoding', function () {
  it('matches lane_clawback_memo_empty (no signer nonce in the header)', function () {
    expect(
      prepareTransactionV2('laneClawback', laneClawback())
        .signingHash
    ).to.equal(vectorHash('lane_clawback_memo_empty'));
  });

  it('matches LaneClawback_single (populated memo)', function () {
    expect(
      prepareTransactionV2('laneClawback', laneClawback(), {
        memo: POPULATED_MEMO
      }).signingHash
    ).to.equal(vectorHash('LaneClawback_single'));
  });

  it('posts the flat REST body to /v2/tokens/lane_clawback', function () {
    const authorized = prepareTransactionV2(
      'laneClawback',
      laneClawback()
    ).authorize({
      r: `0x${'11'.repeat(32)}`,
      s: `0x${'22'.repeat(32)}`,
      v: 1
    });
    expect(authorized.path).to.equal(
      '/v2/tokens/lane_clawback'
    );
    expect(authorized.request).to.deep.include({
      ...laneClawback(),
      memo: { type: '', format: '', data: '' }
    });
    expect(authorized.request).to.not.have.property('nonce');
  });

  it('refuses a holder with no lane (from_nonce 0)', function () {
    expect(() =>
      prepareTransactionV2(
        'laneClawback',
        laneClawback({ from_nonce: 0 })
      )
    ).to.throw('[1Money SDK]: Invalid from_nonce');
  });

  it('refuses a lane clawback of VERIFY', function () {
    expect(() =>
      prepareTransactionV2(
        'laneClawback',
        laneClawback({ token: VERIFY_TOKEN_ADDRESS })
      )
    ).to.throw('VERIFY has no lane clawback');
  });
});
