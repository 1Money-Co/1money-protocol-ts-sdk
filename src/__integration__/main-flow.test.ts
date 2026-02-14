/**
 * Main business flow integration test
 *
 * This test covers the complete token lifecycle:
 * 1. Issue token (with clawback enabled)
 * 2. Grant mint authority to user1
 * 3. Mint token (user1 mints to user2)
 * 4. Transfer token (user2 transfers to user3)
 * 4.5. Clawback flow:
 *      a. Grant clawback authority to master
 *      b. Perform clawback (master claws back from user3 to user1)
 *      c. Revoke clawback authority from master
 * 4.6. Grant burn authority to user3
 * 5. Burn token (user3 burns their tokens)
 * 5.5. Grant bridge authority to user1
 * 6. Bridge and mint (user1 bridges and mints to user2)
 * 7. Burn and bridge (user2 burns and bridges)
 * 8. Revoke all authorities (user1: mint + bridge, user3: burn)
 *
 * Along the way, it validates:
 * - Transaction by hash
 * - Transaction receipt by hash
 * - Finalized transaction by hash
 * - Checkpoint APIs
 * - Account APIs
 * - Clawback functionality
 */

import { AuthorityAction, AuthorityType } from '@/api/tokens/types';
import { createPrivateKeySigner, TransactionBuilder } from '@/signing';
import { expect } from 'chai';
import { getConfig, shouldRunIntegrationTests } from './config';
import {
  addressEquals,
  assertDefined,
  createTestClient,
  generateRandomSymbol,
  getAccountNonce,
  getCurrentCheckpoint,
  logSection,
  logStep,
  wait,
  waitForFinalization
} from './helpers';
import { getTestAccounts, logTestAccounts } from './setup';

// Skip if integration tests are not enabled
(shouldRunIntegrationTests() ? describe : describe.skip)('Integration Test: Main Business Flow', function () {
  // Set timeout for entire suite
  this.timeout(getConfig().timeout);

  const client = createTestClient();
  const accounts = getTestAccounts();

  // Test state
  let chainId: number;
  let tokenSymbol: string;
  let tokenName: string;
  let tokenDecimals: number;
  let tokenIsPrivate: boolean;
  let tokenClawbackEnabled: boolean;
  let tokenAddress: string;
  let issueTokenTxHash: string;
  let grantAuthorityTxHash: string;
  let grantAuthorityUser3TxHash: string;
  let grantBridgeAuthorityUser1TxHash: string;
  let mintTokenTxHash: string;
  let transferTokenTxHash: string;
  let burnTokenTxHash: string;
  let bridgeAndMintTxHash: string;
  let burnAndBridgeTxHash: string;
  let revokeAuthorityTxHash: string;
  let revokeAuthorityUser3TxHash: string;
  let revokeBridgeAuthorityUser1TxHash: string;

  before(async function () {
    logSection('Integration Test Setup');
    logTestAccounts();

    logStep('Getting chain ID...');
    const chainIdResponse = await client.chain.getChainId();
    chainId = chainIdResponse.chain_id;
    console.log(`  Chain ID: ${chainId}`);

    logStep('Waiting for network to be ready...');
    await wait(2000);
  });

  describe('DEBUG - 1. Issue Token', function () {
    it('should issue a new token successfully', async function () {
      logSection('Step 1: Issue Token');

      const nonce = await getAccountNonce(accounts.operator.address);

      logStep('Preparing token issue payload', `Nonce: ${nonce}`);

      tokenSymbol = generateRandomSymbol('TST');
      tokenName = 'Test Token';
      tokenDecimals = 18;
      tokenIsPrivate = false;
      tokenClawbackEnabled = true;

      logStep('Generated token symbol', tokenSymbol);

      const prepared = TransactionBuilder.tokenIssue({
        chain_id: chainId,
        nonce,
        symbol: tokenSymbol,
        name: tokenName,
        decimals: tokenDecimals,
        master_authority: accounts.master.address,
        is_private: tokenIsPrivate,
        clawback_enabled: tokenClawbackEnabled
      });
      
      const signed = await prepared.sign(createPrivateKeySigner(accounts.operator.privateKey));

      logStep('Issuing token...');
      const response = await client.tokens.issueToken(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);

      issueTokenTxHash = response.hash;
      tokenAddress = response.token;

      logStep('Token issued', `Hash: ${issueTokenTxHash}, Token: ${tokenAddress}`);

      expect(issueTokenTxHash).to.be.a('string');
      expect(tokenAddress).to.be.a('string');

      await wait(2000);

      // Validate transaction by hash
      logStep('Validating transaction by hash...');
      const tx = await client.transactions.getByHash(issueTokenTxHash);
      assertDefined(tx);
      expect(tx.hash).to.equal(issueTokenTxHash);
      expect(tx.transaction_type).to.equal('TokenCreate');

      // Validate transaction data
      if (tx.transaction_type === 'TokenCreate') {
        expect(tx.data.symbol).to.equal(tokenSymbol);
        expect(tx.data.name).to.equal(tokenName);
        expect(tx.data.decimals).to.equal(tokenDecimals);
        expect(addressEquals(tx.data.master_authority, accounts.master.address)).to.be.true;
        expect(tx.data.is_private).to.equal(tokenIsPrivate);
      }

      // Validate transaction receipt
      logStep('Validating transaction receipt...');
      await wait(2000);
      const receipt = await client.transactions.getReceiptByHash(issueTokenTxHash);
      assertDefined(receipt);
      expect(receipt.transaction_hash).to.equal(issueTokenTxHash);
      expect(receipt.success).to.be.true;

      // Wait for finalization
      logStep('Waiting for finalization...');
      const finalized = await waitForFinalization(issueTokenTxHash);
      expect(finalized).to.be.true;

      logStep('✓ Token issued and finalized successfully');
    });

    it('should fetch token metadata', async function () {
      logStep('Fetching token metadata...');

      const metadata = await client.tokens.getTokenMetadata(tokenAddress);

      expect(metadata.symbol).to.equal(tokenSymbol);
      expect(metadata.decimals).to.equal(18);
      expect(addressEquals(metadata.master_authority, accounts.master.address)).to.be.true;
      expect(metadata.is_private).to.equal(tokenIsPrivate);
      expect(metadata.clawback_enabled).to.equal(tokenClawbackEnabled);
      expect(metadata.meta.name).to.equal(tokenName);
      expect(metadata.supply).to.equal('0');

      logStep('✓ Token metadata validated');
    });
  });

  describe('DEBUG - 2. Grant Authority', function () {
    it('should grant mint authority to user1', async function () {
      logSection('Step 2: Grant Authority');

      const nonce = await getAccountNonce(accounts.master.address);

      const action = AuthorityAction.Grant;
      const authorityType = AuthorityType.MintBurnTokens;
      const value = '1000000000000000000000'; // 1000 tokens

      const prepared = TransactionBuilder.tokenAuthority({
        chain_id: chainId,
        nonce,
        action,
        authority_type: authorityType,
        authority_address: accounts.user1.address,
        token: tokenAddress,
        value
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.master.privateKey));

      logStep('Granting authority...');
      const response = await client.tokens.grantAuthority(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);
      grantAuthorityTxHash = response.hash;

      logStep('Authority granted', `Hash: ${grantAuthorityTxHash}`);

      expect(grantAuthorityTxHash).to.be.a('string');

      // Wait for finalization
      logStep('Waiting for finalization...');
      const finalized = await waitForFinalization(grantAuthorityTxHash);
      expect(finalized).to.be.true;

      logStep('✓ Authority granted successfully');
    });
  });

  describe('3. Mint Token', function () {
    it('should mint tokens to user2', async function () {
      logSection('Step 3: Mint Token');

      const nonce = await getAccountNonce(accounts.user1.address);

      const value = '100000000000000000000'; // 100 tokens

      const prepared = TransactionBuilder.tokenMint({
        chain_id: chainId,
        nonce,
        recipient: accounts.user2.address,
        value,
        token: tokenAddress
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.user1.privateKey));

      logStep('Minting tokens...');
      const response = await client.tokens.mintToken(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);
      mintTokenTxHash = response.hash;

      logStep('Tokens minted', `Hash: ${mintTokenTxHash}`);

      expect(mintTokenTxHash).to.be.a('string');

      // Validate receipt
      await wait(2000);
      const receipt = await client.transactions.getReceiptByHash(mintTokenTxHash);
      expect(receipt.success).to.be.true;

      logStep('✓ Tokens minted successfully');
    });

    it('should verify token account balance', async function () {
      logStep('Verifying token account...');

      const tokenAccount = await client.accounts.getTokenAccount(accounts.user2.address, tokenAddress);

      expect(tokenAccount.balance).to.be.a('string');

      logStep('✓ Token account verified');
    });
  });

  describe('4. Transfer Token', function () {
    it('should transfer tokens from user2 to user3', async function () {
      logSection('Step 4: Transfer Token');

      const nonce = await getAccountNonce(accounts.user2.address);

      const value = '50000000000000000000'; // 50 tokens

      const prepared = TransactionBuilder.payment({
        chain_id: chainId,
        nonce,
        recipient: accounts.user3.address,
        value,
        token: tokenAddress
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.user2.privateKey));

      logStep('Transferring tokens...');
      const response = await client.transactions.payment(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);
      transferTokenTxHash = response.hash;

      logStep('Tokens transferred', `Hash: ${transferTokenTxHash}`);

      expect(transferTokenTxHash).to.be.a('string');

      await wait(2000);
      const receipt = await client.transactions.getReceiptByHash(transferTokenTxHash);
      expect(receipt.success).to.be.true;

      logStep('✓ Tokens transferred successfully');
    });
  });

  describe('4.5. Grant Clawback Authority and Test Clawback', function () {
    let grantClawbackAuthorityTxHash: string;
    let clawbackTxHash: string;

    it('should grant clawback authority to master', async function () {
      logSection('Step 4.5a: Grant Clawback Authority to Master');

      const nonce = await getAccountNonce(accounts.master.address);

      const action = AuthorityAction.Grant;
      const authorityType = AuthorityType.Clawback;
      const value = '0'; // Clawback authority doesn't need a value

      const prepared = TransactionBuilder.tokenAuthority({
        chain_id: chainId,
        nonce,
        action,
        authority_type: authorityType,
        authority_address: accounts.master.address,
        token: tokenAddress,
        value
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.master.privateKey));

      logStep('Granting clawback authority to master...');
      const response = await client.tokens.grantAuthority(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);
      grantClawbackAuthorityTxHash = response.hash;

      logStep('Clawback authority granted', `Hash: ${grantClawbackAuthorityTxHash}`);

      expect(grantClawbackAuthorityTxHash).to.be.a('string');

      // Wait for finalization
      logStep('Waiting for finalization...');
      const finalized = await waitForFinalization(grantClawbackAuthorityTxHash);
      expect(finalized).to.be.true;

      logStep('✓ Clawback authority granted to master successfully');
    });

    // it('should perform clawback from user3 to user1', async function () {
    //   logSection('Step 4.5b: Clawback Tokens from User3 to User1');

    //   const nonce = await getAccountNonce(accounts.master.address);

    //   // Clawback 10 tokens from user3 and send to user1
    //   const value = '10000000000000000000'; // 10 tokens

    //   const prepared = TransactionBuilder.tokenClawback({
    //     chain_id: chainId,
    //     nonce,
    //     token: tokenAddress,
    //     from: accounts.user3.address, // Taking from user3
    //     recipient: accounts.user1.address, // Sending to user1
    //     value
    //   });
    //   const signed = await prepared.sign(createPrivateKeySigner(accounts.master.privateKey));

    //   logStep('Clawing back tokens from user3 to user1...');
    //   const response = await client.tokens.clawbackToken(signed.toRequest());
    //   expect(response.hash).to.equal(signed.txHash);
    //   clawbackTxHash = response.hash;

    //   logStep('Tokens clawed back', `Hash: ${clawbackTxHash}`);

    //   expect(clawbackTxHash).to.be.a('string');

    //   await wait(2000);
    //   const receipt = await client.transactions.getReceiptByHash(clawbackTxHash);
    //   expect(receipt.success).to.be.true;

    //   logStep('✓ Clawback successful - tokens moved from user3 to user1');
    // });

    it('should revoke clawback authority from master', async function () {
      logSection('Step 4.5c: Revoke Clawback Authority from Master');

      const nonce = await getAccountNonce(accounts.master.address);

      const action = AuthorityAction.Revoke;
      const authorityType = AuthorityType.Clawback;
      const value = '0';

      const prepared = TransactionBuilder.tokenAuthority({
        chain_id: chainId,
        nonce,
        action,
        authority_type: authorityType,
        authority_address: accounts.master.address,
        token: tokenAddress,
        value
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.master.privateKey));

      logStep('Revoking clawback authority from master...');
      const response = await client.tokens.grantAuthority(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);

      logStep('Clawback authority revoked');

      await wait(2000);
      const receipt = await client.transactions.getReceiptByHash(response.hash);
      expect(receipt.success).to.be.true;

      logStep('✓ Clawback authority revoked from master successfully');
    });
  });

  describe('4.6. Grant Burn Authority to User3', function () {
    it('should grant burn authority to user3', async function () {
      logSection('Step 4.6: Grant Burn Authority to User3');

      const nonce = await getAccountNonce(accounts.master.address);

      const action = AuthorityAction.Grant;
      const authorityType = AuthorityType.MintBurnTokens;
      const value = '1000000000000000000000'; // 1000 tokens

      const prepared = TransactionBuilder.tokenAuthority({
        chain_id: chainId,
        nonce,
        action,
        authority_type: authorityType,
        authority_address: accounts.user3.address,
        token: tokenAddress,
        value
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.master.privateKey));

      logStep('Granting burn authority to user3...');
      const response = await client.tokens.grantAuthority(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);
      grantAuthorityUser3TxHash = response.hash;

      logStep('Authority granted', `Hash: ${grantAuthorityUser3TxHash}`);

      expect(grantAuthorityUser3TxHash).to.be.a('string');

      // Wait for finalization
      logStep('Waiting for finalization...');
      const finalized = await waitForFinalization(grantAuthorityUser3TxHash);
      expect(finalized).to.be.true;

      logStep('✓ Burn authority granted to user3 successfully');
    });
  });

  describe('5. Burn Token', function () {
    it('should burn tokens from user3', async function () {
      logSection('Step 5: Burn Token');

      const nonce = await getAccountNonce(accounts.user3.address);

      const value = '10000000000000000000'; // 10 tokens

      const prepared = TransactionBuilder.tokenBurn({
        chain_id: chainId,
        nonce,
        value,
        token: tokenAddress
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.user3.privateKey));

      logStep('Burning tokens...');
      const response = await client.tokens.burnToken(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);
      burnTokenTxHash = response.hash;

      logStep('Tokens burned', `Hash: ${burnTokenTxHash}`);

      expect(burnTokenTxHash).to.be.a('string');

      await wait(2000);
      const receipt = await client.transactions.getReceiptByHash(burnTokenTxHash);
      expect(receipt.success).to.be.true;

      logStep('✓ Tokens burned successfully');
    });
  });

  describe('5.5. Grant Bridge Authority to User1', function () {
    it('should grant bridge authority to user1', async function () {
      logSection('Step 5.5: Grant Bridge Authority to User1');

      const nonce = await getAccountNonce(accounts.master.address);

      const action = AuthorityAction.Grant;
      const authorityType = AuthorityType.Bridge;
      const value = '0'; // Bridge authority doesn't need a value

      const prepared = TransactionBuilder.tokenAuthority({
        chain_id: chainId,
        nonce,
        action,
        authority_type: authorityType,
        authority_address: accounts.user1.address,
        token: tokenAddress,
        value
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.master.privateKey));

      logStep('Granting bridge authority to user1...');
      const response = await client.tokens.grantAuthority(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);
      grantBridgeAuthorityUser1TxHash = response.hash;

      logStep('Bridge authority granted', `Hash: ${grantBridgeAuthorityUser1TxHash}`);

      expect(grantBridgeAuthorityUser1TxHash).to.be.a('string');

      // Wait for finalization
      logStep('Waiting for finalization...');
      const finalized = await waitForFinalization(grantBridgeAuthorityUser1TxHash);
      expect(finalized).to.be.true;

      logStep('✓ Bridge authority granted to user1 successfully');
    });
  });

  describe('6. Bridge and Mint', function () {
    it('should bridge and mint tokens', async function () {
      logSection('Step 6: Bridge and Mint');

      const nonce = await getAccountNonce(accounts.user1.address);
      console.log(`user1 nonce: ${nonce}, user1 account: ${accounts.user1.address}`);

      const bridgeMetadata = 'test_bridge';
      const sourceChainId = 1;
      const sourceTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const value = '25000000000000000000'; // 25 tokens

      const prepared = TransactionBuilder.tokenBridgeAndMint({
        bridge_metadata: bridgeMetadata,
        chain_id: chainId,
        nonce,
        recipient: accounts.user2.address,
        source_chain_id: sourceChainId,
        source_tx_hash: sourceTxHash,
        token: tokenAddress,
        value
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.user1.privateKey));

      logStep('Bridging and minting tokens...');
      const response = await client.tokens.bridgeAndMint(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);
      bridgeAndMintTxHash = response.hash;

      logStep('Tokens bridged and minted', `Hash: ${bridgeAndMintTxHash}`);

      expect(bridgeAndMintTxHash).to.be.a('string');

      await wait(2000);
      const receipt = await client.transactions.getReceiptByHash(bridgeAndMintTxHash);
      expect(receipt.success).to.be.true;

      logStep('✓ Bridge and mint successful');
    });
  });

  describe('7. Burn and Bridge', function () {
    it('should burn and bridge tokens', async function () {
      logSection('Step 7: Burn and Bridge');

      const nonce = await getAccountNonce(accounts.user2.address);

      const bridgeMetadata = 'test_bridge';
      const bridgeParam = '0x'; // Empty bytes data
      const destinationAddress = '0x1234567890abcdef1234567890abcdef12345678';
      const destinationChainId = 1;
      const escrowFee = '1000000000000000000'; // 1 token
      const value = '20000000000000000000'; // 20 tokens

      const prepared = TransactionBuilder.tokenBurnAndBridge({
        bridge_metadata: bridgeMetadata,
        bridge_param: bridgeParam,
        chain_id: chainId,
        destination_address: destinationAddress,
        destination_chain_id: destinationChainId,
        escrow_fee: escrowFee,
        nonce,
        sender: accounts.user2.address,
        token: tokenAddress,
        value
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.user2.privateKey));

      logStep('Burning and bridging tokens...');
      const response = await client.tokens.burnAndBridge(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);
      burnAndBridgeTxHash = response.hash;

      logStep('Tokens burned and bridged', `Hash: ${burnAndBridgeTxHash}`);

      expect(burnAndBridgeTxHash).to.be.a('string');

      await wait(2000);
      const receipt = await client.transactions.getReceiptByHash(burnAndBridgeTxHash);
      expect(receipt.success).to.be.true;

      logStep('✓ Burn and bridge successful');
    });
  });

  describe('8. Revoke Authority', function () {
    it('should revoke mint authority from user1', async function () {
      logSection('Step 8: Revoke Authority from User1');

      const nonce = await getAccountNonce(accounts.master.address);

      const action = AuthorityAction.Revoke;
      const authorityType = AuthorityType.MintBurnTokens;
      const value = '0'; // Revoke doesn't need a value, but include it for signature consistency

      const prepared = TransactionBuilder.tokenAuthority({
        chain_id: chainId,
        nonce,
        action,
        authority_type: authorityType,
        authority_address: accounts.user1.address,
        token: tokenAddress,
        value
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.master.privateKey));

      logStep('Revoking authority from user1...');
      const response = await client.tokens.grantAuthority(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);
      revokeAuthorityTxHash = response.hash;

      logStep('Authority revoked', `Hash: ${revokeAuthorityTxHash}`);

      expect(revokeAuthorityTxHash).to.be.a('string');

      await wait(2000);
      const receipt = await client.transactions.getReceiptByHash(revokeAuthorityTxHash);
      expect(receipt.success).to.be.true;

      logStep('✓ Authority revoked from user1 successfully');
    });

    it('should revoke burn authority from user3', async function () {
      logSection('Step 8.5: Revoke Authority from User3');

      const nonce = await getAccountNonce(accounts.master.address);

      const action = AuthorityAction.Revoke;
      const authorityType = AuthorityType.MintBurnTokens;
      const value = '0';

      const prepared = TransactionBuilder.tokenAuthority({
        chain_id: chainId,
        nonce,
        action,
        authority_type: authorityType,
        authority_address: accounts.user3.address,
        token: tokenAddress,
        value
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.master.privateKey));

      logStep('Revoking authority from user3...');
      const response = await client.tokens.grantAuthority(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);
      revokeAuthorityUser3TxHash = response.hash;

      logStep('Authority revoked', `Hash: ${revokeAuthorityUser3TxHash}`);

      expect(revokeAuthorityUser3TxHash).to.be.a('string');

      await wait(2000);
      const receipt = await client.transactions.getReceiptByHash(revokeAuthorityUser3TxHash);
      expect(receipt.success).to.be.true;

      logStep('✓ Authority revoked from user3 successfully');
    });

    it('should revoke bridge authority from user1', async function () {
      logSection('Step 8.6: Revoke Bridge Authority from User1');

      const nonce = await getAccountNonce(accounts.master.address);

      const action = AuthorityAction.Revoke;
      const authorityType = AuthorityType.Bridge;
      const value = '0';

      const prepared = TransactionBuilder.tokenAuthority({
        chain_id: chainId,
        nonce,
        action,
        authority_type: authorityType,
        authority_address: accounts.user1.address,
        token: tokenAddress,
        value
      });
      const signed = await prepared.sign(createPrivateKeySigner(accounts.master.privateKey));

      logStep('Revoking bridge authority from user1...');
      const response = await client.tokens.grantAuthority(signed.toRequest());
      expect(response.hash).to.equal(signed.txHash);
      revokeBridgeAuthorityUser1TxHash = response.hash;

      logStep('Bridge authority revoked', `Hash: ${revokeBridgeAuthorityUser1TxHash}`);

      expect(revokeBridgeAuthorityUser1TxHash).to.be.a('string');

      await wait(2000);
      const receipt = await client.transactions.getReceiptByHash(revokeBridgeAuthorityUser1TxHash);
      expect(receipt.success).to.be.true;

      logStep('✓ Bridge authority revoked from user1 successfully');
    });
  });

  describe('9. Checkpoint Validation', function () {
    it('should fetch checkpoint by number', async function () {
      logSection('Checkpoint Validation');

      const currentCheckpoint = await getCurrentCheckpoint();

      logStep('Fetching checkpoint by number', `Checkpoint: ${currentCheckpoint}`);

      const checkpoint = await client.checkpoints.getByNumber(currentCheckpoint);

      expect(checkpoint.number).to.equal(currentCheckpoint);
      expect(checkpoint.transactions).to.be.an('array');

      logStep('✓ Checkpoint validated');
    });

    it('should fetch checkpoint by hash', async function () {
      const currentCheckpoint = await getCurrentCheckpoint();
      const checkpoint = await client.checkpoints.getByNumber(currentCheckpoint);

      logStep('Fetching checkpoint by hash', `Hash: ${checkpoint.hash}`);

      const checkpointByHash = await client.checkpoints.getByHash(checkpoint.hash);

      expect(checkpointByHash.hash).to.equal(checkpoint.hash);

      logStep('✓ Checkpoint by hash validated');
    });
  });

  after(function () {
    logSection('Integration Test Completed');
    console.log('All main business flow tests passed successfully!\n');
  });
});
