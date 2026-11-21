const HASH_HEX = /^(0x)?[0-9a-f]{64}$/i;

// Two 32-byte hashes in hex, in any case, with or without
// `0x`, as the Rust SDK compares B256 values. A node answer
// is unknown data: anything that is not such a string never
// matches.
export function sameHash(a: unknown, b: unknown): boolean {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    HASH_HEX.test(a) &&
    HASH_HEX.test(b) &&
    a.replace(/^0x/i, '').toLowerCase() ===
      b.replace(/^0x/i, '').toLowerCase()
  );
}
