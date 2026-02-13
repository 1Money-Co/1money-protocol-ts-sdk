import { encode as rlpEncode } from '@ethereumjs/rlp';
import {
  hexToBytes,
  numberToHex,
} from 'viem';

import type {
  PlpPayload,
  ZeroXString
} from './interface';

const ADDRESS_HEX_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES_HEX_RE = /^0x([0-9a-fA-F]{2})*$/;
type EncodedRlpPayloadItem = Uint8Array | EncodedRlpPayloadItem[];

function innerEncodeRlpPayload(
  value: PlpPayload
): EncodedRlpPayloadItem {
  if (value === null || value === undefined) {
    return new Uint8Array([]);
  }

  switch (value.kind) {
    case 'string':
      return new TextEncoder().encode(value.value);
    case 'uint': {
      if (
        typeof value.value === 'string' &&
        !/^\d+$/.test(value.value)
      ) {
        throw new Error(
          `[1Money encodeRlpPayload]: Invalid uint string: ${value.value}`
        );
      }

      const n =
        typeof value.value === 'bigint'
          ? value.value
          : BigInt(value.value);
      return n === BigInt(0)
        ? new Uint8Array([])
        : hexToBytes(numberToHex(n));
    }
    case 'bool':
      return value.value
        ? Uint8Array.from([1])
        : new Uint8Array([]);
    case 'bytes':
      return value.value;
    case 'list':
      return value.value.map(v => innerEncodeRlpPayload(v));
    case 'address':
    case 'hex':
      if (!BYTES_HEX_RE.test(value.value)) {
        throw new Error(
          `[1Money encodeRlpPayload]: Invalid hex value: ${value.value}`
        );
      }

      if (
        value.kind === 'address' &&
        !ADDRESS_HEX_RE.test(value.value)
      ) {
        throw new Error(
          `[1Money encodeRlpPayload]: Invalid address value: ${value.value}`
        );
      }

      return value.value === '0x'
        ? new Uint8Array([])
        : hexToBytes(value.value);
  }
}

export const rlpValue = {
  address: (v: ZeroXString): PlpPayload => ({
    kind: 'address',
    value: v
  }),
  hex: (v: ZeroXString): PlpPayload => ({
    kind: 'hex',
    value: v
  }),
  string: (v: string): PlpPayload => ({
    kind: 'string',
    value: v
  }),
  uint: (v: bigint | number | string): PlpPayload => ({
    kind: 'uint',
    value: v
  }),
  bool: (v: boolean): PlpPayload => ({
    kind: 'bool',
    value: v
  }),
  bytes: (v: Uint8Array): PlpPayload => ({
    kind: 'bytes',
    value: v
  }),
  list: (v: PlpPayload[]): PlpPayload => ({
    kind: 'list',
    value: v
  })
};

export function encodeRlpPayload(payload: PlpPayload) {
  return rlpEncode(innerEncodeRlpPayload(payload));
}
