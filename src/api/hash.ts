// A lowercase "0x" prefix or none, and 64 hex digits in any case:
// what the pinned Rust build accepts (B256::from_str through
// const-hex 1.18.1 at l1client dc5cffa0b). It refuses "0X".
const HASH_HEX = /^(0x)?[0-9a-fA-F]{64}$/;

// Two 32-byte hashes in hex, compared as the Rust SDK compares B256
// values. A node answer is unknown data: anything that is not such a
// string never matches.
export function sameHash(a: unknown, b: unknown): boolean {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    HASH_HEX.test(a) &&
    HASH_HEX.test(b) &&
    a.replace(/^0x/, '').toLowerCase() ===
      b.replace(/^0x/, '').toLowerCase()
  );
}
