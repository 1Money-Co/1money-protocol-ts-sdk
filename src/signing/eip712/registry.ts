import type { ZeroXString } from '@/utils';

export const EIP712_VERIFYING_CONTRACT = '0xfffffffffffffffffffffffffffffffffffffffe' as const;
export const EIP712_DOMAIN_NAME = '1Money Network';
export const EIP712_DOMAIN_VERSION = '1';

export interface Eip712Signature { v: 27 | 28; r: ZeroXString; s: ZeroXString; }
export interface Eip712TypeField { name: string; type: string; }
export interface KindSpec {
  abiName: string;        // discriminant name (Eip712PayloadKind), e.g. 'TransferV1'
  discriminant: number;
  primaryType: string;    // EIP-712 primaryType — NOTE differs from abiName for payment
  eip712Fields: Eip712TypeField[];
  abiParams: string;      // viem tuple string for payload bytes
}

export const SOL_MEMO_FIELDS: Eip712TypeField[] = [
  { name: 'memoType', type: 'string' },
  { name: 'memoFormat', type: 'string' },
  { name: 'memoData', type: 'string' },
];

// One entry per Eip712PayloadKind. Only payment populated today; append more later.
// Mirrors l1client erc20_abi.rs (ABI TransferV1) + eip712_typed.rs (EIP-712 PaymentV1).
export const PAYMENT_KIND: KindSpec = {
  abiName: 'TransferV1',
  discriminant: 0,
  primaryType: 'PaymentV1',
  eip712Fields: [
    { name: 'chainId', type: 'uint64' },
    { name: 'nonce', type: 'uint64' },
    { name: 'recipient', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'memo', type: 'SolMemo' },
  ],
  abiParams: '(uint64,uint64,address,uint256,address,(string,string,string))',
};
