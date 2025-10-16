import 'mocha';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { expect } from 'chai';
import { api } from '../../';
import { CHAIN_IDS } from '../../constants';
import { signMessage, safePromiseAll, safePromiseLine } from '../../../utils';
import { transactionsApi } from '../';
import { accountsApi } from '../../accounts';
import { checkpointsApi } from '../../checkpoints';
import 'dotenv/config';

import type { ZeroXString } from '../../../utils';

declare global {
  interface Window {
    signMessage: typeof signMessage;
    getNonce: typeof accountsApi.getNonce;
    _getByHash: typeof transactionsApi.getByHash;
    getReceiptByHash: typeof transactionsApi.getReceiptByHash;
    estimateFee: typeof transactionsApi.estimateFee;
    payment: typeof transactionsApi.payment;
    getNumber: typeof checkpointsApi.getNumber;
  }
}

const RUN_ENV = process.env.RUN_ENV || 'local';

describe('transactions API test', function () {
  // Set a longer timeout for all tests in this suite
  this.timeout(10000);

  const apiClient = api({
    timeout: 3000,
    network: 'testnet',
  });

  let browser: Browser;
  let pageOne: Page;

  if (RUN_ENV === 'local') {
    before(async () => {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.CHROME_PATH || undefined
      });
      await browser.newPage().then(page => {
        pageOne = page;
        return Promise.all([
          pageOne.exposeFunction('signMessage', signMessage),
          pageOne.exposeFunction('getNonce', apiClient.accounts.getNonce),
          pageOne.exposeFunction('_getByHash', apiClient.transactions.getByHash),
          pageOne.exposeFunction('getReceiptByHash', apiClient.transactions.getReceiptByHash),
          pageOne.exposeFunction('estimateFee', apiClient.transactions.estimateFee),
          pageOne.exposeFunction('payment', apiClient.transactions.payment),
          pageOne.exposeFunction('getNumber', apiClient.checkpoints.getNumber),
        ])
      });
    });

    after(async () => {
      await browser.close();
    });
  }

  it('should have transactions API object', function () {
    expect(apiClient.transactions).to.be.an('object');
  });

  it('should have getByHash method', function () {
    expect(apiClient.transactions.getByHash).to.be.a('function');
  });

  it('should have getReceiptByHash method', function () {
    expect(apiClient.transactions.getReceiptByHash).to.be.a('function');
  });

  it('should have estimateFee method', function () {
    expect(apiClient.transactions.estimateFee).to.be.a('function');
  });

  it('should have payment method', function () {
    expect(apiClient.transactions.payment).to.be.a('function');
  });

  const issuedToken = '0x555Da6a773419c98F3c0fFac5eA1d05F3E635946';
  const tokenValue = '100';
  const operatorAddress = process.env.OPERATOR_ADDRESS;
  const operatorPK = process.env.OPERATOR_PRIVATE_KEY as ZeroXString;
  const testAddress = '0x6324dAc598f9B637824978eD6b268C896E0c40E0';
  const testPK = '0x1aeee88b6620cd0d24f0ee3128f3baa34241bcb0e8f6c467c20db30720555254' as const;
  const testHash = '0x43e64ff66da8ef0fe5d2d09b69b19a4163c4ce9c25379c287d5409ac1d9b49bd' as const;
  const chainId = CHAIN_IDS.TESTNET;

  // Make real API calls to test the transactions API
  it.skip('should fetch transaction by hash', function (done) {
    safePromiseAll([
      RUN_ENV === 'local' ? pageOne.evaluate(async (params) => {
        const { testHash } = params;
        const response = await window._getByHash(testHash);
        return response;
      }, {
        testHash,
      }).then(response => {
        expect(response).to.be.an('object');
        expect(response).to.have.property('hash');
        expect(response).to.have.property('from');
      }) : Promise.resolve(),
      apiClient.transactions.getByHash(testHash)
        .success(response => {
          expect(response).to.be.an('object');
          expect(response).to.have.property('hash');
          expect(response).to.have.property('from');
        })
        .rest(err => {
          // If the transaction doesn't exist, we'll consider the test passed
          expect(err).to.be.an('object');
          expect(err).to.have.property('message');
          expect(err.message).to.include('not found');
          throw (err?.data ?? err.message ?? err);
        })
    ]).then(() => done()).catch(done);
  });

  it.skip('should fetch transaction receipt by hash', function (done) {
    safePromiseAll([
      RUN_ENV === 'local' ? pageOne.evaluate(async (params) => {
        const { testHash } = params;
        const response = await window.getReceiptByHash(testHash);
        return response;
      }, {
        testHash,
      }).then(response => {
        expect(response).to.be.an('object');
        expect(response).to.have.property('transaction_hash');
        expect(response).to.have.property('success');
      }) : Promise.resolve(),
      apiClient.transactions.getReceiptByHash(testHash)
        .success(response => {
          expect(response).to.be.an('object');
          expect(response).to.have.property('transaction_hash');
          expect(response).to.have.property('success');
        })
        .rest(err => {
          expect(err).to.be.an('object');
          expect(err).to.have.property('message');
          expect(err.message).to.include('not found');
          throw (err?.data ?? err.message ?? err);
        })
    ]).then(() => done()).catch(done);
  });

  it('should estimate transaction fee', function (done) {
    safePromiseAll([
      RUN_ENV === 'local' ? pageOne.evaluate(async (params) => {
        const { testAddress, tokenValue, issuedToken } = params;
        const response = await window.estimateFee(testAddress, tokenValue, issuedToken);
        return response;
      }, {
        testAddress,
        tokenValue,
        issuedToken,
      }).then(response => {
        expect(response).to.be.an('object');
        expect(response).to.have.property('fee');
        expect(response.fee).to.be.a('string');
      }) : Promise.resolve(),
      apiClient.transactions.estimateFee(testAddress, tokenValue, issuedToken)
        .success(response => {
          expect(response).to.be.an('object');
          expect(response).to.have.property('fee');
          expect(response.fee).to.be.a('string');
        })
        .rest(err => {
          throw (err?.data ?? err.message ?? err);
        })
    ]).then(() => done()).catch(done);
  });

  if (!(RUN_ENV === 'remote' || !operatorAddress || !operatorPK || !testPK || !testAddress)) {
    // passed
    it.skip('should submit payment transaction', function (done) {
      safePromiseLine([
        () => RUN_ENV === 'local' ? pageOne.evaluate(async (params) => {
          const { operatorAddress, testPK, chainId, testAddress, tokenValue, issuedToken } = params;
          const [{ number: recentCheckpoint }, { nonce }] = await safePromiseAll([
            window.getNumber(),
            window.getNonce(testAddress)
          ])
          const payload = [
            recentCheckpoint,
            chainId,
            nonce,
            operatorAddress,
            tokenValue,
            issuedToken
          ];
          const signature = await window.signMessage(payload, testPK)
          if (!signature) return done(new Error('Failed to sign message'));
          const response = await window.payment({
            recent_checkpoint: recentCheckpoint,
            chain_id: chainId,
            nonce,
            recipient: operatorAddress,
            value: tokenValue,
            token: issuedToken,
            signature
          })
          return response;
        }, {
          operatorAddress,
          testPK,
          chainId,
          testAddress,
          tokenValue,
          issuedToken
        }).then(response => {
          expect(response).to.be.an('object');
          expect(response.token).to.be.a('string');
        }) : Promise.resolve(),
        () => safePromiseAll([
          apiClient.checkpoints.getNumber()
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
          apiClient.accounts.getNonce(testAddress)
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) })
        ]).then(async ([checkpointResponse, { nonce }]) => {
          const recentCheckpoint = checkpointResponse.number;
          const payload = [
            recentCheckpoint,
            chainId,
            nonce,
            operatorAddress,
            tokenValue,
            issuedToken
          ];
          const signature = await signMessage(payload, testPK)
          if (!signature) return done(new Error('Failed to sign message'));
          apiClient.transactions.payment({
            recent_checkpoint: recentCheckpoint,
            chain_id: chainId,
            nonce,
            recipient: operatorAddress,
            value: tokenValue,
            token: issuedToken,
            signature
          })
            .success(response => {
              expect(response).to.be.an('object');
              expect(response).to.have.property('hash');
            })
            .rest(err => {
              expect(err).to.be.an('object');
              expect(err).to.have.property('message');
              expect(err?.data?.message).to.include('insufficient funds');
              throw (err?.data ?? err.message ?? err);
            });
        }).then(() => done()).catch(done)
      ]);
    });
  }
});

