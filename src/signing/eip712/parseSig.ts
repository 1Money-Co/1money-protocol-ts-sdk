import type { ZeroXString } from '@/utils';
import type { Eip712Signature } from './registry';

// Parse a 0x 65-byte secp256k1 sig (eth_signTypedData_v4 output) into {v,r,s}.
// l1client requires v ∈ {27,28} and rejects 0/1 at ingest; normalize 0→27,1→28.
export function parseSig(hex65: string): Eip712Signature {
  const stripped = hex65.startsWith('0x') ? hex65.slice(2) : hex65;
  if (stripped.length !== 130) {
    throw new Error(`[1Money SDK]: expected 65-byte signature, got ${stripped.length / 2} bytes`);
  }
  const r = `0x${stripped.slice(0, 64)}` as ZeroXString;
  const s = `0x${stripped.slice(64, 128)}` as ZeroXString;
  const vByte = parseInt(stripped.slice(128, 130), 16);
  let v: 27 | 28;
  if (vByte === 27 || vByte === 0) v = 27;
  else if (vByte === 28 || vByte === 1) v = 28;
  else throw new Error(`[1Money SDK]: unexpected signature v byte: 0x${vByte.toString(16)}`);
  return { v, r, s };
}
