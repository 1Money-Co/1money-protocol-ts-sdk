export type ZeroXString = `0x${string}`;

export interface Signature {
  r: ZeroXString;
  s: ZeroXString;
  v: number | boolean;
}

export type Payload = boolean | string | number | bigint | Uint8Array | Array<Payload> | null | undefined;

export type PlpPayload =
  | {
      kind: 'address';
      value: ZeroXString;
    }
  | {
      kind: 'hex';
      value: ZeroXString;
    }
  | {
      kind: 'string';
      value: string;
    }
  | {
      kind: 'uint';
      value: bigint | number | string;
    }
  | {
      kind: 'bool';
      value: boolean;
    }
  | {
      kind: 'bytes';
      value: Uint8Array;
    }
  | {
      kind: 'list';
      value: PlpPayload[];
    }
  | null
  | undefined;

// export type PlpPayload = EncodedValue;
