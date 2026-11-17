import { expect } from 'chai';
import 'mocha';

import {
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from '../../errors';
import {
  AuthorityAction,
  AuthorityType,
  ManageListAction,
  PauseAction
} from '../../tokens/types';
import { settledOperationOf, settledPayloadOf } from '../legacyMap';
import {
  authorityRefusalOf,
  isReferenceNotReady
} from '../refusals';
import { PROBLEM } from './helpers/mockNode';

import type { LegacyAuthorityOperation } from '../legacyMap';

const TOKEN = `0x${'01'.repeat(20)}`;
const ACCOUNT = `0x${'02'.repeat(20)}`;
const ZERO = `0x${'00'.repeat(20)}`;
const HEADER = { chain_id: 1212101, nonce: 9, token: TOKEN };

function rejected(
  id: string,
  members: Record<string, unknown> = {}
): TransactionSubmissionError {
  const body = {
    type: `${PROBLEM}${id}`,
    action: 'retry_later',
    ...members
  };
  return new TransactionSubmissionError(422, body, id, {
    action: 'retry_later',
    problemType: body.type
  });
}

describe('typed token authority refusals', function () {
  it('names each refusal with its members', function () {
    expect(
      authorityRefusalOf(rejected('legacy_envelope_retired'))
    ).to.deep.equal({ kind: 'legacy_envelope_retired' });
    expect(
      authorityRefusalOf(rejected('settled_envelope_not_active'))
    ).to.deep.equal({ kind: 'settled_envelope_not_active' });
    expect(
      authorityRefusalOf(
        rejected('reference_checkpoint_not_committed', {
          checkpoint_id: 12,
          checkpoint_id_latest: 11
        })
      )
    ).to.deep.equal({
      kind: 'reference_checkpoint_not_committed',
      checkpointId: 12,
      checkpointIdLatest: 11
    });
    expect(
      authorityRefusalOf(
        rejected('reference_checkpoint_too_old', {
          checkpoint_id: 1,
          checkpoint_id_earliest: 400
        })
      )
    ).to.deep.equal({
      kind: 'reference_checkpoint_too_old',
      checkpointId: 1,
      checkpointIdEarliest: 400
    });
    expect(
      authorityRefusalOf(
        rejected('token_not_at_reference_checkpoint', {
          mint_address: TOKEN,
          checkpoint_id: 7
        })
      )
    ).to.deep.equal({
      kind: 'token_not_at_reference_checkpoint',
      mintAddress: TOKEN,
      checkpointId: 7
    });
  });

  it('leaves out a member an older node did not send', function () {
    expect(
      authorityRefusalOf(
        rejected('reference_checkpoint_not_committed', {
          checkpoint_id: 'x'
        })
      )
    ).to.deep.equal({ kind: 'reference_checkpoint_not_committed' });
  });

  it('counts only a refusal that proves no effect', function () {
    const unknown = new TransactionOutcomeUnknownError(
      `0x${'ab'.repeat(32)}`,
      {
        status: 422,
        data: { type: `${PROBLEM}legacy_envelope_retired` },
        problemType: `${PROBLEM}legacy_envelope_retired`
      }
    );
    expect(authorityRefusalOf(unknown)).to.equal(undefined);
    expect(authorityRefusalOf(rejected('nonce_too_low'))).to.equal(
      undefined
    );
    expect(authorityRefusalOf(new Error('x'))).to.equal(undefined);
  });

  it('retries a default reference only for not ready', function () {
    expect(
      isReferenceNotReady(
        rejected('reference_checkpoint_not_committed')
      )
    ).to.equal(true);
    expect(
      isReferenceNotReady(
        rejected('token_not_at_reference_checkpoint')
      )
    ).to.equal(true);
    expect(
      isReferenceNotReady(rejected('reference_checkpoint_too_old'))
    ).to.equal(false);
  });
});

describe('legacy to settled operation map', function () {
  function authority(
    action: AuthorityAction,
    type: AuthorityType,
    address = ACCOUNT,
    value?: string
  ): LegacyAuthorityOperation {
    return {
      kind: 'authority',
      payload: {
        ...HEADER,
        action,
        authority_type: type,
        authority_address: address,
        ...(value !== undefined && { value })
      }
    };
  }

  it('maps a mint, a pause and an unpause', function () {
    expect(
      settledOperationOf(
        {
          kind: 'mint',
          payload: { ...HEADER, recipient: ACCOUNT, value: '5' }
        },
        false
      )
    ).to.deep.equal({ type: 'mint', recipient: ACCOUNT, value: '5' });
    for (const [action, type] of [
      [PauseAction.Pause, 'pause'],
      [PauseAction.Unpause, 'unpause']
    ] as const) {
      expect(
        settledOperationOf(
          { kind: 'pause', payload: { ...HEADER, action } },
          false
        )
      ).to.deep.equal({ type });
    }
  });

  it('maps master and minter grants to their settled forms', function () {
    const cases: [LegacyAuthorityOperation, object][] = [
      [
        authority(AuthorityAction.Grant, AuthorityType.MasterMint),
        { type: 'rotate_master_mint_burn', account: ACCOUNT }
      ],
      [
        authority(
          AuthorityAction.Grant,
          AuthorityType.MasterMint,
          ZERO
        ),
        { type: 'revoke_master_mint_burn' }
      ],
      [
        authority(AuthorityAction.Revoke, AuthorityType.MasterMint),
        { type: 'revoke_master_mint_burn' }
      ],
      [
        authority(
          AuthorityAction.Grant,
          AuthorityType.MintBurnTokens,
          ACCOUNT,
          '100'
        ),
        {
          type: 'set_minter_allowance',
          minter: ACCOUNT,
          allowance: '100'
        }
      ],
      [
        authority(
          AuthorityAction.Revoke,
          AuthorityType.MintBurnTokens
        ),
        { type: 'revoke_minter', minter: ACCOUNT }
      ],
      [
        authority(AuthorityAction.Grant, AuthorityType.ManageList),
        {
          type: 'grant_role',
          role: 'manage_list',
          account: ACCOUNT
        }
      ],
      [
        authority(AuthorityAction.Revoke, AuthorityType.Clawback),
        { type: 'revoke_role', role: 'clawback', account: ACCOUNT }
      ]
    ];
    for (const [legacy, expected] of cases) {
      expect(settledOperationOf(legacy, false)).to.deep.equal(
        expected
      );
    }
  });

  it('names the list a legacy list operation writes on the token', function () {
    const list = (
      kind: 'blacklist' | 'whitelist',
      action: ManageListAction
    ): LegacyAuthorityOperation => ({
      kind,
      payload: { ...HEADER, action, address: ACCOUNT }
    });
    const cases: [LegacyAuthorityOperation, boolean, string, string][] =
      [
        [list('blacklist', ManageListAction.Add), false, 'blacklist', 'add'],
        [list('blacklist', ManageListAction.Remove), false, 'blacklist', 'remove'],
        [list('whitelist', ManageListAction.Add), true, 'whitelist', 'add'],
        [list('whitelist', ManageListAction.Remove), true, 'whitelist', 'remove'],
        // A freeze on a private token is a whitelist remove.
        [list('blacklist', ManageListAction.Add), true, 'whitelist', 'remove'],
        [list('whitelist', ManageListAction.Remove), false, 'blacklist', 'add']
      ];
    for (const [legacy, isPrivate, kind, action] of cases) {
      expect(settledOperationOf(legacy, isPrivate)).to.deep.equal({
        type: 'list',
        list: kind,
        action,
        account: ACCOUNT
      });
    }
  });

  it('copies the metadata pairs of an update', function () {
    const pairs = [{ key: 'k', value: 'v' }];
    const operation = settledOperationOf(
      {
        kind: 'metadata',
        payload: {
          ...HEADER,
          name: 'n',
          uri: 'u',
          additional_metadata: pairs
        }
      },
      false
    );
    pairs[0].value = 'changed';
    expect(operation).to.deep.equal({
      type: 'update_metadata',
      name: 'n',
      uri: 'u',
      additional_metadata: [{ key: 'k', value: 'v' }]
    });
  });

  it('refuses an action it does not know instead of reading it as the other one', function () {
    const invalid = ['pause', 'grant', 'add', '', undefined];
    const operations = (action: unknown): LegacyAuthorityOperation[] => [
      { kind: 'pause', payload: { ...HEADER, action } },
      {
        kind: 'authority',
        payload: {
          ...HEADER,
          action,
          authority_type: AuthorityType.MasterMint,
          authority_address: ACCOUNT
        }
      },
      { kind: 'blacklist', payload: { ...HEADER, action, address: ACCOUNT } },
      { kind: 'whitelist', payload: { ...HEADER, action, address: ACCOUNT } }
    ] as unknown as LegacyAuthorityOperation[];
    for (const action of invalid) {
      for (const legacy of operations(action)) {
        expect(() => settledOperationOf(legacy, false)).to.throw(
          'Invalid action'
        );
      }
    }
  });

  it('keeps the chain, nonce and token of the legacy payload', function () {
    expect(
      settledPayloadOf(
        { kind: 'pause', payload: { ...HEADER, action: PauseAction.Pause } },
        false,
        33
      )
    ).to.deep.equal({
      ...HEADER,
      reference_checkpoint: 33,
      operation: { type: 'pause' }
    });
  });
});
