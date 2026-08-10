import { expect } from 'chai';
import 'mocha';

import { axiosStatic } from '../../client';
import { LOCAL_API_URL } from '../constants';
import {
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from '../errors';
import transactionsApi from '../transactions';
import type { BatchExecutionEvent } from '../transactions/types';
import {
  batchPaymentReceiptFixture,
  batchPaymentTransactionFixture,
  finalizedBatchPaymentReceiptFixture,
  forwardCompatibleBatchFailureFixture,
  paymentSuccessReceiptFixture,
  ZERO_ADDRESS
} from './fixtures/transactions';

function summarizeEvent(event: BatchExecutionEvent): string {
  switch (event.event_type) {
    case 'BatchStarted':
      return `start:${event.operations_count}`;
    case 'PaymentExecuted':
      return `payment:${event.operation_index}`;
    case 'BatchCompleted':
      return `complete:${event.operations_count}`;
  }
  const exhaustive: never = event;
  return exhaustive;
}

describe('transaction response models', function () {
  it('models Batch Payment receipts and transactions', function () {
    expect(batchPaymentReceiptFixture).to.not.have.property(
      'max_fee'
    );
    expect(batchPaymentTransactionFixture.data).to.not.have.property(
      'max_fee'
    );
    expect(batchPaymentReceiptFixture.fee_used).to.equal('15');
    expect(batchPaymentReceiptFixture.success_info?.receiver).to.equal(
      ZERO_ADDRESS
    );
    expect(batchPaymentReceiptFixture.batch_info?.failure).to.equal(null);
    expect(
      batchPaymentReceiptFixture.execution_events?.map(summarizeEvent)
    ).to.deep.equal(['start:2', 'payment:0', 'complete:2']);
  });

  it('models bridge success and finalized receipt metadata', function () {
    expect(paymentSuccessReceiptFixture.success_info?.bridge_info).to.deep.equal({
      bbnonce: 7,
      destination_chain_id: 8453,
      destination_address: paymentSuccessReceiptFixture.recipient,
      bridge_param: '0x0123'
    });
    expect(
      forwardCompatibleBatchFailureFixture.failure
    ).to.deep.include({
      failed_operation_index: 1,
      reason: 'insufficient funds'
    });
    expect(finalizedBatchPaymentReceiptFixture).to.include({
      transaction_index: 4,
      fee_used: '15',
      checkpoint_number: 9,
      epoch: 12
    });
  });
});

const FROM = `0x${'11'.repeat(20)}`;
const TOKEN = `0x${'22'.repeat(20)}`;
const OPERATIONS = [
  {
    recipient: `0x${'33'.repeat(20)}`,
    amount: '10'
  },
  {
    recipient: `0x${'44'.repeat(20)}`,
    amount: '20'
  }
];

describe('Batch Payment fee estimate', function () {
  let originalAdapter: typeof axiosStatic.defaults.adapter;
  let originalBaseURL: string | undefined;
  let seenMethod: string | undefined;
  let seenUrl: string | undefined;
  let seenBody: unknown;

  before(function () {
    originalAdapter = axiosStatic.defaults.adapter;
    originalBaseURL = axiosStatic.defaults.baseURL;
    axiosStatic.defaults.baseURL = LOCAL_API_URL;
  });

  after(function () {
    axiosStatic.defaults.adapter = originalAdapter;
    axiosStatic.defaults.baseURL = originalBaseURL;
  });

  beforeEach(function () {
    seenMethod = undefined;
    seenUrl = undefined;
    seenBody = undefined;
    axiosStatic.defaults.adapter = (config => {
      seenMethod = config.method;
      seenUrl = config.url;
      seenBody =
        typeof config.data === 'string'
          ? JSON.parse(config.data)
          : config.data;
      return Promise.resolve({
        data: {
          fee: '15',
          plan: 'batch-payment'
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config
      });
    }) as typeof originalAdapter;
  });

  afterEach(function () {
    axiosStatic.defaults.adapter = originalAdapter;
  });

  it('posts the unsigned request to the Batch Payment fee estimate endpoint', async function () {
    const result =
      transactionsApi.estimateBatchPaymentFee({
        from: FROM,
        token: TOKEN,
        operations: OPERATIONS
      });

    expect(await result).to.deep.equal({
      fee: '15',
      plan: 'batch-payment'
    });
    expect(seenMethod).to.equal('post');
    expect(seenUrl).to.equal(
      '/v1/transactions/batch_payment/estimate_fee'
    );
    expect(seenBody).to.deep.equal({
      from: FROM,
      token: TOKEN,
      operations: OPERATIONS
    });
  });

  it('preserves an optional plan from the regular fee estimator', async function () {
    const result = transactionsApi.estimateFee(
      FROM,
      OPERATIONS[0].recipient,
      OPERATIONS[0].amount,
      TOKEN
    );

    expect(await result).to.deep.equal({
      fee: '15',
      plan: 'batch-payment'
    });
  });

  it('rejects a 422 without classifying the estimate as a submitted transaction', async function () {
    axiosStatic.defaults.adapter = (config =>
      Promise.reject({
        message: 'Request failed with status code 422',
        name: 'AxiosError',
        config,
        response: {
          status: 422,
          statusText: 'Unprocessable Entity',
          headers: {},
          config,
          data: {
            message: 'invalid batch payment operation'
          }
        }
      })) as typeof originalAdapter;

    let caught: unknown;
    try {
      await transactionsApi.estimateBatchPaymentFee({
        from: FROM,
        token: TOKEN,
        operations: OPERATIONS
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).to.not.be.instanceOf(
      TransactionSubmissionError
    );
    expect(caught).to.not.be.instanceOf(
      TransactionOutcomeUnknownError
    );
    expect(caught).to.deep.include({
      status: 422,
      data: {
        message: 'invalid batch payment operation'
      }
    });
  });
});
