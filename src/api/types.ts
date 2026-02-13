// Common response types
export interface RESTErrorData {
  error_code: string;
  message: string;
}

// Common schema types
export type AddressSchema = string; // Example: "0x9E1E9688A44D058fF181Ed64ddFAFbBE5CC742Ab"
export type PubKeySchema = string; // Example: "0x03960cb40b1d53a05212611c9412ea6f95b6291d80033e637abe8277f19d7544db"
export type TokenAddressSchema = string; // Example: "0x6ADE9688A44D058fF181Ed64ddFAFbBE5CC742Ac"
export type SignatureSchema = string; // Example: "0xba0e74746dd6877402e121ddcd172a16a2b1616b0e76408521a799a38efc40a363092b65f1acc9c180019a5fa4b17f7a1984d1f8b8cf6b24db6e01b67ab724b91c"
export type B256Schema = string; // Example: "0xf55f9525be94633b56f954d3252d52b8ef42f5fd5f9491b243708471c15cc40c"
export type U256Schema = string; // Large number as string
export type BytesSchema = string; // Example: "0x2efae2eb"

// Common response wrappers
export interface Hash {
  hash: B256Schema;
}

export interface HashWithToken {
  hash: B256Schema;
  token: TokenAddressSchema;
}

export interface RlpEncodablePayload {
  rlpEncodeBytes: () => Uint8Array;
}

export type WithRlpEncodeBytes<T> = T & RlpEncodablePayload;
