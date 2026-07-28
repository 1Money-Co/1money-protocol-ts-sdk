import { expect } from 'chai';
import 'mocha';
import { bytesToHex, hexToBytes } from 'viem';

import {
  multisigDescriptor,
  multisigProof,
  signedTransactionRlp,
  signingHashV2,
  singleDescriptor,
  singleProof,
  transactionHashV2,
  unsignedTransactionRlp
} from '../encoding';
import { loadVectors } from './helpers/vectors';

import { encodeRlpPayload as encodeRlpPayloadForTest } from '@/utils';
import type { PlpPayload, Signature } from '@/utils';
import type {
  Vector,
  VectorSignature
} from './helpers/vectors';

function toSignature(
  sig: VectorSignature
): Signature {
  return {
    r: sig.r as `0x${string}`,
    s: sig.s as `0x${string}`,
    v: sig.v
  };
}

function descriptorOf(
  vector: Vector
): PlpPayload {
  if (vector.authorization_kind === 0) {
    return singleDescriptor();
  }
  const account = vector.multisig_account;
  if (!account) {
    throw new Error(
      `multisig vector ${vector.name} has no account`
    );
  }
  return multisigDescriptor(
    account as `0x${string}`
  );
}

function proofOf(vector: Vector): PlpPayload {
  const proof = vector.authorization_proof;
  if (vector.authorization_kind === 0) {
    if (!proof.signature) {
      throw new Error(
        `single vector ${vector.name} has no signature`
      );
    }
    return singleProof(
      toSignature(proof.signature)
    );
  }
  return multisigProof(
    (proof.signatures ?? []).map(entry => ({
      signerPubkey:
        entry.signer_pubkey as `0x${string}`,
      signature: toSignature(entry.signature)
    }))
  );
}

describe('native v2 signing conformance', function () {
  const vectors = loadVectors();

  it('loads all 36 frozen vectors', function () {
    expect(vectors).to.have.length(36);
  });

  vectors.forEach(vector => {
    it(`reproduces ${vector.name}`, function () {
      const payloadRlp = hexToBytes(
        vector.payload_rlp as `0x${string}`
      );
      const descriptor = descriptorOf(vector);
      const proof = proofOf(vector);

      expect(
        bytesToHex(
          unsignedTransactionRlp(
            vector.operation_type,
            descriptor,
            payloadRlp
          )
        )
      ).to.equal(vector.unsigned_transaction_rlp);

      expect(
        signingHashV2(
          vector.operation_type,
          descriptor,
          payloadRlp
        )
      ).to.equal(vector.signing_hash);

      expect(
        bytesToHex(
          signedTransactionRlp(
            vector.operation_type,
            descriptor,
            payloadRlp,
            proof
          )
        )
      ).to.equal(vector.signed_transaction_rlp);

      expect(
        transactionHashV2(
          vector.operation_type,
          descriptor,
          payloadRlp,
          proof
        )
      ).to.equal(vector.transaction_hash);
    });
  });

  it('separates the issue 1038 and 1118 collision pairs', function () {
    const byName = new Map(
      vectors.map(v => [v.name, v])
    );
    const pairs: [string, string][] = [
      [
        'collision_1038_payment',
        'collision_1038_tokenmint'
      ],
      [
        'collision_1038_blacklist_add',
        'collision_1038_whitelist_add'
      ],
      ['collision_1118_pause', 'collision_1118_burn']
    ];

    pairs.forEach(([leftName, rightName]) => {
      const left = byName.get(leftName);
      const right = byName.get(rightName);
      if (!left || !right) {
        throw new Error(
          `missing collision vector ${leftName}/${rightName}`
        );
      }
      expect(left.payload_rlp).to.equal(
        right.payload_rlp
      );
      expect(left.signing_hash).to.not.equal(
        right.signing_hash
      );
      expect(left.transaction_hash).to.not.equal(
        right.transaction_hash
      );
    });
  });
});

describe('native v2 proof integer canonicalization', function () {
  it('minimizes an r value with a leading zero byte', function () {
    const proof = singleProof({
      r: `0x00${'11'.repeat(31)}` as `0x${string}`,
      s: `0x${'22'.repeat(32)}` as `0x${string}`,
      v: 0
    });
    const encoded = Array.from(
      encodeRlpPayloadForTest(proof)
    );
    // The [r, s, v] list payload here is 66 bytes (32 + 33 + 1),
    // over the 55-byte short-list threshold, so RLP emits a
    // long-form list header: encoded[0] = 0xf8, encoded[1] = the
    // length byte (0x42), and encoded[2] is where r's own item
    // header starts. 31-byte r => 0x80 + 31 = 0x9f there, never
    // 0xa0 with a leading 0x00.
    expect(encoded[2]).to.equal(0x9f);
  });

  it('rejects a legacy v value', function () {
    expect(() =>
      singleProof({
        r: `0x${'11'.repeat(32)}` as `0x${string}`,
        s: `0x${'22'.repeat(32)}` as `0x${string}`,
        v: 27
      })
    ).to.throw(/must be 0 or 1/);
  });
});

describe('multisigProof ordering rule', function () {
  const lowKey =
    '0x021111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`;
  const highKey =
    '0x032222222222222222222222222222222222222222222222222222222222222222' as `0x${string}`;
  const sig: Signature = {
    r: `0x${'11'.repeat(32)}` as `0x${string}`,
    s: `0x${'22'.repeat(32)}` as `0x${string}`,
    v: 0
  };

  it('accepts strictly ascending, distinct pubkeys', function () {
    expect(() =>
      multisigProof([
        { signerPubkey: lowKey, signature: sig },
        { signerPubkey: highKey, signature: sig }
      ])
    ).to.not.throw();
  });

  it('rejects a duplicate pubkey', function () {
    expect(() =>
      multisigProof([
        { signerPubkey: lowKey, signature: sig },
        { signerPubkey: lowKey, signature: sig }
      ])
    ).to.throw(/duplicate signerPubkey/);
  });

  it('rejects out-of-order entries (does not silently sort)', function () {
    expect(() =>
      multisigProof([
        { signerPubkey: highKey, signature: sig },
        { signerPubkey: lowKey, signature: sig }
      ])
    ).to.throw(/not in strictly ascending order/);
  });
});
