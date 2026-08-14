import type {
  BatchPaymentData,
  BatchReceiptInfo,
  FinalizedTransactionReceipt,
  Transaction,
  TransactionReceipt
} from '../../transactions/types';

type BatchPaymentDataHasNoMaxFee =
  'max_fee' extends keyof BatchPaymentData ? never : true;

const batchPaymentDataHasNoMaxFee: BatchPaymentDataHasNoMaxFee =
  true;

export const SENDER = `0x${'11'.repeat(20)}`;
export const TOKEN = `0x${'22'.repeat(20)}`;
export const RECIPIENT = `0x${'33'.repeat(20)}`;
export const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
export const TRANSACTION_HASH = `0x${'44'.repeat(32)}`;
export const CHECKPOINT_HASH = `0x${'55'.repeat(32)}`;
export const OPERATIONS_HASH = `0x${'66'.repeat(32)}`;

export const batchPaymentReceiptFixture = {
  success: true,
  transaction_hash: TRANSACTION_HASH,
  transaction_index: 4,
  fee_used: '15',
  from: SENDER,
  checkpoint_hash: CHECKPOINT_HASH,
  checkpoint_number: 9,
  recipient: null,
  token_address: TOKEN,
  success_info: {
    sender: SENDER,
    receiver: ZERO_ADDRESS,
    is_private: false,
    message: 'batch payment success: 2 operations',
    bridge_info: null
  },
  batch_info: {
    batch_id: 'payroll-1',
    operations_hash: OPERATIONS_HASH,
    operations_count: 2,
    total_amount: '15',
    failure: null
  },
  execution_events: [
    {
      event_type: 'BatchStarted',
      batch_id: 'payroll-1',
      operations_count: 2,
      total_amount: '15',
      operations_hash: OPERATIONS_HASH
    },
    {
      event_type: 'PaymentExecuted',
      operation_index: 0,
      recipient: RECIPIENT,
      amount: '10'
    },
    {
      event_type: 'BatchCompleted',
      batch_id: 'payroll-1',
      operations_count: 2,
      total_amount: '15',
      operations_hash: OPERATIONS_HASH
    }
  ]
} satisfies TransactionReceipt;

export const paymentSuccessReceiptFixture = {
  success: true,
  transaction_hash: TRANSACTION_HASH,
  fee_used: '5',
  from: SENDER,
  recipient: RECIPIENT,
  token_address: TOKEN,
  success_info: {
    sender: SENDER,
    receiver: RECIPIENT,
    is_private: false,
    message: 'payment success',
    bridge_info: {
      bbnonce: 7,
      destination_chain_id: 8453,
      destination_address: RECIPIENT,
      bridge_param: '0x0123'
    }
  }
} satisfies TransactionReceipt;

export const forwardCompatibleBatchFailureFixture = {
  batch_id: 'payroll-2',
  operations_hash: OPERATIONS_HASH,
  operations_count: 2,
  total_amount: '15',
  failure: {
    failed_operation_index: 1,
    reason: 'insufficient funds'
  }
} satisfies BatchReceiptInfo;

export const finalizedBatchPaymentReceiptFixture = {
  ...batchPaymentReceiptFixture,
  epoch: 12,
  counter_signatures: [
    {
      r: '0x01',
      s: '0x02',
      v: 27
    }
  ]
} satisfies FinalizedTransactionReceipt;

export const batchPaymentTransactionFixture = {
  hash: TRANSACTION_HASH,
  checkpoint_hash: CHECKPOINT_HASH,
  checkpoint_number: 9,
  transaction_index: 4,
  chain_id: 1,
  from: SENDER,
  nonce: 3,
  signature: {
    r: '0x01',
    s: '0x02',
    v: 27
  },
  transaction_type: 'BatchPayment',
  data: {
    token: TOKEN,
    operations: [
      {
        recipient: RECIPIENT,
        amount: '10'
      },
      {
        recipient: SENDER,
        amount: '5'
      }
    ],
    operations_hash: OPERATIONS_HASH,
    batch_id: 'payroll-1',
    created_at: 1723334400
  }
} satisfies Transaction;

void batchPaymentDataHasNoMaxFee;
