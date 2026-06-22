import { encodeAbiParameters, parseAbiParameters, encodeFunctionData } from 'viem';

import { validateMemo } from '@/utils';

import { EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION, EIP712_VERIFYING_CONTRACT, PAYMENT_KIND, SOL_MEMO_FIELDS } from './registry';

import type { Memo, ZeroXString } from '@/utils';
import type { Eip712Signature } from './registry';

const SUBMIT_TYPED_DATA_ABI = [{
  type: 'function', name: 'submitTypedData',
  inputs: [{ name: 'envelope', type: 'tuple', components: [
    { name: 'kind', type: 'uint8' }, { name: 'payload', type: 'bytes' },
    { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
  ]}], outputs: [],
}] as const;

export interface PaymentTypedTxInput { chain_id: number; nonce: number; recipient: string; value: string; token: string; memo?: Memo; }
export interface PaymentEip712TypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: { PaymentV1: typeof PAYMENT_KIND.eip712Fields; SolMemo: typeof SOL_MEMO_FIELDS };
  primaryType: 'PaymentV1';
  message: { chainId: number; nonce: number; recipient: string; value: string; token: string; memo: { memoType: string; memoFormat: string; memoData: string } };
}
export interface PreparedTypedTx {
  kind: string; primaryType: string; typedData: PaymentEip712TypedData;
  encodeCalldata: (sig: Eip712Signature) => { to: string; data: ZeroXString; value: bigint; gas: bigint; gasPrice: bigint; type: 'legacy' };
}

export function buildPaymentEip712TypedData(input: PaymentTypedTxInput): PaymentEip712TypedData {
  if (input.memo) validateMemo(input.memo);
  return {
    domain: { name: EIP712_DOMAIN_NAME, version: EIP712_DOMAIN_VERSION, chainId: input.chain_id, verifyingContract: EIP712_VERIFYING_CONTRACT },
    types: { PaymentV1: PAYMENT_KIND.eip712Fields, SolMemo: SOL_MEMO_FIELDS },
    primaryType: 'PaymentV1',
    message: {
      chainId: input.chain_id, nonce: input.nonce, recipient: input.recipient, value: input.value, token: input.token,
      memo: { memoType: input.memo?.type ?? '', memoFormat: input.memo?.format ?? '', memoData: input.memo?.data ?? '' },
    },
  };
}

export function preparePaymentTypedTx(input: PaymentTypedTxInput): PreparedTypedTx {
  const typedData = buildPaymentEip712TypedData(input);
  const memo = typedData.message.memo;
  const encodeCalldata = (sig: Eip712Signature) => {
    if (sig.v !== 27 && sig.v !== 28) throw new Error(`[1Money SDK]: EIP-712 v must be 27 or 28, got ${sig.v}`);
    const payload = encodeAbiParameters(parseAbiParameters(PAYMENT_KIND.abiParams), [[
      BigInt(input.chain_id), BigInt(input.nonce), input.recipient as ZeroXString, BigInt(input.value), input.token as ZeroXString,
      [memo.memoType, memo.memoFormat, memo.memoData],
    ]]);
    const data = encodeFunctionData({ abi: SUBMIT_TYPED_DATA_ABI, functionName: 'submitTypedData', args: [{ kind: PAYMENT_KIND.discriminant, payload, v: sig.v, r: sig.r, s: sig.s }] }) as ZeroXString;
    return { to: input.token, data, value: 0n, gas: 21000n, gasPrice: 0n, type: 'legacy' as const };
  };
  return { kind: PAYMENT_KIND.abiName, primaryType: PAYMENT_KIND.primaryType, typedData, encodeCalldata };
}
