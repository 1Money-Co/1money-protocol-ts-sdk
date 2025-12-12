import 'mocha';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { expect } from 'chai';
import { api } from '../../';
import { CHAIN_IDS } from '../../constants';
import { signMessage, toHex, safePromiseLine, safePromiseAll } from '../../../utils';
import { AuthorityAction, AuthorityType, PauseAction, ManageListAction } from '../types';
import { tokensApi } from '../';
import { accountsApi } from '../../accounts';
import { checkpointsApi } from '../../checkpoints';
import 'dotenv/config';

import type { ZeroXString } from '../../../utils';

declare global {
  interface Window {
    signMessage: typeof signMessage;
    getNonce: typeof accountsApi.getNonce;
    burnToken: typeof tokensApi.burnToken;
    grantAuthority: typeof tokensApi.grantAuthority;
    issueToken: typeof tokensApi.issueToken;
    mintToken: typeof tokensApi.mintToken;
    pauseToken: typeof tokensApi.pauseToken;
    updateMetadata: typeof tokensApi.updateMetadata;
    manageBlacklist: typeof tokensApi.manageBlacklist;
    manageWhitelist: typeof tokensApi.manageWhitelist;
    getTokenMetadata: typeof tokensApi.getTokenMetadata;
    getNumber: typeof checkpointsApi.getNumber;
  }
}

const RUN_ENV = process.env.RUN_ENV || 'local';

describe('tokens API test', function () {
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
          pageOne.exposeFunction('burnToken', apiClient.tokens.burnToken),
          pageOne.exposeFunction('grantAuthority', apiClient.tokens.grantAuthority),
          pageOne.exposeFunction('issueToken', apiClient.tokens.issueToken),
          pageOne.exposeFunction('mintToken', apiClient.tokens.mintToken),
          pageOne.exposeFunction('pauseToken', apiClient.tokens.pauseToken),
          pageOne.exposeFunction('updateMetadata', apiClient.tokens.updateMetadata),
          pageOne.exposeFunction('manageBlacklist', apiClient.tokens.manageBlacklist),
          pageOne.exposeFunction('manageWhitelist', apiClient.tokens.manageWhitelist),
          pageOne.exposeFunction('getTokenMetadata', apiClient.tokens.getTokenMetadata),
          pageOne.exposeFunction('getNumber', apiClient.checkpoints.getNumber),
        ])
      });
    });

    after(async () => {
      await browser.close();
    });
  }

  it('should have tokens API object', function () {
    expect(apiClient.tokens).to.be.an('object');
  });

  it('should have getTokenMetadata method', function () {
    expect(apiClient.tokens.getTokenMetadata).to.be.a('function');
  });

  it('should have manageBlacklist method', function () {
    expect(apiClient.tokens.manageBlacklist).to.be.a('function');
  });

  it('should have manageWhitelist method', function () {
    expect(apiClient.tokens.manageWhitelist).to.be.a('function');
  });

  it('should have burnToken method', function () {
    expect(apiClient.tokens.burnToken).to.be.a('function');
  });

  it('should have grantAuthority method', function () {
    expect(apiClient.tokens.grantAuthority).to.be.a('function');
  });

  it('should have issueToken method', function () {
    expect(apiClient.tokens.issueToken).to.be.a('function');
  });

  it('should have mintToken method', function () {
    expect(apiClient.tokens.mintToken).to.be.a('function');
  });

  it('should have pauseToken method', function () {
    expect(apiClient.tokens.pauseToken).to.be.a('function');
  });

  it('should have updateMetadata method', function () {
    expect(apiClient.tokens.updateMetadata).to.be.a('function');
  });

  // Example token for testing - replace with a valid token if needed
  const chainId = CHAIN_IDS.TESTNET;
  const issuedToken = '0x555Da6a773419c98F3c0fFac5eA1d05F3E635946';
  const operatorAddress = process.env.OPERATOR_ADDRESS;
  const operatorPK = process.env.OPERATOR_PRIVATE_KEY as ZeroXString;
  const testAddress = '0x6324dAc598f9B637824978eD6b268C896E0c40E0';

  // Skip actual API calls in regular tests
  it('should fetch token metadata', function (done) {
    apiClient.tokens.getTokenMetadata(issuedToken)
      .success(response => {
        expect(response).to.be.an('object');
        expect(response.symbol).to.be.a('string');
        expect(response.decimals).to.be.a('number');
        expect(response.supply).to.be.a('string');
        expect(response.is_paused).to.be.a('boolean');
        expect(response.is_private).to.be.a('boolean');
        expect(response.master_authority).to.be.a('string');
        expect(response.master_mint_burn_authority).to.be.a('string');
        expect(response.mint_burn_authorities).to.be.an('array');
        expect(response.pause_authorities).to.be.an('array');
        expect(response.list_authorities).to.be.an('array');
        expect(response.black_list).to.be.an('array');
        expect(response.white_list).to.be.an('array');
        expect(response.metadata_update_authorities).to.be.an('array');
        expect(response.meta).to.be.an('object');
        done();
      })
      .rest(err => {
        done(err?.data ?? err.message ?? err);
      });
  });

  if (!(RUN_ENV === 'remote' || !operatorAddress || !operatorPK || !testAddress)) {
    // passed
    it.skip('should manage blacklist', function (done) {
      safePromiseLine([
        () => pageOne.evaluate(async (params) => {
          const { operatorAddress, operatorPK, action, chainId, testAddress, issuedToken } = params;
          const [{ number: checkpointNumber }, { nonce }] = await safePromiseAll([
            window.getNumber(),
            window.getNonce(operatorAddress)
          ]);
          const payload = [
            chainId,
            nonce,
            action,
            testAddress,
            issuedToken,
          ]
          const signature = await window.signMessage(payload, operatorPK)
          if (!signature) return done(new Error('Failed to sign message'));
          const response = await window.manageWhitelist({
            chain_id: chainId,
            nonce,
            action,
            address: testAddress,
            token: issuedToken,
            signature
          });
          return response;
        }, {
          operatorAddress,
          operatorPK,
          action: ManageListAction.Add,
          chainId,
          testAddress,
          issuedToken,
        }).then(response => {
          expect(response).to.be.an('object');
        }),
        () => safePromiseAll([
          apiClient.checkpoints.getNumber()
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
          apiClient.accounts.getNonce(operatorAddress)
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
        ]).then(async ([checkpointResponse, nonceResponse]) => {
          const nonce = nonceResponse.nonce;
          const action = ManageListAction.Add;
          const payload = [
            chainId,
            nonce,
            action,
            testAddress,
            issuedToken,
          ]
          const signature = await signMessage(payload, operatorPK)
          if (!signature) return done(new Error('Failed to sign message'));
          apiClient.tokens.manageBlacklist({
            chain_id: chainId,
            nonce,
            action,
            address: testAddress,
            token: issuedToken,
            signature
          })
            .success(response => {
              expect(response).to.be.an('object');
            })
            .rest(err => { throw (err?.data ?? err.message ?? err) });
        }).catch(err => { throw (err?.data ?? err.message ?? err) }),
      ]).then(() => done()).catch(done);
    });

    // passed
    it.skip('should burn token', function (done) {
      safePromiseLine([
        () => RUN_ENV === 'local' ? pageOne.evaluate(async (params) => {
          const { operatorAddress, operatorPK, chainId, testAddress, issuedToken } = params;
          const [{ number: checkpointNumber }, { nonce }] = await safePromiseAll([
            window.getNumber(),
            window.getNonce(operatorAddress)
          ]);

          const burnValue = '10';
          const payload = [
            chainId,
            nonce,
            testAddress,
            burnValue,
            issuedToken,
          ];
          const signature = await window.signMessage(payload, operatorPK)
          if (!signature) return done(new Error('Failed to sign message'));
          const response = await window.burnToken({
            chain_id: chainId,
            nonce,
            recipient: testAddress,
            value: burnValue,
            token: issuedToken,
            signature
          });
          return response;
        }, {
          operatorAddress,
          operatorPK,
          chainId,
          testAddress,
          issuedToken,
        }).then(response => {
          expect(response).to.be.an('object');
          expect(response.hash).to.be.a('string');
        }) : Promise.resolve(),
        () => safePromiseAll([
          apiClient.checkpoints.getNumber()
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
          apiClient.accounts.getNonce(operatorAddress)
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
        ]).then(async ([checkpointResponse, nonceResponse]) => {
          const nonce = nonceResponse.nonce;
          const burnValue = '10';
          const payload = [
            chainId,
            nonce,
            operatorAddress,
            burnValue,
            issuedToken,
          ]
          const signature = await signMessage(payload, operatorPK)
          if (!signature) return done(new Error('Failed to sign message'));
          apiClient.tokens.burnToken({
            chain_id: chainId,
            nonce,
            recipient: operatorAddress,
            value: burnValue,
            token: issuedToken,
            signature
          })
            .success(response => {
              expect(response).to.be.an('object');
              expect(response.hash).to.be.a('string');
            })
            .rest(err => {
              console.info(11111, err);
              throw (err?.data ?? err.message ?? err);
            });
        }).catch(err => { throw (err?.data ?? err.message ?? err) })
      ]).then(() => done()).catch(done);
    });

    // passed
    it.skip('should grant authority', function (done) {
      if (RUN_ENV === 'remote' || !operatorAddress || !operatorPK || !testAddress) return done();

      safePromiseLine([
        () => pageOne.evaluate(async (params) => {
          const { action, authorityType, operatorAddress, operatorPK, chainId, testAddress, issuedToken } = params;
          const [{ number: checkpointNumber }, { nonce }] = await safePromiseAll([
            window.getNumber(),
            window.getNonce(operatorAddress)
          ]);
          const tokenValue = '15000';
          const payload = [
            chainId,
            nonce,
            action,
            authorityType,
            testAddress,
            issuedToken,
            tokenValue,
          ]
          const signature = await window.signMessage(payload, operatorPK)
          if (!signature) return done(new Error('Failed to sign message'));
          const response = await window.grantAuthority({
            chain_id: chainId,
            nonce,
            action,
            authority_type: authorityType,
            authority_address: testAddress,
            token: issuedToken,
            value: tokenValue,
            signature
          })
          return response;
        }, {
          operatorAddress,
          operatorPK,
          action: AuthorityAction.Grant,
          authorityType: AuthorityType.MintBurnTokens,
          chainId,
          testAddress,
          issuedToken,
        }).then(response => {
          expect(response).to.be.an('object');
        }),
        () => safePromiseAll([
          apiClient.checkpoints.getNumber()
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
          apiClient.accounts.getNonce(operatorAddress)
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
        ]).then(async ([checkpointResponse, nonceResponse]) => {
          const nonce = nonceResponse.nonce;
          const tokenValue = '15000';
          const payload = [
            chainId,
            nonce,
            AuthorityAction.Grant,
            AuthorityType.MintBurnTokens,
            operatorAddress,
            issuedToken,
            tokenValue,
          ]
          const signature = await signMessage(payload, operatorPK)
          if (!signature) return done(new Error('Failed to sign message'));
          apiClient.tokens.grantAuthority({
            chain_id: chainId,
            nonce,
            action: AuthorityAction.Grant,
            authority_type: AuthorityType.MintBurnTokens,
            authority_address: operatorAddress,
            token: issuedToken,
            value: tokenValue,
            signature
          })
            .success(response => {
              expect(response).to.be.an('object');
            })
            .rest(err => { throw (err?.data ?? err.message ?? err) });
        }).catch(err => { throw (err?.data ?? err.message ?? err) })
      ]).then(() => done()).catch(done);
    });

    // passed
    it.skip('should issue token', function (done) {
      if (RUN_ENV === 'remote' || !operatorAddress || !operatorPK) return done();

      safePromiseLine([
        () => pageOne.evaluate(async (params) => {
          const { operatorAddress, operatorPK, chainId } = params;
          const [{ number: checkpointNumber }, { nonce }] = await safePromiseAll([
            window.getNumber(),
            window.getNonce(operatorAddress)
          ]);
          const name = 'USDT 1Money';
          const symbol = 'USDT';
          const decimals = 6;
          const isPrivate = false;
          const payload = [
            chainId,
            nonce,
            symbol,
            name,
            decimals,
            operatorAddress,
            isPrivate,
          ];
          const signature = await window.signMessage(payload, operatorPK)
          if (!signature) return done(new Error('Failed to sign message'));
          const response = await window.issueToken({
            chain_id: chainId,
            nonce,
            symbol,
            name,
            decimals,
            master_authority: operatorAddress,
            is_private: isPrivate,
            signature,
          })
          return response;
        }, {
          operatorAddress,
          operatorPK,
          chainId,
        }).then(response => {
          expect(response).to.be.an('object');
          expect(response.token).to.be.a('string');
        }),
        // {
        //   hash: '0x43e64ff66da8ef0fe5d2d09b69b19a4163c4ce9c25379c287d5409ac1d9b49bd',
        //   token: '0x5458747a0efb9ebeb8696fcac1479278c0872fbe'
        // }
        () => safePromiseAll([
          apiClient.checkpoints.getNumber()
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
          apiClient.accounts.getNonce(operatorAddress)
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) })
        ]).then(async ([checkpointResponse, nonceResponse]) => {
          const nonce = nonceResponse.nonce;
          const name = 'USDT 1Money';
          const symbol = 'USDT1';
          const decimals = 6;
          const isPrivate = false;
          const payload = [
            chainId,
            nonce,
            symbol,
            name,
            decimals,
            operatorAddress,
            isPrivate,
          ];
          const signature = await signMessage(payload, operatorPK)
          if (!signature) return done(new Error('Failed to sign message'));
          return apiClient.tokens.issueToken({
            chain_id: chainId,
            nonce,
            symbol,
            name,
            decimals,
            master_authority: operatorAddress,
            is_private: isPrivate,
            signature,
          })
            .success(response => {
              expect(response).to.be.an('object');
              expect(response.token).to.be.a('string');
            })
            .rest(err => { throw (err?.data ?? err.message ?? err) });
        }).catch(err => { throw (err?.data ?? err.message ?? err) })
      ]).then(() => done()).catch(done);

    });

    // passed
    it.skip('should mint token', function (done) {
      if (RUN_ENV === 'remote' || !operatorAddress || !operatorPK || !testAddress) return done();

      safePromiseLine([
        () => pageOne.evaluate(async (params) => {
          const { operatorAddress, operatorPK, chainId, testAddress, issuedToken } = params;
          const [{ number: checkpointNumber }, { nonce }] = await safePromiseAll([
            window.getNumber(),
            window.getNonce(operatorAddress)
          ]);
          const mintValue = '100000';
          const payload = [
            chainId,
            nonce,
            testAddress,
            mintValue,
            issuedToken,
          ];
          const signature = await window.signMessage(payload, operatorPK)
          if (!signature) return done(new Error('Failed to sign message'));
          const response = await window.mintToken({
            chain_id: chainId,
            nonce,
            recipient: testAddress,
            value: mintValue,
            token: issuedToken,
            signature
          })
          return response;
        }, {
          operatorAddress,
          operatorPK,
          chainId,
          testAddress,
          issuedToken,
        }).then(response => {
          expect(response).to.be.an('object');
          expect(response.hash).to.be.a('string');
        }),
        () => safePromiseAll([
          apiClient.checkpoints.getNumber()
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
          apiClient.accounts.getNonce(operatorAddress)
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
        ]).then(async ([checkpointResponse, nonceResponse]) => {
          const nonce = nonceResponse.nonce;
          const mintValue = '100000';
          const payload = [
            chainId,
            nonce,
            testAddress,
            mintValue,
            issuedToken,
          ];
          const signature = await signMessage(payload, operatorPK)
          if (!signature) return done(new Error('Failed to sign message'));
          apiClient.tokens.mintToken({
            chain_id: chainId,
            nonce,
            recipient: testAddress,
            value: mintValue,
            token: issuedToken,
            signature
          })
            .success(response => {
              expect(response).to.be.an('object');
              expect(response.hash).to.be.a('string');
            })
            .rest(err => { throw (err?.data ?? err.message ?? err) });
        }).catch(err => { throw (err?.data ?? err.message ?? err) })
      ]).then(() => done()).catch(done);
    });

    // passed
    it.skip('should pause token', function (done) {
      if (RUN_ENV === 'remote' || !operatorAddress || !operatorPK) return done();

      safePromiseLine([
        () => pageOne.evaluate(async (params) => {
          const { action, operatorAddress, operatorPK, chainId, issuedToken } = params;
          const [{ number: checkpointNumber }, { nonce }] = await safePromiseAll([
            window.getNumber(),
            window.getNonce(operatorAddress)
          ]);
          const payload = [
            chainId,
            nonce,
            action,
            issuedToken,
          ];
          const signature = await window.signMessage(payload, operatorPK);
          if (!signature) return done(new Error('Failed to sign message'));
          const response = await window.pauseToken({
            chain_id: chainId,
            nonce,
            action,
            token: issuedToken,
            signature
          })
          return response;
        }, {
          operatorAddress,
          operatorPK,
          action: PauseAction.Pause,
          chainId,
          issuedToken,
        }).then(response => {
          expect(response).to.be.an('object');
          expect(response.hash).to.be.a('string');
        }),
        () => safePromiseAll([
          apiClient.checkpoints.getNumber()
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
          apiClient.accounts.getNonce(operatorAddress)
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
        ]).then(async ([checkpointResponse, nonceResponse]) => {
          const nonce = nonceResponse.nonce;
          const action = PauseAction.Unpause;
          const payload = [
            chainId,
            nonce,
            action,
            issuedToken,
          ];
          const signature = await signMessage(payload, operatorPK);
          if (!signature) return done(new Error('Failed to sign message'));
          return apiClient.tokens.pauseToken({
            chain_id: chainId,
            nonce,
            action,
            token: issuedToken,
            signature
          })
            .success(response => {
              expect(response).to.be.an('object');
              expect(response.hash).to.be.a('string');
            })
            .rest(err => { throw (err?.data ?? err.message ?? err) });
        }).catch(err => { throw (err?.data ?? err.message ?? err) })
      ]).then(() => done()).catch(done);
    });

    // !todo
    it.skip('should update metadata', function (done) {
      if (RUN_ENV === 'remote' || !operatorAddress || !operatorPK) return done();

      safePromiseLine([
        () => pageOne.evaluate(async (params) => {
          const { operatorAddress, operatorPK, chainId, issuedToken } = params;
          const [{ number: checkpointNumber }, { nonce }] = await safePromiseAll([
            window.getNumber(),
            window.getNonce(operatorAddress)
          ]);
          const name = 'USDC';
          const uri = 'https://usdc.com/metadata';
          const additional_metadata = [
            {
              key: 'test',
              value: 'test'
            }
          ];
          const payload = [
            chainId,
            nonce,
            name,
            uri,
            issuedToken,
            toHex(additional_metadata)
          ];
          const signature = await window.signMessage(payload, operatorPK)
          if (!signature) return done(new Error('Failed to sign message'));
          const response = await window.updateMetadata({
            chain_id: chainId,
            nonce,
            name,
            uri,
            token: issuedToken,
            additional_metadata,
            signature
          })
          return response;
        }, {
          operatorAddress,
          operatorPK,
          chainId,
          issuedToken,
        }).then(response => {
          expect(response).to.be.an('object');
          expect(response.hash).to.be.a('string');
        }),
        () => safePromiseAll([
          apiClient.checkpoints.getNumber()
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
          apiClient.accounts.getNonce(operatorAddress)
            .success(res => res)
            .rest(err => { throw (err?.data ?? err.message ?? err) }),
        ]).then(async ([checkpointResponse, nonceResponse]) => {
          const nonce = nonceResponse.nonce;
          const name = 'USDC';
          const uri = 'https://usdc.com/metadata';
          const additional_metadata = [
            {
              key: 'test',
              value: 'test'
            }
          ];
          const payload = [
            chainId,
            nonce,
            name,
            uri,
            issuedToken,
            toHex(additional_metadata)
          ];
          const signature = await signMessage(payload, operatorPK)
          if (!signature) return done(new Error('Failed to sign message'));
          apiClient.tokens.updateMetadata({
            chain_id: chainId,
            nonce,
            name,
            uri,
            token: issuedToken,
            additional_metadata,
            signature
          })
            .success(response => {
              expect(response).to.be.an('object');
              expect(response.hash).to.be.a('string');
            })
            .rest(err => { throw (err?.data ?? err.message ?? err) });
        }).catch(err => { throw (err?.data ?? err.message ?? err) })
      ]).then(() => done()).catch(done);
    });
  }
});
