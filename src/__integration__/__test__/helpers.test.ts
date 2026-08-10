import { expect } from 'chai';
import {
  TransactionHashMismatchError,
  TransactionOutcomeUnknownError,
  TransactionSubmissionError
} from '@/api/errors';

import {
  classifyBatchFailureSubmission,
  isConfirmedReadNotFound,
  observeForWindow,
  waitForResult
} from '../helpers';

import type { ParsedError } from '@/client/core';

function readError(
  status: number,
  message: string,
  name: string = 'AxiosError'
): ParsedError {
  return {
    name,
    message,
    stack: '',
    status,
    data: { message }
  };
}

describe('integration polling helper', function () {
  it('returns an immediately available result', async function () {
    const result = await waitForResult(
      async () => 'ready',
      { attempts: 1, intervalMs: 0 }
    );

    expect(result).to.equal('ready');
  });

  it('returns a result after transient failures', async function () {
    let attempts = 0;
    const result = await waitForResult(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('not ready');
        }
        return 3;
      },
      { attempts: 3, intervalMs: 0 }
    );

    expect(result).to.equal(3);
    expect(attempts).to.equal(3);
  });

  it('fails clearly when attempts are exhausted', async function () {
    let error: unknown;
    try {
      await waitForResult(
        async () => {
          throw new Error('still missing');
        },
        { attempts: 2, intervalMs: 0 }
      );
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).to.contain(
      'did not become available after 2 attempts'
    );
  });

  it('observes an immediately available result', async function () {
    const observation = await observeForWindow(
      async () => 'ready',
      {
        attempts: 1,
        intervalMs: 0,
        isNotFound: isConfirmedReadNotFound
      }
    );

    expect(observation).to.deep.equal({
      state: 'found',
      value: 'ready'
    });
  });

  it('observes a result after transient confirmed 404 responses', async function () {
    let attempts = 0;
    const observation = await observeForWindow(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw readError(404, 'not found');
        }
        return 3;
      },
      {
        attempts: 3,
        intervalMs: 0,
        isNotFound: isConfirmedReadNotFound
      }
    );

    expect(observation).to.deep.equal({
      state: 'found',
      value: 3
    });
    expect(attempts).to.equal(3);
  });

  it('returns not_found only after all 30 confirmed 404 responses', async function () {
    const finalError = readError(
      404,
      'still missing'
    );
    let attempts = 0;
    const observation = await observeForWindow(
      async () => {
        attempts += 1;
        throw finalError;
      },
      {
        attempts: 30,
        intervalMs: 0,
        isNotFound: isConfirmedReadNotFound
      }
    );

    expect(observation.state).to.equal('not_found');
    if (observation.state === 'not_found') {
      expect(observation.error).to.equal(finalError);
    }
    expect(attempts).to.equal(30);
  });

  it('rethrows unhealthy and unexpected read failures immediately', async function () {
    const failures: unknown[] = [
      readError(500, 'internal server error'),
      readError(500, 'timeout', 'timeout'),
      readError(500, 'Network Error'),
      new Error('programming error')
    ];

    for (const failure of failures) {
      let attempts = 0;
      let caught: unknown;
      try {
        await observeForWindow(
          async () => {
            attempts += 1;
            throw failure;
          },
          {
            attempts: 30,
            intervalMs: 0,
            isNotFound: isConfirmedReadNotFound
          }
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).to.equal(failure);
      expect(attempts).to.equal(1);
    }
  });

  it('classifies only explicit refused and unknown submission outcomes', function () {
    expect(
      classifyBatchFailureSubmission(
        new TransactionSubmissionError(
          422,
          { message: 'rejected' },
          'rejected'
        ),
        '0xlocal'
      )
    ).to.deep.equal({
      submission: 'refused',
      raw: {
        status: 422,
        body: { message: 'rejected' },
        local_hash: '0xlocal',
        message:
          '[1Money SDK]: Transaction submission refused (HTTP 422): rejected. The transaction was NOT submitted -- it is safe to retry once the cause is addressed.'
      }
    });

    expect(
      classifyBatchFailureSubmission(
        new TransactionOutcomeUnknownError(
          '0xlocal',
          {
            status: 502,
            data: { message: 'downstream failure' }
          }
        ),
        '0xlocal'
      )
    ).to.deep.equal({
      submission: 'outcome_unknown',
      raw: {
        status: 502,
        body: { message: 'downstream failure' },
        hash: '0xlocal',
        local_hash: '0xlocal',
        message:
          '[1Money SDK]: Transaction outcome unknown -- the request completed but the response carried no transaction hash, so the SDK cannot confirm whether the node admitted transaction 0xlocal. This is neither a confirmed submission nor a confirmed non-submission. Do NOT blindly retry: query this hash against the node first -- retrying risks double-submitting on the same nonce.'
      }
    });
  });

  it('rethrows a submitted hash mismatch instead of normalizing it', function () {
    const mismatch = new TransactionHashMismatchError(
      '0xlocal',
      '0xserver'
    );

    expect(() =>
      classifyBatchFailureSubmission(
        mismatch,
        '0xlocal'
      )
    ).to.throw(TransactionHashMismatchError);
  });
});
