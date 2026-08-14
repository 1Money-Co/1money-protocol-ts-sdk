import { expect } from 'chai';
import 'mocha';

import {
  encodeRlpPayload,
  rlpValue as ev
} from '../';

describe('rlpValue.byteList', function () {
  it('encodes each byte as its own RLP item', function () {
    const bytes = Uint8Array.from([
      0x02, 0x11, 0x11
    ]);
    const actual = encodeRlpPayload(
      ev.byteList(bytes)
    );
    // 0xc0 + 3 payload bytes, each below 0x80 so each is itself.
    expect(Array.from(actual)).to.deep.equal([
      0xc3, 0x02, 0x11, 0x11
    ]);
  });

  it('encodes 0x00 as the empty string 0x80', function () {
    const actual = encodeRlpPayload(
      ev.byteList(Uint8Array.from([0x00]))
    );
    expect(Array.from(actual)).to.deep.equal([
      0xc1, 0x80
    ]);
  });

  it('encodes bytes at or above 0x80 as two-byte strings', function () {
    const actual = encodeRlpPayload(
      ev.byteList(Uint8Array.from([0x80, 0xff]))
    );
    expect(Array.from(actual)).to.deep.equal([
      0xc4, 0x81, 0x80, 0x81, 0xff
    ]);
  });

  it('differs from the byte-string encoding of the same bytes', function () {
    const bytes = Uint8Array.from([0x02, 0x11]);
    expect(
      Array.from(
        encodeRlpPayload(ev.byteList(bytes))
      )
    ).to.not.deep.equal(
      Array.from(
        encodeRlpPayload(ev.bytes(bytes))
      )
    );
  });
});
