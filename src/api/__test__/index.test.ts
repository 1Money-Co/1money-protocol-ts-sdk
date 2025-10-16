import 'mocha';
import { expect } from 'chai';
import api, { api as apiFunction } from '../';
import { TESTNET_API_URL, MAINNET_API_URL, LOCAL_API_URL } from '../constants';

describe('api test', function () {
  it('api is a function', function () {
    expect(api).to.be.a('function');
    expect(apiFunction).to.be.a('function');
  });

  const apiClient = api({
    timeout: 3000,
    network: 'testnet',
  });

  it('api returns an object with expected structure', function () {
    expect(apiClient).to.be.an('object');
    expect(apiClient.accounts).to.be.an('object');
    expect(apiClient.tokens).to.be.an('object');
    expect(apiClient.transactions).to.be.an('object');
    expect(apiClient.checkpoints).to.be.an('object');
  });

  it('should export API URLs', function () {
    expect(TESTNET_API_URL).to.equal('https://api.testnet.1money.network');
    expect(MAINNET_API_URL).to.equal('https://api.1money.network');
    expect(LOCAL_API_URL).to.equal('http://localhost:18555');
  });

  it('should have all required API methods', function () {
    // Accounts API
    expect(apiClient.accounts.getNonce).to.be.a('function');
    expect(apiClient.accounts.getTokenAccount).to.be.a('function');

    // Tokens API
    expect(apiClient.tokens.getTokenMetadata).to.be.a('function');
    expect(apiClient.tokens.manageBlacklist).to.be.a('function');
    expect(apiClient.tokens.manageWhitelist).to.be.a('function');
    expect(apiClient.tokens.burnToken).to.be.a('function');
    expect(apiClient.tokens.grantAuthority).to.be.a('function');
    expect(apiClient.tokens.issueToken).to.be.a('function');
    expect(apiClient.tokens.mintToken).to.be.a('function');
    expect(apiClient.tokens.pauseToken).to.be.a('function');
    expect(apiClient.tokens.updateMetadata).to.be.a('function');

    // Transactions API
    expect(apiClient.transactions.getByHash).to.be.a('function');
    expect(apiClient.transactions.getReceiptByHash).to.be.a('function');
    expect(apiClient.transactions.estimateFee).to.be.a('function');
    expect(apiClient.transactions.payment).to.be.a('function');

    // Checkpoints API
    expect(apiClient.checkpoints.getNumber).to.be.a('function');
    expect(apiClient.checkpoints.getByHash).to.be.a('function');
    expect(apiClient.checkpoints.getByNumber).to.be.a('function');
  });
});
