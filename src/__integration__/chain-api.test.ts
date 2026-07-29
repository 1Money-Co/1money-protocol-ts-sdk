import 'mocha';
import { expect } from 'chai';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { chainApi } from '@/api/chain';
import { api } from '@/api';
import { getConfig } from './config';

const RUN_ENV = process.env.RUN_ENV || 'local';

declare global {
  interface Window {
    getChainId: typeof chainApi.getChainId;
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
        return pageOne.exposeFunction('getChainId', apiClient.chain.getChainId);
      });
    });

    after(async () => {
      if (browser) await browser.close();
    });
  }

  it('should have methods', function () {
    expect(apiClient.chain).to.be.an('object');
    expect(apiClient.chain.getChainId).to.be.a('function');
  });

  it.skip('should fetch chain id from the API', function (done) {
    Promise.all([
      RUN_ENV === 'local' ? pageOne.evaluate(async () => {
        const response = await window.getChainId();
        return response;
      }).then(response => {
        expect(response).to.be.an('object');
        expect(response).to.have.property('chain_id');
        expect(response.chain_id).to.be.a('number');
      }) : Promise.resolve(),
      apiClient.chain.getChainId()
        .success(response => {
          expect(response).to.be.an('object');
          expect(response).to.have.property('chain_id');
          expect(response.chain_id).to.be.a('number');
        })
        .rest(err => {
          throw(err?.data ?? err.message ?? err);
        }, ['error', 'timeout'])
    ]).then(() => done()).catch(done);
  });
});
