import { expect } from 'chai';
import 'mocha';

import { tokenAuthorityPayloadFields } from '../builders/tokenAuthority';
import {
  encodeRlpPayload,
  rlpValue as ev
} from '../../utils';
import {
  AuthorityAction,
  AuthorityType
} from '../../api/tokens/types';

const ZERO =
  '0x0000000000000000000000000000000000000000';

describe('tokenAuthority value encoding', function () {
  it('encodes an absent value as the zero integer', function () {
    const fields = tokenAuthorityPayloadFields({
      chain_id: 1212101,
      nonce: 4,
      action: AuthorityAction.Grant,
      authority_type: AuthorityType.MasterMint,
      authority_address: ZERO,
      token: ZERO
    });

    expect(fields).to.have.length(5);

    const actual = encodeRlpPayload(
      ev.list(fields)
    );
    const expected = encodeRlpPayload(
      ev.list([
        ev.string(AuthorityAction.Grant),
        ev.string(AuthorityType.MasterMint),
        ev.address(ZERO),
        ev.address(ZERO),
        ev.uint('0')
      ])
    );
    expect(Array.from(actual)).to.deep.equal(
      Array.from(expected)
    );
  });

  it('still encodes a present value unchanged', function () {
    const fields = tokenAuthorityPayloadFields({
      chain_id: 1212101,
      nonce: 4,
      action: AuthorityAction.Grant,
      authority_type: AuthorityType.MasterMint,
      authority_address: ZERO,
      token: ZERO,
      value: '123'
    });

    expect(fields).to.have.length(5);
    expect(fields[4]).to.deep.equal(
      ev.uint('123')
    );
  });
});
