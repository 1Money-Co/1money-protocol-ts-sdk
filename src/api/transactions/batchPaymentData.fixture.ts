import type { BatchPaymentData } from './types';

type BatchPaymentDataHasNoMaxFee =
  'max_fee' extends keyof BatchPaymentData
    ? never
    : true;

const batchPaymentDataHasNoMaxFee: BatchPaymentDataHasNoMaxFee =
  true;

export const batchPaymentReadFixture = {
  token: null,
  operations: [],
  operations_hash: null,
  batch_id: null,
  created_at: 0,
  batchPaymentDataHasNoMaxFee
} satisfies BatchPaymentData & {
  batchPaymentDataHasNoMaxFee: true;
};
