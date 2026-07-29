import { expect } from 'chai';
import 'mocha';

import { vectorHash } from './helpers/vectors';
import {
  createMultisigPayloadFields,
  createMultisigWireFields
} from '../../builders/createMultisig';
import { encodeRlpPayload } from '../../../utils';
import { prepareTransactionV2 } from '../prepare';

const CHAIN_ID = 1212101;
const PK1 = `0x02${'11'.repeat(32)}`;
const PK2 = `0x03${'22'.repeat(32)}`;

const BASE = {
  chain_id: CHAIN_ID,
  nonce: 13,
  signers: [
    { public_key: PK1, weight: 1 },
    { public_key: PK2, weight: 1 }
  ],
  threshold: 2
};

describe('create multisig v2', function () {
  it('reproduces the CreateMultiSig_single signing hash', function () {
    expect(
      prepareTransactionV2(
        'createMultisig',
        BASE
      ).signingHash
    ).to.equal(
      vectorHash('CreateMultiSig_single')
    );
  });

  it('encodes public_key as a 33-element list, not a 33-byte string', function () {
    const fields =
      createMultisigPayloadFields(BASE);
    const encoded = Array.from(
      encodeRlpPayload(fields[0])
    );
    // signers list (0xf8 0x48, long form: 72-byte payload)
    // -> first per-signer wrapper list (0xc0 + 35 = 0xe3,
    //    wrapping [pubkey byteList, weight])
    // -> pubkey byteList header (0xc0 + 33 = 0xe1)
    // -> first pubkey byte (0x02).
    expect(
      Array.from(encoded.slice(0, 5))
    ).to.deep.equal([
      0xf8, 0x48, 0xe3, 0xe1, 0x02
    ]);
  });

  it('handles pubkey bytes at 0x00 and above 0x80', function () {
    const tricky = `0x02${'00'.repeat(16)}${'ff'.repeat(16)}`;
    const fields = createMultisigPayloadFields({
      ...BASE,
      signers: [
        { public_key: tricky, weight: 1 }
      ],
      threshold: 1
    });
    const encoded = Array.from(
      encodeRlpPayload(fields[0])
    );
    // Single signer, so the outer signers list (0xc0 + 52 =
    // 0xf4) wraps one per-signer list (0xc0 + 51 = 0xf3),
    // which wraps the pubkey byteList. That byteList payload
    // is 1 prefix byte (0x02) + 16 zero bytes encoded as the
    // empty string (0x80 each) + 16 0xff bytes encoded as
    // two-byte strings (0x81 0xff each) = 1 + 16 + 32 = 49
    // bytes, which is <= 55, so RLP uses the SHORT form header
    // 0xc0 + 49 = 0xf1 -- not the long form.
    expect(
      Array.from(encoded.slice(0, 5))
    ).to.deep.equal([
      0xf4, 0xf3, 0xf1, 0x02, 0x80
    ]);
  });

  it('serializes public_key as a number array on the wire', function () {
    const body = createMultisigWireFields(BASE);
    const signers = body.signers as {
      public_key: number[];
    }[];
    expect(signers[0].public_key).to.be.an(
      'array'
    );
    expect(
      signers[0].public_key
    ).to.have.length(33);
    expect(signers[0].public_key[0]).to.equal(2);
  });

  it('rejects a non-33-byte public key', function () {
    expect(() =>
      prepareTransactionV2('createMultisig', {
        ...BASE,
        signers: [
          { public_key: '0x0211', weight: 1 }
        ],
        threshold: 1
      })
    ).to.throw(/33 bytes/);
  });

  it('posts to the v2-only multisig route', function () {
    const authorized = prepareTransactionV2(
      'createMultisig',
      BASE
    ).authorize({
      r: `0x${'aa'.repeat(32)}` as `0x${string}`,
      s: `0x${'11'.repeat(32)}` as `0x${string}`,
      v: 1
    });
    expect(authorized.path).to.equal(
      '/v2/accounts/multisig'
    );
    expect(authorized.request.memo).to.deep.equal(
      { type: '', format: '', data: '' }
    );
  });

  it('rejects a signer weight over 255 (node-side u8)', function () {
    expect(() =>
      prepareTransactionV2('createMultisig', {
        ...BASE,
        signers: [
          { public_key: PK1, weight: 256 },
          { public_key: PK2, weight: 1 }
        ]
      })
    ).to.throw(/Invalid signers\[0\]\.weight: 256/);
  });

  it('rejects a threshold over 65535 (node-side u16)', function () {
    expect(() =>
      prepareTransactionV2('createMultisig', {
        ...BASE,
        threshold: 65536
      })
    ).to.throw(/Invalid threshold: 65536/);
  });
});
