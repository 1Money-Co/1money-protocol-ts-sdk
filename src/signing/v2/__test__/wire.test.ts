import { expect } from 'chai';
import 'mocha';

import {
  toRequiredMemo,
  tokenAuthorityWireFields,
  tokenMetadataWireFields
} from '../wire';
import {
  AuthorityAction,
  AuthorityType
} from '../../../api/tokens/types';

const ZERO =
  '0x0000000000000000000000000000000000000000';

describe('native v2 wire fields', function () {
  it('fills an absent memo with three empty strings', function () {
    expect(toRequiredMemo()).to.deep.equal({
      type: '',
      format: '',
      data: ''
    });
  });

  it('fills absent memo subfields individually', function () {
    expect(
      toRequiredMemo({ data: 'invoice-0001' })
    ).to.deep.equal({
      type: '',
      format: '',
      data: 'invoice-0001'
    });
  });

  it('preserves a fully populated memo', function () {
    expect(
      toRequiredMemo({
        type: 'purpose/SALA',
        format: 'text/plain',
        data: 'invoice-0001'
      })
    ).to.deep.equal({
      type: 'purpose/SALA',
      format: 'text/plain',
      data: 'invoice-0001'
    });
  });

  it('always sends a token authority value', function () {
    const fields = tokenAuthorityWireFields({
      chain_id: 1212101,
      nonce: 4,
      action: AuthorityAction.Grant,
      authority_type: AuthorityType.MasterMint,
      authority_address: ZERO,
      token: ZERO
    });
    expect(fields.value).to.equal('0');
  });

  // The body must not alias the caller's nested objects: a later
  // mutation would change what gets POSTed while the already
  // computed transactionHash stays fixed.
  it('does not alias the caller additional_metadata', function () {
    const unsigned = {
      chain_id: 1212101,
      nonce: 10,
      name: 'Test Token',
      uri: 'https://example.com/token.json',
      token: ZERO,
      additional_metadata: [
        { key: 'version', value: '1.0' }
      ]
    };
    const fields =
      tokenMetadataWireFields(unsigned);

    unsigned.additional_metadata[0].value =
      'mutated';
    unsigned.additional_metadata.push({
      key: 'late',
      value: 'added'
    });

    expect(
      fields.additional_metadata
    ).to.deep.equal([
      { key: 'version', value: '1.0' }
    ]);
  });
});
