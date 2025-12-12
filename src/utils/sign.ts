import { encode as rlpEncode } from '@ethereumjs/rlp';
import { signAsync } from '@noble/secp256k1';
import {
  keccak256,
  hexToBytes,
  stringToBytes,
  stringToHex,
  boolToHex,
  numberToHex,
  bytesToHex,
} from 'viem';

import { _typeof } from './typeof';

import type { ZeroXString, Signature, Payload } from './interface';

type RlpPayload = Exclude<Payload, boolean | Payload[]> & Exclude<Payload, boolean | Payload[]>;
/**
 * RLP encode a payload into a digest
 * @param payload Payload to encode
 * @returns RLP encoded payload
 */
export function encodePayload(payload: Payload) {
  if (_typeof(payload) === 'array') {
    const formatted = (payload as Array<Payload>).map((v) => {
      if (_typeof(v) === 'string') {
        if (/^0x[0-9a-fA-F]+$/.test(v as string)) {
          // hex-encoded data → raw bytes
          return hexToBytes(v as ZeroXString);
        } else if (/^\d+$/.test(v as string)) {
          // number-like string → hex → bytes
          // Use BigInt for large numbers to avoid overflow
          return v === '0' ? new Uint8Array([]) : hexToBytes(numberToHex(BigInt(v as string)));
        } else {
          // plain string → UTF-8 bytes
          return new TextEncoder().encode(v as string);
        }
      } else if (_typeof(v) === 'number' || _typeof(v) === 'bigint') {
        // produce minimal hex, then arrayify
        return v === 0 || v === BigInt(0) ? new Uint8Array([]) : hexToBytes(numberToHex(v as number | bigint));
      } else if (_typeof(v) === 'boolean') {
        return v ? Uint8Array.from([1]) : new Uint8Array([]);
      } else {
        return v;
      }
    }) as RlpPayload[];
  
    return rlpEncode(formatted);
  }

  if (_typeof(payload) === 'boolean') {
    return rlpEncode(payload ? Uint8Array.from([1]) : new Uint8Array([]));
  }

  return rlpEncode(payload as RlpPayload);
}

/**
 * Sign a message using the provided private key
 * @param payload Payload to sign
 * @param privateKey Private key to sign with
 * @returns Signature object with r, s, v components
 */
export async function signMessage(payload: Payload, privateKey: ZeroXString): Promise<Signature> {
  const encoded = encodePayload(payload);
  const digestHex = keccak256(encoded);
  const digest = hexToBytes(digestHex);

  const privateKeyBytes = hexToBytes(privateKey);

  const signature = await signAsync(digest, privateKeyBytes, { lowS: true });
  const compact = signature.toCompactRawBytes();
  const rBytes = compact.subarray(0, 32);
  const sBytes = compact.subarray(32, 64);

  return {
    r: bytesToHex(rBytes),
    s: bytesToHex(sBytes),
    v: signature.recovery,
  };
}

export function toHex(value: any): ZeroXString {
  const type = _typeof(value);
  try {
    switch (type) {
      case 'boolean':
        return boolToHex(value as boolean);
      case 'number':
      case 'bigint':
        return numberToHex(value as number | bigint);
      case 'string':
        // Only accept valid integer strings (no decimals, no whitespace, no empty)
        if (/^-?\d+$/.test(value as string)) {
          // Use BigInt for potentially large numbers to avoid overflow
          try {
            return numberToHex(BigInt(value as string));
          } catch {
            return numberToHex(+value);
          }
        }
        return stringToHex(value as string);
      case 'uint8array':
      case 'uint16array':
      case 'uint32array':
      case 'int8array':
      case 'int16array':
      case 'int32array':
      case 'arraybuffer':
        return bytesToHex(value as Uint8Array);
      case 'array':
        if ((value as Array<any>).length === 0) return '0x';
        else if ((value as Array<any>).every(item => typeof item === 'number')) return bytesToHex(Uint8Array.from(value as number[]));
        else return bytesToHex(stringToBytes(JSON.stringify(value)));
      default:
        return bytesToHex(stringToBytes(JSON.stringify(value)));
    }
  } catch (e) {
    console.error('[1Money toHex]: ', e);
    return '0x';
  }
}
