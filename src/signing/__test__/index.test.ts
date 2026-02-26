import { expect } from 'chai';
import 'mocha';
import { keccak256 } from 'viem';

import TransactionBuilder, {
  createPrivateKeySigner,
} from '../';
import {
  AuthorityAction,
  AuthorityType,
  ManageListAction,
  PauseAction,
} from '../../api/tokens/types';
import type { Signature, ZeroXString } from '../../utils';
import {
  encodeRlpPayload,
  rlpValue as ev,
} from '../../utils';

// Test-only throwaway key for deterministic signing assertions.
// Never use this key in production or with real funds.
const privateKey: ZeroXString =
  '0x01833a126ec45d0191519748146b9e35647aab7fed28de1c8e17824970f964a3';

type ExternalSignatureVector = {
  r: string;
  s: string;
  v: number;
};

function assertExternalHash(
  actualHash: string,
  signatureHashByRustSdk?: string
) {
  if (signatureHashByRustSdk) {
    expect(actualHash).to.equal(signatureHashByRustSdk);
  }
}

function assertExternalSignature(
  signature: Signature,
  expected?: ExternalSignatureVector
) {
  if (expected) {
    expect(signature.r).to.equal(expected.r);
    expect(signature.s).to.equal(expected.s);
    expect(signature.v).to.equal(expected.v);
    return;
  }

  expect(signature.r).to.match(/^0x[0-9a-f]{64}$/);
  expect(signature.s).to.match(/^0x[0-9a-f]{64}$/);
  expect(signature.v === 0 || signature.v === 1).to.equal(
    true
  );
}

describe('signing builder test', function () {
  it('preparePaymentTx builds expected rlp bytes and hash', async function () {
    const signatureHashByRustSdk =
      '0xe9e5e0f091a176e9eb239b17b930f5cd8d10e5782127b854840df65c67e22f99';

    const prepared = TransactionBuilder.payment({
      chain_id: 1212101,
      nonce: 0,
      recipient: '0xa634dfba8c7550550817898bc4820cd10888aac5',
      value: '10',
      token: '0x5458747a0efb9ebeb8696fcac1479278c0872fbe',
    });

    const expectedEncodedRlp = encodeRlpPayload(
      ev.list([
        ev.uint(1212101),
        ev.uint(0),
        ev.address(
          '0xa634dfba8c7550550817898bc4820cd10888aac5'
        ),
        ev.uint('10'),
        ev.address(
          '0x5458747a0efb9ebeb8696fcac1479278c0872fbe'
        ),
      ])
    );
    const innerSignatureHash = keccak256(expectedEncodedRlp);

    assertExternalHash(
      innerSignatureHash,
      signatureHashByRustSdk
    );
    expect(prepared.signatureHash).to.equal(
      innerSignatureHash
    );
    expect(Array.from(prepared.rlpBytes)).to.deep.equal(
      Array.from(expectedEncodedRlp)
    );

    const signed = await prepared.sign(
      createPrivateKeySigner(privateKey)
    );
    assertExternalSignature(signed.signature, {
      r: '0x41e1e158803da19ef1fc9ab35d86776cb02ac493265b948ff18b2c57a4e52432',
      s: '0x21f42bb02796a424b0961af374a71e0b948e8fadb58f1e5c6ac861be656265e1',
      v: 0,
    });
    expect(signed.signatureHash).to.equal(prepared.signatureHash);
    expect(signed.txHash).to.match(/^0x[0-9a-f]{64}$/);
    expect(
      prepared.attachSignature(signed.signature).txHash
    ).to.equal(signed.txHash);

    const req = signed.toRequest();
    expect(req.signature.r).to.equal(signed.signature.r);
  });

  it('prepareTokenIssueTx sets clawback default and encodes', async function () {
    const signatureHashByRustSdk =
      '0x01882eb8bee7e2d0d553a0debc95f5d666d55e481b64ee9c6159b4c50831b9f0';

    const prepared = TransactionBuilder.tokenIssue({
      chain_id: 1212101,
      nonce: 2,
      symbol: 'TEST',
      name: 'TEST Stablecoin',
      decimals: 18,
      master_authority: '0x0000000000000000000000000000000000000000',
      is_private: false,
      clawback_enabled: true,
    });

    const expectedEncodedRlp = encodeRlpPayload(
      ev.list([
        ev.uint(1212101),
        ev.uint(2),
        ev.string('TEST'),
        ev.string('TEST Stablecoin'),
        ev.uint(18),
        ev.address(
          '0x0000000000000000000000000000000000000000'
        ),
        ev.bool(false),
        ev.bool(true),
      ])
    );
    const innerSignatureHash = keccak256(expectedEncodedRlp);

    assertExternalHash(
      innerSignatureHash,
      signatureHashByRustSdk
    );
    expect(prepared.signatureHash).to.equal(
      innerSignatureHash
    );
    expect(Array.from(prepared.rlpBytes)).to.deep.equal(
      Array.from(expectedEncodedRlp)
    );

    const signed = await prepared.sign(
      createPrivateKeySigner(privateKey)
    );
    assertExternalSignature(signed.signature, {
      r: '0xdb4741c7f2ce4a2d78e790331075284efaeee0b217e9c9ccf334d3014d98b7bb',
      s: '0x6ba551adfd0b9d7236298ae267575255e0b54b0d569dc9824d1445d2c546dc9e',
      v: 1,
    });
    expect(signed.signatureHash).to.equal(prepared.signatureHash);

    const req = signed.toRequest();
    expect(req.clawback_enabled).to.equal(true);
  });

  it('prepareTokenMintTx builds expected rlp bytes', async function () {
    const signatureHashByRustSdk =
      '0x75e9f6cb6e465aac2aebfe7999b85fb08a8a9f4d8b3f08ece8d102f21e5f6d49';

    const prepared = TransactionBuilder.tokenMint({
      chain_id: 1212101,
      nonce: 2,
      recipient: '0x0000000000000000000000000000000000000001',
      value: '273',
      token: '0x0000000000000000000000000000000000000002',
    });

    const expectedEncodedRlp = encodeRlpPayload(
      ev.list([
        ev.uint(1212101),
        ev.uint(2),
        ev.address(
          '0x0000000000000000000000000000000000000001'
        ),
        ev.uint('273'),
        ev.address(
          '0x0000000000000000000000000000000000000002'
        ),
      ])
    );
    const innerSignatureHash = keccak256(expectedEncodedRlp);

    assertExternalHash(
      innerSignatureHash,
      signatureHashByRustSdk
    );
    expect(prepared.signatureHash).to.equal(
      innerSignatureHash
    );
    expect(Array.from(prepared.rlpBytes)).to.deep.equal(
      Array.from(expectedEncodedRlp)
    );

    const signed = await prepared.sign(
      createPrivateKeySigner(privateKey)
    );
    assertExternalSignature(signed.signature, {
      r: '0x84e22edd776877aea3a7dee1856bca2aa1b9f2c8f068ca63d481f76ab473d27c',
      s: '0x5c00b209cf14309007fbf013739c30da3262b76316352c03c52a0df304690dd4',
      v: 0,
    });
    expect(signed.signatureHash).to.equal(prepared.signatureHash);

    const req = signed.toRequest();
    expect(req.value).to.equal('273');
  });

  it('prepareTokenManageListTx builds expected rlp bytes and hash', async function () {
    const signatureHashByRustSdk: string | undefined =
      "0x29ad0e54618a9a596d43ceaf87c26ac5c3690452b0d543a9b4abf4b884513a49";

    const prepared = TransactionBuilder.tokenManageList({
      chain_id: 1212101,
      nonce: 2,
      action: ManageListAction.Add,
      address: '0x00000000000000000000000000000000000000aa',
      token: '0x00000000000000000000000000000000000000bb',
    });

    const expectedEncodedRlp = encodeRlpPayload(
      ev.list([
        ev.uint(1212101),
        ev.uint(2),
        ev.string(ManageListAction.Add),
        ev.address(
          '0x00000000000000000000000000000000000000aa'
        ),
        ev.address(
          '0x00000000000000000000000000000000000000bb'
        ),
      ])
    );
    const innerSignatureHash = keccak256(expectedEncodedRlp);
    assertExternalHash(
      innerSignatureHash,
      signatureHashByRustSdk
    );
    expect(prepared.signatureHash).to.equal(
      innerSignatureHash
    );
    expect(Array.from(prepared.rlpBytes)).to.deep.equal(
      Array.from(expectedEncodedRlp)
    );

    const signed = await prepared.sign(
      createPrivateKeySigner(privateKey)
    );
    assertExternalSignature(signed.signature, {
      r: '0xf3abe8475c0783e7af7ef6d5901333790f1447ddcae9e96f87bc3d6116744660',
      s: '0x3e217844e91bd09b630a2ff9c2ed940797e01452406700063f575ccec41c9b45',
      v: 1,
    });
    expect(
      signed.toRequest().action
    ).to.equal(ManageListAction.Add);
  });

  it('prepareTokenBurnTx builds expected rlp bytes and hash', async function () {
    const signatureHashByRustSdk = "0x32d373b3c747b87a00c69ded8b9ab505a5e36d26df30486cb15d8316a10eb52a";

    const prepared = TransactionBuilder.tokenBurn({
      chain_id: 1212101,
      nonce: 2,
      value: '273',
      token: '0x0000000000000000000000000000000000000002',
    });

    const expectedEncodedRlp = encodeRlpPayload(
      ev.list([
        ev.uint(1212101),
        ev.uint(2),
        ev.uint('273'),
        ev.address(
          '0x0000000000000000000000000000000000000002'
        ),
      ])
    );
    const innerSignatureHash = keccak256(expectedEncodedRlp);
    assertExternalHash(
      innerSignatureHash,
      signatureHashByRustSdk
    );
    expect(prepared.signatureHash).to.equal(
      innerSignatureHash
    );
    expect(Array.from(prepared.rlpBytes)).to.deep.equal(
      Array.from(expectedEncodedRlp)
    );

    const signed = await prepared.sign(
      createPrivateKeySigner(privateKey)
    );
    assertExternalSignature(signed.signature, {
      r: '0x67e501e5d041ec7b9df7552bfa9cbab0dd3675245e8d854c8ee2c320e6e46c7e',
      s: '0x01698caeb4a929eea77d596ff001676f6c3c3ae6a51661a3e252d3388d0f2651',
      v: 0,
    });
    expect(signed.toRequest().value).to.equal('273');
  });

  it('prepareTokenAuthorityTx builds expected rlp bytes and hash', async function () {
    const signatureHashByRustSdk = "0xe1eb07cd8808debb2bb2cb21c362ebfa14e94a4bfa703bb081090321c6ac89f5";

    const prepared = TransactionBuilder.tokenAuthority({
      chain_id: 1212101,
      nonce: 2,
      action: AuthorityAction.Grant,
      authority_type: AuthorityType.MasterMint,
      authority_address: '0x0000000000000000000000000000000000000000',
      token: '0x0000000000000000000000000000000000000000',
      value: '123',
    });

    const expectedEncodedRlp = encodeRlpPayload(
      ev.list([
        ev.uint(1212101),
        ev.uint(2),
        ev.string(AuthorityAction.Grant),
        ev.string(AuthorityType.MasterMint),
        ev.address(
          '0x0000000000000000000000000000000000000000'
        ),
        ev.address(
          '0x0000000000000000000000000000000000000000'
        ),
        ev.uint('123'),
      ])
    );
    const innerSignatureHash = keccak256(expectedEncodedRlp);
    assertExternalHash(
      innerSignatureHash,
      signatureHashByRustSdk
    );
    expect(prepared.signatureHash).to.equal(
      innerSignatureHash
    );
    expect(Array.from(prepared.rlpBytes)).to.deep.equal(
      Array.from(expectedEncodedRlp)
    );

    const signed = await prepared.sign(
      createPrivateKeySigner(privateKey)
    );
    assertExternalSignature(signed.signature, {
      r: '0x48f6cb3e20f2adee49448e32cfb0eb91558864e107bfb28bab6bd70102f52f19',
      s: '0x4fb2760e1473d3495ee37b9e419859fd738e6c268cc1bb69eff707c9064948c8',
      v: 1,
    });
    expect(signed.toRequest().authority_type).to.equal(
      AuthorityType.MasterMint
    );
  });

  it('prepareTokenPauseTx builds expected rlp bytes and hash', async function () {
    const signatureHashByRustSdk = "0x4b5f3746109cfd286e91abfec9fc3cc066f67cf3a4f2ad28e90c1bdedd27f19c";

    const prepared = TransactionBuilder.tokenPause({
      chain_id: 1212101,
      nonce: 2,
      action: PauseAction.Pause,
      token: '0x0000000000000000000000000000000000000001',
    });

    const expectedEncodedRlp = encodeRlpPayload(
      ev.list([
        ev.uint(1212101),
        ev.uint(2),
        ev.string(PauseAction.Pause),
        ev.address(
          '0x0000000000000000000000000000000000000001'
        ),
      ])
    );
    const innerSignatureHash = keccak256(expectedEncodedRlp);
    assertExternalHash(
      innerSignatureHash,
      signatureHashByRustSdk
    );
    expect(prepared.signatureHash).to.equal(
      innerSignatureHash
    );
    expect(Array.from(prepared.rlpBytes)).to.deep.equal(
      Array.from(expectedEncodedRlp)
    );

    const signed = await prepared.sign(
      createPrivateKeySigner(privateKey)
    );
    assertExternalSignature(signed.signature, {
      r: '0x86eae4fd501dc756ad971fcc21040d9da9052d162f5b5fff14ae775e0ea2c028',
      s: '0x243b9657474bdb930952e901970c852ea9b43ec3f14f074d52e242999612b620',
      v: 0,
    });
    expect(signed.toRequest().action).to.equal(
      PauseAction.Pause
    );
  });

  it('prepareTokenMetadataTx builds expected rlp bytes and hash', async function () {
    const signatureHashByRustSdk =
      "0x02856c590e9220222e6d76dc1b0ad46a1bd8c098453ac6d91cee436b5571a2a4";

    const additionalMetadata = [];
    const prepared = TransactionBuilder.tokenMetadata({
      chain_id: 1212101,
      nonce: 2,
      name: 'test',
      uri: 'https://test.com',
      token: '0x0000000000000000000000000000000000000001',
      additional_metadata: additionalMetadata,
    });

    const expectedEncodedRlp = encodeRlpPayload(
      ev.list([
        ev.uint(1212101),
        ev.uint(2),
        ev.string('test'),
        ev.string('https://test.com'),
        ev.address(
          '0x0000000000000000000000000000000000000001'
        ),
        ev.list([]),
      ])
    );
    const innerSignatureHash = keccak256(expectedEncodedRlp);
    assertExternalHash(
      innerSignatureHash,
      signatureHashByRustSdk
    );
    expect(prepared.signatureHash).to.equal(
      innerSignatureHash
    );
    expect(Array.from(prepared.rlpBytes)).to.deep.equal(
      Array.from(expectedEncodedRlp)
    );

    const signed = await prepared.sign(
      createPrivateKeySigner(privateKey)
    );
    assertExternalSignature(signed.signature, {
      r: '0xd3457ac518c0a8446a9e7429e1c9bfd80afc4062dc5846ae623f1eb6d79cd234',
      s: '0x490c92a5f9b8c1851e59a5fd13d3386808c23b22d0dad6b66c14db0df7abf82c',
      v: 1,
    });
    expect(signed.toRequest().additional_metadata).to.deep.equal(
      additionalMetadata
    );
  });

  it('prepareTokenMetadataTx builds expected rlp bytes and hash with additionalMetadata', async function () {
    const signatureHashByRustSdk =
      "0x8a975c353c0849587af75d72b8f9db2dd98bd6a149c743e40920e77058ffc125";

    const additionalMetadata = [
      { key: "kkk", value: "vvv" },
      { key: "kkk2", value: "vvv2" }
    ];
    const prepared = TransactionBuilder.tokenMetadata({
      chain_id: 1212101,
      nonce: 2,
      name: 'test',
      uri: 'https://test.com',
      token: '0x0000000000000000000000000000000000000001',
      additional_metadata: additionalMetadata,
    });

    assertExternalHash(
      prepared.signatureHash,
      signatureHashByRustSdk
    );

    const signed = await prepared.sign(
      createPrivateKeySigner(privateKey)
    );
    assertExternalSignature(signed.signature, {
      r: '0x0affb29a93ee501155298b9742dab12881471480f7ea85f9b0b38766de46978a',
      s: '0x4c655aac725ad6a1868c5d66144dcc4a2c8f115d511ebaffb6a02e89acef5a64',
      v: 0,
    });
    expect(signed.toRequest().additional_metadata).to.deep.equal(
      additionalMetadata
    );
  });

  it('prepareTokenBridgeAndMintTx builds expected rlp bytes and hash', async function () {
    const signatureHashByRustSdk =
      "0xca643e2e9408f42b0d8cb44e48ad6b45fbe6a76e0f2a154609c25dd319d8d3ec";

    const sourceTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const prepared = TransactionBuilder.tokenBridgeAndMint({
      chain_id: 1212101,
      nonce: 2,
      recipient: '0x0000000000000000000000000000000000000001',
      value: '273',
      token: '0x0000000000000000000000000000000000000002',
      source_chain_id: 1,
      source_tx_hash: sourceTxHash,
      bridge_metadata: '',
    });

    const expectedEncodedRlp = encodeRlpPayload(
      ev.list([
        ev.uint(1212101),
        ev.uint(2),
        ev.address(
          '0x0000000000000000000000000000000000000001'
        ),
        ev.uint('273'),
        ev.address(
          '0x0000000000000000000000000000000000000002'
        ),
        ev.uint(1),
        ev.string(sourceTxHash),
        ev.string(''),
      ])
    );
    const innerSignatureHash = keccak256(expectedEncodedRlp);
    assertExternalHash(
      innerSignatureHash,
      signatureHashByRustSdk
    );
    expect(prepared.signatureHash).to.equal(
      innerSignatureHash
    );
    expect(Array.from(prepared.rlpBytes)).to.deep.equal(
      Array.from(expectedEncodedRlp)
    );

    const signed = await prepared.sign(
      createPrivateKeySigner(privateKey)
    );
    assertExternalSignature(signed.signature, {
      r: '0xde045904439cc9960bc54a43c2da2be54d3102309dd26d0eea38ea37217a6f47',
      s: '0x2444688b614ed49ffe10e252b5fb5ed33b6264d4de38a95e5165d8cf23d94087',
      v: 0,
    });
    expect(signed.toRequest().source_tx_hash).to.equal(
      sourceTxHash
    );
  });

  it('prepareTokenBurnAndBridgeTx builds expected rlp bytes and hash', async function () {
    const signatureHashByRustSdk =
      "0xc45e33f8700933a9dc5ddf913de29bc0b92937a81bf6d47c7d5ea6e82c6caa11";

    const prepared = TransactionBuilder.tokenBurnAndBridge({
      chain_id: 1212101,
      nonce: 2,
      sender: '0x0000000000000000000000000000000000000001',
      value: '273',
      token: '0x0000000000000000000000000000000000000002',
      destination_chain_id: 1,
      destination_address:
        '0x1234567890abcdef1234567890abcdef12345678',
      escrow_fee: '1000000',
      bridge_metadata: '',
      bridge_param: '0x',
    });

    const expectedEncodedRlp = encodeRlpPayload(
      ev.list([
        ev.uint(1212101),
        ev.uint(2),
        ev.address(
          '0x0000000000000000000000000000000000000001'
        ),
        ev.uint('273'),
        ev.address(
          '0x0000000000000000000000000000000000000002'
        ),
        ev.uint(1),
        ev.string(
          '0x1234567890abcdef1234567890abcdef12345678'
        ),
        ev.uint('1000000'),
        ev.string(''),
        ev.hex('0x'),
      ])
    );
    const innerSignatureHash = keccak256(expectedEncodedRlp);
    assertExternalHash(
      innerSignatureHash,
      signatureHashByRustSdk
    );
    expect(prepared.signatureHash).to.equal(
      innerSignatureHash
    );
    expect(Array.from(prepared.rlpBytes)).to.deep.equal(
      Array.from(expectedEncodedRlp)
    );

    const signed = await prepared.sign(
      createPrivateKeySigner(privateKey)
    );
    assertExternalSignature(signed.signature, {
      r: '0x6f3daaff7fa5f6422f6ecbc9d86ef9b34d0edce58813868b5eef960f4d9d02ba',
      s: '0x0ad21d51fcfd0372ed36e0ced7a70abe18919eece22e97e3ff2406c7e71298f0',
      v: 1,
    });
    expect(signed.toRequest().bridge_param).to.equal(
      '0x'
    );
  });

  it('prepareTokenClawbackTx builds expected rlp bytes and hash', async function () {
    const signatureHashByRustSdk =
      "0x30de10118795bc6f2277e37ed7acbf289b3ae93d2323a676faa479849c03302e";

    const prepared = TransactionBuilder.tokenClawback({
      chain_id: 1212101,
      nonce: 2,
      token: '0x0000000000000000000000000000000000000002',
      from: '0x0000000000000000000000000000000000000003',
      recipient: '0x0000000000000000000000000000000000000001',
      value: '273',
    });

    const expectedEncodedRlp = encodeRlpPayload(
      ev.list([
        ev.uint(1212101),
        ev.uint(2),
        ev.address(
          '0x0000000000000000000000000000000000000002'
        ),
        ev.address(
          '0x0000000000000000000000000000000000000003'
        ),
        ev.address(
          '0x0000000000000000000000000000000000000001'
        ),
        ev.uint('273'),
      ])
    );
    const innerSignatureHash = keccak256(expectedEncodedRlp);
    assertExternalHash(
      innerSignatureHash,
      signatureHashByRustSdk
    );
    expect(prepared.signatureHash).to.equal(
      innerSignatureHash
    );
    expect(Array.from(prepared.rlpBytes)).to.deep.equal(
      Array.from(expectedEncodedRlp)
    );

    const signed = await prepared.sign(
      createPrivateKeySigner(privateKey)
    );
    assertExternalSignature(signed.signature, {
      r: '0x03d36d994d239e1e94857a74750215548d68e2cdc338d1bcd7a437dda3e8c78f',
      s: '0x11ee5489c5b901ab75d207d534d7906b55d4a8ec92fb37ea19a4d9f6d56ebfa5',
      v: 1,
    });
    expect(signed.toRequest().from).to.equal(
      '0x0000000000000000000000000000000000000003'
    );
  });

  describe('Custom SignerAdapter tests', function () {
    it('should accept custom signer with valid low-S signature', async function () {
      const prepared = TransactionBuilder.payment({
        chain_id: 1212101,
        nonce: 0,
        recipient: '0xa634dfba8c7550550817898bc4820cd10888aac5',
        value: '10',
        token: '0x5458747a0efb9ebeb8696fcac1479278c0872fbe',
      });

      // Custom signer that returns a valid low-S signature
      const customSigner = {
        signDigest: async (digest: ZeroXString): Promise<Signature> => {
          expect(digest).to.equal(prepared.signatureHash);
          // Return a known valid low-S signature
          return {
            r: '0x41e1e158803da19ef1fc9ab35d86776cb02ac493265b948ff18b2c57a4e52432',
            s: '0x21f42bb02796a424b0961af374a71e0b948e8fadb58f1e5c6ac861be656265e1',
            v: 0,
          };
        },
      };

      const signed = await prepared.sign(customSigner);
      expect(signed.signature.r).to.equal(
        '0x41e1e158803da19ef1fc9ab35d86776cb02ac493265b948ff18b2c57a4e52432'
      );
      expect(signed.signature.s).to.equal(
        '0x21f42bb02796a424b0961af374a71e0b948e8fadb58f1e5c6ac861be656265e1'
      );
      expect(signed.txHash).to.match(/^0x[0-9a-f]{64}$/);
    });

    it('should reject custom signer with high-S signature (malleability protection)', async function () {
      const prepared = TransactionBuilder.payment({
        chain_id: 1212101,
        nonce: 0,
        recipient: '0xa634dfba8c7550550817898bc4820cd10888aac5',
        value: '10',
        token: '0x5458747a0efb9ebeb8696fcac1479278c0872fbe',
      });

      // Custom signer that returns an invalid high-S signature
      const customSignerWithHighS = {
        signDigest: async (digest: ZeroXString): Promise<Signature> => {
          // Return a high-S signature (above secp256k1n/2)
          return {
            r: '0x41e1e158803da19ef1fc9ab35d86776cb02ac493265b948ff18b2c57a4e52432',
            // This S value is intentionally high (above the threshold)
            s: '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
            v: 0,
          };
        },
      };

      try {
        await prepared.sign(customSignerWithHighS);
        expect.fail('Should have thrown error for high-S signature');
      } catch (error: any) {
        expect(error.message).to.include('[1Money SDK]');
        expect(error.message).to.include('high S value');
        expect(error.message).to.include('malleability');
      }
    });

    it('should validate signature when using attachSignature directly', function () {
      const prepared = TransactionBuilder.payment({
        chain_id: 1212101,
        nonce: 0,
        recipient: '0xa634dfba8c7550550817898bc4820cd10888aac5',
        value: '10',
        token: '0x5458747a0efb9ebeb8696fcac1479278c0872fbe',
      });

      // Valid low-S signature should work
      const validSignature: Signature = {
        r: '0x41e1e158803da19ef1fc9ab35d86776cb02ac493265b948ff18b2c57a4e52432',
        s: '0x21f42bb02796a424b0961af374a71e0b948e8fadb58f1e5c6ac861be656265e1',
        v: 0,
      };

      const signed = prepared.attachSignature(validSignature);
      expect(signed.signature).to.deep.equal(validSignature);
      expect(signed.txHash).to.match(/^0x[0-9a-f]{64}$/);
    });

    it('should reject high-S signature when using attachSignature directly', function () {
      const prepared = TransactionBuilder.payment({
        chain_id: 1212101,
        nonce: 0,
        recipient: '0xa634dfba8c7550550817898bc4820cd10888aac5',
        value: '10',
        token: '0x5458747a0efb9ebeb8696fcac1479278c0872fbe',
      });

      // Invalid high-S signature should be rejected
      const highSSignature: Signature = {
        r: '0x41e1e158803da19ef1fc9ab35d86776cb02ac493265b948ff18b2c57a4e52432',
        s: '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
        v: 0,
      };

      expect(() => prepared.attachSignature(highSSignature)).to.throw(
        '[1Money SDK]: Invalid signature - high S value detected (potential malleability)'
      );
    });

    it('should work with boolean v value in custom signer', async function () {
      const prepared = TransactionBuilder.payment({
        chain_id: 1212101,
        nonce: 0,
        recipient: '0xa634dfba8c7550550817898bc4820cd10888aac5',
        value: '10',
        token: '0x5458747a0efb9ebeb8696fcac1479278c0872fbe',
      });

      const customSigner = {
        signDigest: async (digest: ZeroXString): Promise<Signature> => {
          return {
            r: '0x41e1e158803da19ef1fc9ab35d86776cb02ac493265b948ff18b2c57a4e52432',
            s: '0x21f42bb02796a424b0961af374a71e0b948e8fadb58f1e5c6ac861be656265e1',
            v: false as any, // boolean v value
          };
        },
      };

      const signed = await prepared.sign(customSigner);
      expect(signed.signature.v).to.equal(false);
      expect(signed.txHash).to.match(/^0x[0-9a-f]{64}$/);
    });

    it('should reject invalid digest format in createPrivateKeySigner', async function () {
      const signer = createPrivateKeySigner(privateKey);

      try {
        await signer.signDigest('0xinvalid' as ZeroXString);
        expect.fail('Should have thrown error for invalid digest');
      } catch (error: any) {
        expect(error.message).to.include('[1Money SDK]');
        expect(error.message).to.include('Invalid digest');
      }
    });

    it('should reject non-hex digest in createPrivateKeySigner', async function () {
      const signer = createPrivateKeySigner(privateKey);

      try {
        await signer.signDigest('not-a-hex-string' as ZeroXString);
        expect.fail('Should have thrown error for non-hex digest');
      } catch (error: any) {
        expect(error.message).to.include('[1Money SDK]');
        expect(error.message).to.include('Invalid digest');
      }
    });

    it('should accept exactly 64 hex characters (32 bytes) for digest', async function () {
      const signer = createPrivateKeySigner(privateKey);

      // Valid 32-byte digest
      const validDigest =
        '0xe9e5e0f091a176e9eb239b17b930f5cd8d10e5782127b854840df65c67e22f99' as ZeroXString;

      const signature = await signer.signDigest(validDigest);
      expect(signature.r).to.match(/^0x[0-9a-f]{64}$/);
      expect(signature.s).to.match(/^0x[0-9a-f]{64}$/);
      expect(signature.v === 0 || signature.v === 1).to.equal(true);
    });
  });
});
