import { expect } from 'chai';
import 'mocha';

import {
  prepareTokenAuthorityTx,
  tokenAuthorityPayloadFields
} from '../builders/tokenAuthority';
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

  // Regression: the signed bytes always encode value = 0 when
  // omitted (see above), but the legacy `toRequest` body used to
  // spread the caller's payload as-is, sending no `value` field at
  // all. The node's TokenAuthorityPayload DTO has no
  // #[serde(default)], so that body 400s even though it matches
  // what was signed. `toRequest` must default it the same way.
  it('defaults the legacy request body value to "0" when omitted', function () {
    const prepared = prepareTokenAuthorityTx({
      chain_id: 1212101,
      nonce: 4,
      action: AuthorityAction.Grant,
      authority_type: AuthorityType.MasterMint,
      authority_address: ZERO,
      token: ZERO
    });
    const signed = prepared.attachSignature({
      r: '0x41e1e158803da19ef1fc9ab35d86776cb02ac493265b948ff18b2c57a4e52432',
      s: '0x21f42bb02796a424b0961af374a71e0b948e8fadb58f1e5c6ac861be656265e1',
      v: 0
    });

    expect(signed.toRequest().value).to.equal('0');
  });
});
