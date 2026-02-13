import { expect } from "chai";
import 'dotenv/config';
import "mocha";
import {
  _typeof,
  calcTxHash,
  deriveTokenAddress,
  encodePayload,
  encodeRlpPayload,
  safePromiseAll,
  safePromiseLine,
  signMessage,
  toHex,
  rlpValue as v
} from "../";

import type { ZeroXString } from '../interface';

const RUN_ENV = process.env.RUN_ENV || 'local';

describe("utils test", function () {
  describe("deriveTokenAddress test", function () {
    it("deriveTokenAddress is a function", function () {
      expect(deriveTokenAddress).to.be.a("function");
    });

    it("call deriveTokenAddress", function () {
      const walletAddress = "0xA634dfba8c7550550817898bC4820cD10888Aac5";
      const mintAddress = "0x8E9d1b45293e30EF38564582979195DD16A16E13";
      const tokenAddress = deriveTokenAddress(walletAddress, mintAddress);
      expect(tokenAddress).to.be.a('string');
      expect(tokenAddress).to.be.equal("0x91b6191015e41469ba2febd7e1722a8ee83de15b");
    });
  });

  describe("_typeof test", function () {
    it("_typeof is a function", function () {
      expect(_typeof).to.be.a("function");
    });
    
    it("call _typeof", function () {
      expect(_typeof(1)).to.be.equal("number");
      expect(_typeof("1")).to.be.equal("string");
      expect(_typeof(true)).to.be.equal("boolean");
      expect(_typeof(null)).to.be.equal("null");
      expect(_typeof(undefined)).to.be.equal("undefined");
      expect(_typeof({})).to.be.equal("object");
      expect(_typeof([])).to.be.equal("array");
      expect(_typeof(() => {})).to.be.equal("function");
      expect(_typeof(new Date())).to.be.equal("date");
      expect(_typeof(/a/)).to.be.equal("regexp");
      expect(_typeof(new Set())).to.be.equal("set");
      expect(_typeof(new Map())).to.be.equal("map");
      expect(_typeof(new Error())).to.be.equal("error");
      expect(_typeof(new Promise(() => {}))).to.be.equal("promise");
      expect(_typeof(BigInt(1))).to.be.equal("bigint");
      expect(_typeof(Symbol("a"))).to.be.equal("symbol");
      expect(_typeof(new WeakMap())).to.be.equal("weakmap");
      expect(_typeof(new WeakSet())).to.be.equal("weakset");
      expect(_typeof(new Uint8Array())).to.be.equal("uint8array");
      expect(_typeof(new Uint16Array())).to.be.equal("uint16array");
      expect(_typeof(new Uint32Array())).to.be.equal("uint32array");
      expect(_typeof(new Int8Array())).to.be.equal("int8array");
      expect(_typeof(new Int16Array())).to.be.equal("int16array");
      expect(_typeof(new Int32Array())).to.be.equal("int32array");
      expect(_typeof(new ArrayBuffer())).to.be.equal("arraybuffer");
    });
  }); 

  describe("encodePayload test", function () {
    it("encodePayload is a function", function () {
      expect(encodePayload).to.be.a("function");
    });

    it("call encodePayload", function () {
      const payload = [
        1212101,
        0,
        '0xA634dfba8c7550550817898bC4820cD10888Aac5',
        '10',
        '0x5458747a0efb9ebeb8696fcac1479278c0872fbe'
      ];
      const encoded = encodePayload(payload);
      expect(encoded).to.be.a("uint8array");
      expect(encoded.length).to.be.equal(49);
      expect(encoded.every(v => v >= 0 && v <= 255)).to.be.true;
      expect([240, 131, 18, 126, 197, 128, 148, 166, 52, 223, 186, 140, 117, 80, 85, 8, 23, 137, 139, 196, 130, 12, 209, 8, 136, 170, 197, 10, 148, 84, 88, 116, 122, 14, 251, 158, 190, 184, 105, 111, 202, 193, 71, 146, 120, 192, 135, 47, 190].every((v, k) => v === encoded[k])).to.be.true;
    });

    it("encodes 0x as empty byte array in list payload", function () {
      const encoded = encodePayload(['0x']);
      expect(encoded).to.be.a("uint8array");
      expect(Array.from(encoded)).to.deep.equal([193, 128]);
    });
  });

  describe("encodePayload2 test", function () {
    it("encodePayload2 is a function", function () {
      expect(encodeRlpPayload).to.be.a("function");
    });

    it("encodes address/hex/string with explicit kind", function () {
      const encoded = encodeRlpPayload(v.list([
        {
          kind: 'address',
          value: '0x0000000000000000000000000000000000000001',
        },
        {
          kind: 'hex',
          value: '0x6869',
        },
        {
          kind: 'string',
          value: '0x6869',
        },
      ]));

      expect(encoded).to.be.a('uint8array');
      expect(Array.from(encoded)).to.deep.equal([
        223, 148, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 130, 104, 105, 134, 48, 120, 54, 56, 54, 57
      ]);
    });

    it("encodes hex 0x as empty byte array", function () {
      const encoded = encodeRlpPayload(v.list([
        {
          kind: 'hex',
          value: '0x',
        },
      ]));

      expect(encoded).to.be.a('uint8array');
      expect(Array.from(encoded)).to.deep.equal([193, 128]);
    });

    it("supports ev helpers with uint/bool/list", function () {
      const encoded = encodeRlpPayload(v.list([
        v.uint(1n),
        v.bool(true),
        v.list([v.string('ok'), v.hex('0x01')]),
      ]));

      expect(encoded).to.be.a('uint8array');
      expect(Array.from(encoded)).to.deep.equal([199, 1, 1, 196, 130, 111, 107, 1]);
    });

    it("supports bytes and null/undefined as empty bytes", function () {
      const encoded = encodeRlpPayload(
        v.list([
          v.bytes(Uint8Array.from([1, 2])),
          null,
          undefined,
        ])
      );

      expect(encoded).to.be.a('uint8array');
      expect(Array.from(encoded)).to.deep.equal([197, 130, 1, 2, 128, 128]);
    });

    it("supports top-level non-list payload", function () {
      const encoded = encodeRlpPayload(v.uint(1n));
      expect(encoded).to.be.a('uint8array');
      expect(Array.from(encoded)).to.deep.equal([1]);
    });

    it("throws on invalid uint string", function () {
      expect(() => encodeRlpPayload(v.uint('12.3'))).to.throw(
        '[1Money encodePayload2]: Invalid uint string: 12.3'
      );
      expect(() => encodeRlpPayload(v.uint('-1'))).to.throw(
        '[1Money encodePayload2]: Invalid uint string: -1'
      );
    });
  });

  describe("safePromiseAll test", function () {
    it("safePromiseAll is a function", function () {
      expect(safePromiseAll).to.be.a("function");
    });

    it("call safePromiseAll", function (done) {
      const timer = [100, 500, 1000];
      safePromiseAll(
        timer.map(t => new Promise<number>((resolve) => setTimeout(() => resolve(t), t)))
      ).then((res: number[]) => {
        expect(res.reduce((prev, curr) => prev + curr)).to.be.equal(1600);
        done();
      });
    });

    it("call safePromiseAll with empty array", function (done) {
      safePromiseAll([]).then(res => {
        expect(res).to.be.an('array');
        expect(res).to.be.empty;
        done();
      });
    });

    it("safePromiseAll with undefined", function (done) {
      // @ts-expect-error
      safePromiseAll().then(res => {
        expect(res).to.be.an('array');
        expect(res).to.be.empty;
        done();
      });
    });
  });

  describe("safePromiseLine test", function () {
    it("safePromiseLine is a function", function () {
      expect(safePromiseLine).to.be.a("function");
    });

    it("call safePromiseLine", function (done) {
      const timer = [100, 500, 1000];
      safePromiseLine(
        timer.map(t => () => new Promise<number>((resolve) => setTimeout(() => resolve(t), t)))
      ).then(res => {
        expect(res.reduce((prev, curr) => prev + curr)).to.be.equal(1600);
        done();
      });
    });
  });

  describe("signMessage test", function () {
    it("signMessage is a function", function () {
      expect(signMessage).to.be.a("function");
    });
    
    const testPK = process.env.TEST_PRIVATE_KEY;
    if (testPK && RUN_ENV !== 'remote') {
      it("call signMessage", function (done) {
        const payload = [
          1,
          'USDT',
          true,
          '0x1234567890',
        ];
        signMessage(payload, testPK as ZeroXString)
          .then(signature => {
            expect(signature).to.be.an("object");
            expect(signature?.r).to.be.a("string");
            expect(signature?.s).to.be.a("string");
            expect(signature?.v).to.be.a("number");
            done();
          });
      });
    }
  });

  describe("toHex test", function () {
    it("toHex is a function", function () {
      expect(toHex).to.be.a("function");
    });

    it("call toHex", function () {
      expect(toHex(1)).to.be.equal("0x1");
      expect(toHex("2")).to.be.equal("0x2");
      expect(toHex(true)).to.be.equal("0x1");
      expect(toHex(false)).to.be.equal("0x0");
      expect(toHex(null)).to.be.equal("0x6e756c6c");
      expect(toHex(undefined)).to.be.equal("0x");
      expect(toHex({})).to.be.equal("0x7b7d");
      expect(toHex([])).to.be.equal("0x");
      expect(toHex(new Error())).to.be.equal("0x7b7d");
    });    
  });

  describe("calcTxHash test", function () {
    it("calcTxHash is a function", function () {
      expect(calcTxHash).to.be.a("function");
    });

    it("call calcTxHash", function () {
      const payload = [
        1212101,
        2,
        '0x0000000000000000000000000000000000000000',
        1024,
        '0x0000000000000000000000000000000000000000',
      ];
      const signature = {
        r: '0xe9ef6ce7aaeb4656f197b63a96c932ab5e0fd2df0913f6af1c8e7b1879e5ed0a' as const,
        s: '0x68a9cbaa35af5e3d896a2841d19a42dba729380a1c91864403de872578f6f6c3' as const,
        v: 0,
      };
      const hash = calcTxHash(payload, signature);
      expect(hash).to.be.a("string");
      expect(hash).to.be.equal("0x87e63407778ce2fc07ba5f51d957eb6966e3eb1f3be75e0287115442bdef1d82");
    });
  });
});
