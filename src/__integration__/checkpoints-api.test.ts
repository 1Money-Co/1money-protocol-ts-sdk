import 'mocha';
import { expect } from 'chai';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { checkpointsApi } from '@/api/checkpoints';
import { api } from '@/api';
import { CHAIN_IDS } from '@/api/constants';
import { getConfig } from './config';

import type { Transaction } from '@/api/checkpoints/types';

const RUN_ENV = process.env.RUN_ENV || 'local';

declare global {
  interface Window {
    getByHash: typeof checkpointsApi.getByHash;
    getByNumber: typeof checkpointsApi.getByNumber;
    getNumber: typeof checkpointsApi.getNumber;
  }
}

describe('checkpoint API test', function () {
  // Set a longer timeout for all tests in this suite
  this.timeout(10000);

  const config = getConfig();

  const apiClient = api({
    timeout: 3000,
    network: 'testnet',
  });

  let browser: Browser;
  let pageOne: Page;

  before(function () {
    if (!config.enabled) {
      this.skip();
    }
  });

  if (RUN_ENV === 'local') {
    before(async () => {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.CHROME_PATH || undefined
      });
      await browser.newPage().then(page => {
        pageOne = page;
        return Promise.all([
          pageOne.exposeFunction('getByHash', apiClient.checkpoints.getByHash),
          pageOne.exposeFunction('getByNumber', apiClient.checkpoints.getByNumber),
          pageOne.exposeFunction('getNumber', apiClient.checkpoints.getNumber)
        ])
      });
    });

    after(async () => {
      if (browser) await browser.close();
    });
  }

  const number = 100;
  const hash = '0xb2fa4f7beb1bb3b867481392c13330159d944a26bcc9208c30744b0b45997809';
  const p_hash = '0x1087ec76ee7ddd3a134d31380d685443a2cad33b59b4de0578b36b3d1625bd58';

  it('should have methods', function () {
    expect(apiClient.checkpoints).to.be.an('object');
    expect(apiClient.checkpoints.getNumber).to.be.a('function');
    expect(apiClient.checkpoints.getByHash).to.be.a('function');
    expect(apiClient.checkpoints.getByNumber).to.be.a('function');
  });

  it.skip('should fetch checkpoint number from the API', function (done) {
    Promise.all([
      RUN_ENV === 'local' ? pageOne.evaluate(async () => {
        const response = await window.getNumber();
        return response;
      }).then(response => {
        expect(response).to.be.an('object');
        expect(response).to.have.property('number');
        expect(response.number).to.be.a('number');
      }) : Promise.resolve(),
      apiClient.checkpoints.getNumber()
        .success(response => {
          expect(response).to.be.an('object');
          expect(response).to.have.property('number');
          expect(response.number).to.be.a('number');
        })
        .rest(err => {
          throw (err?.data ?? err.message ?? err);
        }, ['error', 'timeout']),
    ]).then(() => done()).catch(done);
  });

  it.skip('should fetch checkpoint by hash from the API', function (done) {
    Promise.all([
      RUN_ENV === 'local' ? pageOne.evaluate(async (_hash) => {
        const response = await window.getByHash(_hash, true);
        return response;
      }, hash).then(response => {
        expect(response).to.be.an('object');

        expect(response).to.have.property('hash');
        expect(response.hash).to.be.a('string');
        expect(response.hash).to.be.equal(hash);

        expect(response).to.have.property('number');
        expect(response.number).to.be.a('number');
        expect(response.number).to.be.equal(number);

        expect(response).to.have.property('parent_hash');
        expect(response.parent_hash).to.be.a('string');
        expect(response.parent_hash).to.be.equal(p_hash);

        expect(response).to.have.property('state_root');
        expect(response.state_root).to.be.a('string');

        expect(response).to.have.property('transactions_root');
        expect(response.transactions_root).to.be.a('string');

        expect(response).to.have.property('receipts_root');
        expect(response.receipts_root).to.be.a('string');

        expect(response).to.have.property('timestamp');
        expect(response.timestamp).to.be.a('number');

        expect(response).to.have.property('transactions');
        expect(response.transactions).to.be.an('array');
        (response.transactions as Transaction[]).forEach(transaction => {
          expect(transaction).to.have.property('hash');
          expect(transaction.hash).to.be.a('string');

          expect(transaction).to.have.property('checkpoint_hash');
          expect(transaction.checkpoint_hash).to.be.a('string');
          expect(transaction.checkpoint_hash).to.be.equal(hash);

          expect(transaction).to.have.property('checkpoint_number');
          expect(transaction.checkpoint_number).to.be.a('number');
          expect(transaction.checkpoint_number).to.be.equal(number);

          expect(transaction).to.have.property('transaction_index');
          expect(transaction.transaction_index).to.be.a('number');

          expect(transaction).to.have.property('chain_id');
          expect(transaction.chain_id).to.be.a('number');
          expect(transaction.chain_id).to.be.equal(CHAIN_IDS.TESTNET);

          expect(transaction).to.have.property('nonce');
          expect(transaction.nonce).to.be.a('number');

          expect(transaction).to.have.property('fee');
          expect((transaction as any).fee).to.be.a('number');

          expect(transaction).to.have.property('from');
          expect(transaction.from).to.be.a('string');

          expect(transaction).to.have.property('data');
          expect(transaction.data).to.be.an('object');
          expect((transaction.data as any).value).to.be.a('string');
          expect((transaction.data as any).to).to.be.a('string');
          expect((transaction.data as any).token).to.be.a('string');

          expect(transaction).to.have.property('signature');
          expect(transaction.signature).to.be.an('object');
          expect(transaction.signature.r).to.be.a('string');
          expect(transaction.signature.s).to.be.a('string');
          expect(transaction.signature.v).to.be.a('number');
        });

        expect(response).to.have.property('size');
        expect(response.size).to.be.an('number');
      }) : Promise.resolve(),
      apiClient.checkpoints.getByHash(hash, true)
        .success(response => {
          expect(response).to.be.an('object');

          expect(response).to.have.property('hash');
          expect(response.hash).to.be.a('string');
          expect(response.hash).to.be.equal(hash);

          expect(response).to.have.property('number');
          expect(response.number).to.be.a('number');
          expect(response.number).to.be.equal(number);

          expect(response).to.have.property('parent_hash');
          expect(response.parent_hash).to.be.a('string');
          expect(response.parent_hash).to.be.equal(p_hash);

          expect(response).to.have.property('state_root');
          expect(response.state_root).to.be.a('string');

          expect(response).to.have.property('transactions_root');
          expect(response.transactions_root).to.be.a('string');

          expect(response).to.have.property('receipts_root');
          expect(response.receipts_root).to.be.a('string');

          expect(response).to.have.property('timestamp');
          expect(response.timestamp).to.be.a('number');

          expect(response).to.have.property('transactions');
          expect(response.transactions).to.be.an('array');
          (response.transactions as Transaction[]).forEach(transaction => {
            expect(transaction).to.have.property('hash');
            expect(transaction.hash).to.be.a('string');

            expect(transaction).to.have.property('checkpoint_hash');
            expect(transaction.checkpoint_hash).to.be.a('string');
            expect(transaction.checkpoint_hash).to.be.equal(hash);

            expect(transaction).to.have.property('checkpoint_number');
            expect(transaction.checkpoint_number).to.be.a('number');
            expect(transaction.checkpoint_number).to.be.equal(number);

            expect(transaction).to.have.property('transaction_index');
            expect(transaction.transaction_index).to.be.a('number');

            expect(transaction).to.have.property('chain_id');
            expect(transaction.chain_id).to.be.a('number');
            expect(transaction.chain_id).to.be.equal(CHAIN_IDS.TESTNET);

            expect(transaction).to.have.property('nonce');
            expect(transaction.nonce).to.be.a('number');

            expect(transaction).to.have.property('fee');
            expect((transaction as any).fee).to.be.a('number');

            expect(transaction).to.have.property('from');
            expect(transaction.from).to.be.a('string');

            expect(transaction).to.have.property('data');
            expect(transaction.data).to.be.an('object');
            expect((transaction.data as any).value).to.be.a('string');
            expect((transaction.data as any).to).to.be.a('string');
            expect((transaction.data as any).token).to.be.a('string');

            expect(transaction).to.have.property('signature');
            expect(transaction.signature).to.be.an('object');
            expect(transaction.signature.r).to.be.a('string');
            expect(transaction.signature.s).to.be.a('string');
            expect(transaction.signature.v).to.be.a('number');
          });

          expect(response).to.have.property('size');
          expect(response.size).to.be.an('number');
        })
        .rest(err => {
          throw (err?.data ?? err.message ?? err);
        }, ['error', 'timeout']),
    ]).then(() => done()).catch(done);
  });

  it.skip('should fetch checkpoint by number from the API', function (done) {
    Promise.all([
      RUN_ENV === 'local' ? pageOne.evaluate(async (_number) => {
        const response = await window.getByNumber(_number, true);
        return response;
      }, number).then(response => {
        expect(response).to.be.an('object');

        expect(response).to.have.property('hash');
        expect(response.hash).to.be.a('string');
        expect(response.hash).to.be.equal(hash);

        expect(response).to.have.property('number');
        expect(response.number).to.be.a('number');
        expect(response.number).to.be.equal(number);

        expect(response).to.have.property('parent_hash');
        expect(response.parent_hash).to.be.a('string');
        expect(response.parent_hash).to.be.equal(p_hash);

        expect(response).to.have.property('state_root');
        expect(response.state_root).to.be.a('string');

        expect(response).to.have.property('transactions_root');
        expect(response.transactions_root).to.be.a('string');

        expect(response).to.have.property('receipts_root');
        expect(response.receipts_root).to.be.a('string');

        expect(response).to.have.property('timestamp');
        expect(response.timestamp).to.be.a('number');

        expect(response).to.have.property('transactions');
        expect(response.transactions).to.be.an('array');
        (response.transactions as Transaction[]).forEach(transaction => {
          expect(transaction).to.have.property('hash');
          expect(transaction.hash).to.be.a('string');

          expect(transaction).to.have.property('checkpoint_hash');
          expect(transaction.checkpoint_hash).to.be.a('string');
          expect(transaction.checkpoint_hash).to.be.equal(hash);

          expect(transaction).to.have.property('checkpoint_number');
          expect(transaction.checkpoint_number).to.be.a('number');
          expect(transaction.checkpoint_number).to.be.equal(number);

          expect(transaction).to.have.property('transaction_index');
          expect(transaction.transaction_index).to.be.a('number');

          expect(transaction).to.have.property('chain_id');
          expect(transaction.chain_id).to.be.a('number');
          expect(transaction.chain_id).to.be.equal(CHAIN_IDS.TESTNET);

          expect(transaction).to.have.property('nonce');
          expect(transaction.nonce).to.be.a('number');

          expect(transaction).to.have.property('fee');
          expect((transaction as any).fee).to.be.a('number');

          expect(transaction).to.have.property('from');
          expect(transaction.from).to.be.a('string');

          expect(transaction).to.have.property('data');
          expect(transaction.data).to.be.an('object');
          expect((transaction.data as any).value).to.be.a('string');
          expect((transaction.data as any).to).to.be.a('string');
          expect((transaction.data as any).token).to.be.a('string');

          expect(transaction).to.have.property('signature');
          expect(transaction.signature).to.be.an('object');
          expect(transaction.signature.r).to.be.a('string');
          expect(transaction.signature.s).to.be.a('string');
          expect(transaction.signature.v).to.be.a('number');
        });

        expect(response).to.have.property('size');
        expect(response.size).to.be.an('number');
      }) : Promise.resolve(),
      apiClient.checkpoints.getByNumber(number, true)
        .success(response => {
          expect(response).to.be.an('object');

          expect(response).to.have.property('hash');
          expect(response.hash).to.be.a('string');
          expect(response.hash).to.be.equal(hash);

          expect(response).to.have.property('number');
          expect(response.number).to.be.a('number');
          expect(response.number).to.be.equal(number);

          expect(response).to.have.property('parent_hash');
          expect(response.parent_hash).to.be.a('string');
          expect(response.parent_hash).to.be.equal(p_hash);

          expect(response).to.have.property('state_root');
          expect(response.state_root).to.be.a('string');

          expect(response).to.have.property('transactions_root');
          expect(response.transactions_root).to.be.a('string');

          expect(response).to.have.property('receipts_root');
          expect(response.receipts_root).to.be.a('string');

          expect(response).to.have.property('timestamp');
          expect(response.timestamp).to.be.a('number');

          expect(response).to.have.property('transactions');
          expect(response.transactions).to.be.an('array');
          (response.transactions as Transaction[]).forEach(transaction => {
            expect(transaction).to.have.property('hash');
            expect(transaction.hash).to.be.a('string');

            expect(transaction).to.have.property('checkpoint_hash');
            expect(transaction.checkpoint_hash).to.be.a('string');
            expect(transaction.checkpoint_hash).to.be.equal(hash);

            expect(transaction).to.have.property('checkpoint_number');
            expect(transaction.checkpoint_number).to.be.a('number');
            expect(transaction.checkpoint_number).to.be.equal(number);

            expect(transaction).to.have.property('transaction_index');
            expect(transaction.transaction_index).to.be.a('number');

            expect(transaction).to.have.property('chain_id');
            expect(transaction.chain_id).to.be.a('number');
            expect(transaction.chain_id).to.be.equal(CHAIN_IDS.TESTNET);

            expect(transaction).to.have.property('nonce');
            expect(transaction.nonce).to.be.a('number');

            expect(transaction).to.have.property('fee');
            expect((transaction as any).fee).to.be.a('number');

            expect(transaction).to.have.property('from');
            expect(transaction.from).to.be.a('string');

            expect(transaction).to.have.property('data');
            expect(transaction.data).to.be.an('object');
            expect((transaction.data as any).value).to.be.a('string');
            expect((transaction.data as any).to).to.be.a('string');
            expect((transaction.data as any).token).to.be.a('string');

            expect(transaction).to.have.property('signature');
            expect(transaction.signature).to.be.an('object');
            expect(transaction.signature.r).to.be.a('string');
            expect(transaction.signature.s).to.be.a('string');
            expect(transaction.signature.v).to.be.a('number');
          });

          expect(response).to.have.property('size');
          expect(response.size).to.be.an('number');
        })
        .rest(err => {
          throw (err?.data ?? err.message ?? err);
        }, ['error', 'timeout']),
    ]).then(() => done()).catch(done);
  });
});
