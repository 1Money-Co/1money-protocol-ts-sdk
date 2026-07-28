import { expect } from 'chai';
import 'mocha';
import { getPublicKey } from '@noble/secp256k1';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bytesToHex, hexToBytes } from 'viem';

import { deriveMultisigAddress } from '../multisigAddress';

type Vector = {
  signers: { public_key: string; weight: number }[];
  threshold: number;
  address: string;
};

function loadVectors(): Vector[] {
  const raw = readFileSync(
    join(
      __dirname,
      'fixtures',
      'multisig-address-vectors.json'
    ),
    'utf8'
  );
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed)
    ? parsed
    : parsed.vectors;
}

// Real on-curve compressed keys (secp256k1 generator times the
// private keys 0x01..01 and 0x02..02). The signing-vector dummies
// (0x02 followed by 32 0x11 bytes) are NOT on the curve and are
// rejected here by design -- see the off-curve case below.
const PK1 =
  '0x031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const PK2 =
  '0x024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';
const OFF_CURVE = `0x02${'11'.repeat(32)}`;

describe('deriveMultisigAddress', function () {
  loadVectors().forEach((vector, index) => {
    it(`matches vector ${index}`, function () {
      expect(
        deriveMultisigAddress(
          vector.signers,
          vector.threshold
        ).toLowerCase()
      ).to.equal(vector.address.toLowerCase());
    });
  });

  it('is independent of the input signer order', function () {
    const forward = deriveMultisigAddress(
      [
        { public_key: PK1, weight: 1 },
        { public_key: PK2, weight: 1 }
      ],
      2
    );
    const reversed = deriveMultisigAddress(
      [
        { public_key: PK2, weight: 1 },
        { public_key: PK1, weight: 1 }
      ],
      2
    );
    expect(forward).to.equal(reversed);
  });

  it('rejects a duplicate signer', function () {
    expect(() =>
      deriveMultisigAddress(
        [
          { public_key: PK1, weight: 1 },
          { public_key: PK1, weight: 1 }
        ],
        2
      )
    ).to.throw(/duplicate/i);
  });

  it('rejects a threshold above the total weight', function () {
    expect(() =>
      deriveMultisigAddress(
        [{ public_key: PK1, weight: 1 }],
        2
      )
    ).to.throw(/threshold/i);
  });

  // A 33-byte blob that is not a curve point would still hash to
  // an address. Funds sent there would be unrecoverable, because
  // the node rejects the account the key belongs to.
  it('rejects a 33-byte key that is not on the curve', function () {
    expect(() =>
      deriveMultisigAddress(
        [{ public_key: OFF_CURVE, weight: 1 }],
        1
      )
    ).to.throw(/secp256k1/);
  });

  // 258 signers at weight 255 sum to 65790, past the node's u16
  // ceiling. Keys are generated rather than hardcoded because the
  // guard needs more distinct on-curve keys than are worth
  // pasting.
  it('rejects a total weight that overflows u16', function () {
    const signers = Array.from(
      { length: 258 },
      (_unused, index) => ({
        public_key: bytesToHex(
          getPublicKey(
            hexToBytes(
              `0x${(index + 1)
                .toString(16)
                .padStart(64, '0')}` as `0x${string}`
            ),
            true
          )
        ),
        weight: 255
      })
    );

    expect(() =>
      deriveMultisigAddress(signers, 1)
    ).to.throw(/overflow/i);
  });
});
