import { expect } from 'chai';

import { waitForResult } from '../helpers';

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
});
