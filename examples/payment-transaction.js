// Example of creating and submitting a payment transaction using the
// native v2 (domain-separated) signing scheme -- the default and only
// fully-supported write path as of 3.0. See skills/1money-protocol-sdk
// or skills/1money-protocol-sdk/references/transactions.md for the full
// TransactionBuilder reference.
//
// Note: This example requires a private key to sign the transaction.

import { api } from '../src/api';
// CHAIN_IDS is not currently re-exported from '../src/api' (only used
// internally there) -- import it from its actual module.
import { CHAIN_IDS } from '../src/api/constants';
import { TransactionBuilder, createPrivateKeySigner } from '../src/signing';
import { privateKeyToAccount } from 'viem/accounts';

// Initialize the API client
const apiClient = api();

// Example values - replace with real values for actual use
const privateKey = '0x0000000000000000000000000000000000000000000000000000000000000001'; // Replace with a real private key
const recipientAddress = '0xA634dfba8c7550550817898bC4820cD10888Aac5';
const tokenAddress = '0x91f66cb6c9b56c7e3bcdb9eff9da13da171e89f4';
const value = '1000000000'; // 1 token with 9 decimals
const chainId = CHAIN_IDS.TESTNET; // Using the testnet chain ID from the SDK

/**
 * Build, sign, and submit a v2 payment transaction.
 *
 * This replaces the pre-3.0 flow (manual RLP encoding + a top-level
 * `{ r, s, v }` signature field posted to /v1/transactions/payment).
 * That legacy shape still exists as `apiClient.transactions.legacyV1.payment`
 * for the migration window, but new code should always go through
 * `TransactionBuilder`, which:
 *   1. Computes the correct domain-separated `signingHash` for you
 *      (no manual RLP/EIP-712 wiring required).
 *   2. Rejects a high-S signature locally instead of letting the node
 *      reject it after submission.
 *   3. Re-derives and verifies the transaction hash the node returns,
 *      failing closed on a mismatch (see TransactionHashMismatchError).
 *
 * @param {string} privateKey - Private key to sign the transaction
 * @param {string} recipient - Recipient address
 * @param {string} token - Token address
 * @param {string} value - Amount to send
 * @param {number} chainId - Chain ID
 * @returns {Promise<{ hash: string }>} - The node's response
 */
async function createAndSubmitPaymentTransaction(privateKey, recipient, token, value, chainId) {
  const senderAddress = privateKeyToAccount(privateKey).address;
  console.log(`Sender address: ${senderAddress}`);

  // Step 1: Get the current nonce for the sender
  const { nonce } = await apiClient.accounts.getNonce(senderAddress);
  console.log(`Current nonce for ${senderAddress}: ${nonce}`);

  // Step 2: Build the unsigned v2 payment. `TransactionBuilder.payment`
  // validates the shape and computes `signingHash` -- the 32-byte digest
  // to sign -- from the domain-separated, memo-aware encoding.
  const prepared = TransactionBuilder.payment({
    chain_id: chainId,
    nonce,
    recipient,
    value,
    token
  });
  console.log('Signing hash:', prepared.signingHash);

  // Step 3: Sign the digest. `createPrivateKeySigner` always produces a
  // low-S signature; a custom signer (HSM/KMS/wallet) implementing
  // `SignerAdapter` works the same way -- see the "Custom signer"
  // section in transactions.md.
  const signer = createPrivateKeySigner(privateKey);
  const signature = await signer.signDigest(prepared.signingHash);

  // Step 4: Authorize -- attaches the signature, computes the final
  // transactionHash, and packages the /v2 request body.
  const authorized = prepared.authorize(signature);

  // Step 5: Submit. `submitAuthorized` under the hood returns a plain
  // Promise (no `.success()`/`.error()` chain) -- always await it in a
  // try/catch. A thrown error here is one of:
  //   - TransactionHashMismatchError (submitted: true -- do not retry)
  //   - TransactionSubmissionError   (submitted: false -- safe to retry)
  //   - TransactionOutcomeUnknownError (ambiguous -- query the hash first)
  // See skills/1money-protocol-sdk/references/client-and-errors.md.
  try {
    const response = await apiClient.transactions.payment(authorized);
    console.log('Payment transaction submitted successfully');
    console.log('Transaction hash:', response.hash);
    return response;
  } catch (error) {
    console.error('Error submitting payment transaction:', error);
    throw error;
  }
}

/**
 * Verify transaction status
 * @param {string} txHash - Transaction hash to verify
 * @returns {Promise<object>} - Transaction receipt
 */
async function verifyTransaction(txHash) {
  return new Promise((resolve, reject) => {
    apiClient.transactions.getReceiptByHash(txHash)
      .success(response => {
        console.log('Transaction receipt:', response);
        resolve(response);
      })
      .error(err => {
        console.error('Error fetching transaction receipt:', err);
        reject(err);
      });
  });
}

/**
 * Main function to demonstrate the payment process
 */
async function main() {
  try {
    console.log('=== 1Money Network Payment Transaction Example ===');
    console.log('Building, signing, and submitting a v2 payment transaction...');

    // Uncomment to actually submit the transaction against testnet.
    // Note: this will fail with the example private key above (no funds,
    // no nonce), and network calls are commented out by default so this
    // file can be read without side effects.
    // const response = await createAndSubmitPaymentTransaction(
    //   privateKey,
    //   recipientAddress,
    //   tokenAddress,
    //   value,
    //   chainId
    // );
    // console.log('\nWaiting for transaction confirmation...');
    // await new Promise(resolve => setTimeout(resolve, 5000));
    // const receipt = await verifyTransaction(response.hash);
    // console.log('\nTransaction status:', receipt.success ? 'SUCCESS' : 'FAILED');

    console.log('\nTo actually submit, uncomment the call to createAndSubmitPaymentTransaction() above.');
    console.log('\nExample completed successfully');
    console.log('=== End of Example ===');
  } catch (error) {
    console.error('\nError in payment example:', error);
  }
}

// Run the example if this file is executed directly.
console.log('Running payment transaction example...');
main().catch(console.error);

export {
  createAndSubmitPaymentTransaction,
  verifyTransaction
};
