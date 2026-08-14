export interface RawRlpItem {
  start: number;
  payloadStart: number;
  payloadEnd: number;
  end: number;
  isList: boolean;
  children: RawRlpItem[];
}

function assertAvailable(
  bytes: Uint8Array,
  start: number,
  length: number
): void {
  if (
    start < 0 ||
    length < 0 ||
    start + length > bytes.length
  ) {
    throw new Error('[test]: truncated RLP item');
  }
}

function readLength(
  bytes: Uint8Array,
  start: number,
  lengthOfLength: number
): number {
  assertAvailable(bytes, start, lengthOfLength);
  let length = 0;
  for (let index = 0; index < lengthOfLength; index += 1) {
    length = length * 256 + bytes[start + index];
    if (!Number.isSafeInteger(length)) {
      throw new Error('[test]: RLP item length is too large');
    }
  }
  return length;
}

export function readRawRlpItem(
  bytes: Uint8Array,
  offset: number
): RawRlpItem {
  assertAvailable(bytes, offset, 1);
  const prefix = bytes[offset];
  let payloadStart: number;
  let payloadLength: number;
  let isList = false;

  if (prefix <= 0x7f) {
    payloadStart = offset;
    payloadLength = 1;
  } else if (prefix <= 0xb7) {
    payloadStart = offset + 1;
    payloadLength = prefix - 0x80;
  } else if (prefix <= 0xbf) {
    const lengthOfLength = prefix - 0xb7;
    payloadStart = offset + 1 + lengthOfLength;
    payloadLength = readLength(
      bytes,
      offset + 1,
      lengthOfLength
    );
  } else if (prefix <= 0xf7) {
    isList = true;
    payloadStart = offset + 1;
    payloadLength = prefix - 0xc0;
  } else {
    isList = true;
    const lengthOfLength = prefix - 0xf7;
    payloadStart = offset + 1 + lengthOfLength;
    payloadLength = readLength(
      bytes,
      offset + 1,
      lengthOfLength
    );
  }

  assertAvailable(bytes, payloadStart, payloadLength);
  const payloadEnd = payloadStart + payloadLength;
  const children: RawRlpItem[] = [];
  if (isList) {
    let childOffset = payloadStart;
    while (childOffset < payloadEnd) {
      const child = readRawRlpItem(bytes, childOffset);
      if (child.end > payloadEnd) {
        throw new Error('[test]: truncated RLP list item');
      }
      children.push(child);
      childOffset = child.end;
    }
    if (childOffset !== payloadEnd) {
      throw new Error('[test]: invalid RLP list length');
    }
  }

  return {
    start: offset,
    payloadStart,
    payloadEnd,
    end: payloadEnd,
    isList,
    children
  };
}
