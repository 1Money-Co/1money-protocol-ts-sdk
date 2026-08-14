import { expect } from 'chai';
import 'mocha';
import { getPublicKey } from '@noble/secp256k1';
import {
  bytesToHex,
  hexToBytes
} from 'viem';

import {
  createPrivateKeySigner,
  deriveMultisigAddress,
  TransactionBuilder
} from '@/signing';
import {
  AuthorityAction,
  AuthorityType,
  ManageListAction,
  PauseAction
} from '@/api/tokens/types';

import { getIntegrationContext } from './context';
import {
  classifyBatchFailureSubmission,
  classifyFailedBatchObservation,
  classifyNextValidSubmissionError,
  cleanupBlacklistedAddress,
  generateRandomSymbol,
  isConfirmedReadNotFound,
  observeForWindow,
  requireSuccessfulReceipt,
  totalMintAllocation,
  waitForResult
} from './helpers';
import { authorizeAndSubmitV2 } from './v2';

type Context = ReturnType<
  typeof getIntegrationContext
>;
type PrivateKeySigner = ReturnType<
  typeof createPrivateKeySigner
>;

const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const BATCH_PAYMENT_FIXTURE_BALANCE = '1000000';
const BATCH_PAYMENT_RECIPIENT_BALANCE = '1';
const BATCH_FAILURE_OPERATION_AMOUNT = '1';
const BATCH_FAILURE_FUNDING_BUFFER = '1000';
const BATCH_FAILURE_OBSERVATION_ATTEMPTS = 30;
const BATCH_FAILURE_OBSERVATION_INTERVAL_MS = 250;

// Polling a receipt for a transaction submitted moments ago. Measured
// against the local network with INTEGRATION_TEST_VERBOSE=true: all 33
// receipt lookups in a run needed exactly two 404s before the 200 (96 of
// 129 receipt reads overall), because a receipt only becomes readable
// between 250ms and 500ms after submission. Holding the first look until
// then removes every one of those misses at no cost in wall clock -- the
// same ~500ms elapses either way, sleeping rather than issuing reads that
// cannot succeed. Retries stay short so a slower network still converges.
const RECEIPT_POLL = {
  initialDelayMs: 500,
  intervalMs: 250
} as const;

// Polling for chain state after its receipt is already confirmed:
// balances, token metadata, nonces. These are measurably different from
// receipts -- across a full run, token_account (29 reads), token_metadata
// (20) and nonce (36) never missed once, because the state is already
// settled by the time a confirmed receipt lets the test proceed. An
// initial delay here would be ~500ms of pure waste per call site, which
// on ~30 sites cost 16s of suite time when it was applied uniformly.
const STATE_POLL = { intervalMs: 250 } as const;

const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).length;

// Exactly the per-field protocol limits from
// src/utils/memo/types.ts: 128 / 64 / 256 bytes. Each field is well past
// 55 bytes, so all three encode with an RLP long-form string header --
// a path no other memo in this suite reaches, since the batch payment
// memo above uses 11 / 10 / 26-byte fields. `type` and `format` stay
// inside the URL-safe charset the validator enforces.
const MAX_MEMO_TYPE = `integration/${'t'.repeat(116)}`;
const MAX_MEMO_FORMAT = `text/plain;${'f'.repeat(53)}`;
const MAX_MEMO_DATA = `max-size memo ${'d'.repeat(242)}`;

interface BatchPaymentFixture {
  tokenAddress: string;
  tokenSymbol: string;
}

// The outcomes a rejected batch payment could take, before
// they are narrowed to the single expected one. Only the
// widened forms live here; the nonce delta and the
// continuation outcome are asserted directly against exact
// values, so they carry no union.
export interface BatchFailureObservation {
  submission:
    | 'hash_returned'
    | 'refused'
    | 'outcome_unknown';
  receipt: 'not_found' | 'failure_receipt';
  finalized: 'not_found' | 'failure_receipt';
}

function isBatchPaymentUnavailable(
  error: unknown
): boolean {
  const message =
    typeof error === 'object' && error !== null
      ? [
          (error as { message?: unknown }).message,
          (error as { data?: unknown }).data
        ]
          .map(value =>
            typeof value === 'string'
              ? value
              : JSON.stringify(value)
          )
          .join(' ')
          .toLowerCase()
      : String(error).toLowerCase();
  if (message.includes('batch payments are disabled')) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 404
  );
}

describe('native v2 lifecycle integration', function () {
  let context: Context;
  let operatorSigner: PrivateKeySigner;
  let masterSigner: PrivateKeySigner;
  let user1Signer: PrivateKeySigner;
  let user2Signer: PrivateKeySigner;
  let user3Signer: PrivateKeySigner;
  let batchFailureSigner: PrivateKeySigner;
  let chainId: number;
  let tokenAddress: string;
  let privateTokenAddress: string;
  let issueHash: string;
  let tokenSymbol: string;
  let batchPaymentFixture:
    | Promise<BatchPaymentFixture>
    | undefined;
  let batchFailureFixture:
    | Promise<BatchPaymentFixture>
    | undefined;

  before(async function () {
    context = getIntegrationContext();
    this.timeout(context.config.timeout);

    if (!context.config.enabled) {
      this.skip();
    }

    const status =
      await context.client.status.getNativeWriteStatus();
    if (status.native_write_mode === 'v1_only') {
      this.skip();
    }

    expect(
      String(
        await context.client.status.getHealth()
      ).trim()
    ).to.equal('UP');

    chainId = (
      await context.client.chain.getChainId()
    ).chain_id;
    operatorSigner = createPrivateKeySigner(
      context.accounts.operator.privateKey
    );
    masterSigner = createPrivateKeySigner(
      context.accounts.master.privateKey
    );
    user1Signer = createPrivateKeySigner(
      context.accounts.user1.privateKey
    );
    user2Signer = createPrivateKeySigner(
      context.accounts.user2.privateKey
    );
    user3Signer = createPrivateKeySigner(
      context.accounts.user3.privateKey
    );
    batchFailureSigner = createPrivateKeySigner(
      context.accounts.batchFailure.privateKey
    );
  });

  async function ensureBatchPaymentFixture(): Promise<BatchPaymentFixture> {
    if (!batchPaymentFixture) {
      batchPaymentFixture = (async () => {
        const issueNonce = (
          await context.client.accounts.getNonce(
            context.accounts.operator.address
          )
        ).nonce;
        const fixtureTokenSymbol =
          generateRandomSymbol('BPF');
        const issuePrepared =
          TransactionBuilder.tokenIssue({
            chain_id: chainId,
            nonce: issueNonce,
            symbol: fixtureTokenSymbol,
            name: 'Batch Payment Fixture Token',
            decimals: 18,
            master_authority:
              context.accounts.master.address,
            is_private: false,
            clawback_enabled: true
          });
        const { response: issueResponse } =
          await authorizeAndSubmitV2(
            issuePrepared,
            operatorSigner,
            authorized =>
              context.client.tokens.issueToken(
                authorized
              )
          );
        const fixtureTokenAddress =
          issueResponse.token;
        const mintAllocations = [
          {
            recipient: context.accounts.user2.address,
            amount: BATCH_PAYMENT_FIXTURE_BALANCE
          },
          {
            recipient: context.accounts.user1.address,
            amount: BATCH_PAYMENT_RECIPIENT_BALANCE
          },
          {
            recipient: context.accounts.user3.address,
            amount: BATCH_PAYMENT_RECIPIENT_BALANCE
          },
          {
            recipient: context.accounts.operator.address,
            amount: BATCH_PAYMENT_RECIPIENT_BALANCE
          }
        ];
        const mintAllowance =
          totalMintAllocation(mintAllocations);

        const issueReceipt = await waitForResult(
          () =>
            context.client.transactions.getReceiptByHash(
              issueResponse.hash
            ),
          RECEIPT_POLL
        );
        expect(issueReceipt.success).to.equal(true);

        await waitForResult(
          () =>
            context.client.tokens.getTokenMetadata(
              fixtureTokenAddress
            ),
          STATE_POLL
        );

        const authorityNonce = (
          await context.client.accounts.getNonce(
            context.accounts.master.address
          )
        ).nonce;
        const authorityPrepared =
          TransactionBuilder.tokenAuthority({
            chain_id: chainId,
            nonce: authorityNonce,
            action: AuthorityAction.Grant,
            authority_type:
              AuthorityType.MintBurnTokens,
            authority_address:
              context.accounts.user1.address,
            token: fixtureTokenAddress,
            value: mintAllowance
          });
        const { response: authorityResponse } =
          await authorizeAndSubmitV2(
            authorityPrepared,
            masterSigner,
            authorized =>
              context.client.tokens.grantAuthority(
                authorized
              )
          );
        const authorityReceipt = await waitForResult(
          () =>
            context.client.transactions.getReceiptByHash(
              authorityResponse.hash
            ),
          RECEIPT_POLL
        );
        expect(authorityReceipt.success).to.equal(true);

        await waitForResult(
          async () => {
            const metadata =
              await context.client.tokens.getTokenMetadata(
                fixtureTokenAddress
              );
            if (
              !metadata.mint_burn_authorities.some(
                authority =>
                  authority.minter.toLowerCase() ===
                  context.accounts.user1.address.toLowerCase()
              )
            ) {
              throw new Error(
                'Batch Payment fixture mint authority is not visible yet'
              );
            }
            return metadata;
          },
          STATE_POLL
        );

        const mintTo = async (
          recipient: string,
          value: string
        ): Promise<void> => {
          const nonce = (
            await context.client.accounts.getNonce(
              context.accounts.user1.address
            )
          ).nonce;
          const prepared =
            TransactionBuilder.tokenMint({
              chain_id: chainId,
              nonce,
              recipient,
              value,
              token: fixtureTokenAddress
            });
          const { response } =
            await authorizeAndSubmitV2(
              prepared,
              user1Signer,
              authorized =>
                context.client.tokens.mintToken(
                  authorized
                )
            );
          const receipt = await waitForResult(
            () =>
              context.client.transactions.getReceiptByHash(
                response.hash
              ),
            RECEIPT_POLL
          );
          expect(receipt.success).to.equal(true);
        };

        for (const allocation of mintAllocations) {
          await mintTo(
            allocation.recipient,
            allocation.amount
          );
        }

        const [sender, firstRecipient, secondRecipient, operator] =
          await waitForResult(
          async () => {
            const accounts = await Promise.all([
              context.client.accounts.getTokenAccount(
                context.accounts.user2.address,
                fixtureTokenAddress
              ),
              context.client.accounts.getTokenAccount(
                context.accounts.user1.address,
                fixtureTokenAddress
              ),
              context.client.accounts.getTokenAccount(
                context.accounts.user3.address,
                fixtureTokenAddress
              ),
              context.client.accounts.getTokenAccount(
                context.accounts.operator.address,
                fixtureTokenAddress
              )
            ]);
            if (
              BigInt(accounts[0].balance) <
                BigInt(BATCH_PAYMENT_FIXTURE_BALANCE) ||
              BigInt(accounts[1].balance) <
                BigInt(BATCH_PAYMENT_RECIPIENT_BALANCE) ||
              BigInt(accounts[2].balance) <
                BigInt(BATCH_PAYMENT_RECIPIENT_BALANCE) ||
              BigInt(accounts[3].balance) <
                BigInt(BATCH_PAYMENT_RECIPIENT_BALANCE)
            ) {
              throw new Error(
                'Batch Payment fixture accounts are not funded yet'
              );
            }
            return accounts;
          },
          STATE_POLL
        );
        expect(
          BigInt(sender.balance) >=
            BigInt(BATCH_PAYMENT_FIXTURE_BALANCE)
        ).to.equal(true);
        expect(
          BigInt(firstRecipient.balance) >=
            BigInt(BATCH_PAYMENT_RECIPIENT_BALANCE)
        ).to.equal(true);
        expect(
          BigInt(secondRecipient.balance) >=
            BigInt(BATCH_PAYMENT_RECIPIENT_BALANCE)
        ).to.equal(true);
        expect(
          BigInt(operator.balance) >=
            BigInt(BATCH_PAYMENT_RECIPIENT_BALANCE)
        ).to.equal(true);

        return {
          tokenAddress: fixtureTokenAddress,
          tokenSymbol: fixtureTokenSymbol
        };
      })();
    }
    return batchPaymentFixture;
  }

  async function ensureBatchFailureFixture(): Promise<BatchPaymentFixture> {
    if (!batchFailureFixture) {
      batchFailureFixture = (async () => {
        const fixture = await ensureBatchPaymentFixture();
        const operations = [
          {
            recipient: context.accounts.user1.address,
            amount: BATCH_FAILURE_OPERATION_AMOUNT
          },
          {
            recipient: context.accounts.user3.address,
            amount: BATCH_FAILURE_OPERATION_AMOUNT
          }
        ];
        const quote =
          await context.client.transactions
            .estimateBatchPaymentFee({
              from: context.accounts.batchFailure.address,
              token: fixture.tokenAddress,
              operations
            });
        const fundingAmount = (
          BigInt(quote.fee) +
          BigInt(BATCH_FAILURE_OPERATION_AMOUNT) *
            BigInt(operations.length) +
          BigInt(BATCH_FAILURE_FUNDING_BUFFER)
        ).toString();
        const nonce = (
          await context.client.accounts.getNonce(
            context.accounts.user2.address
          )
        ).nonce;
        const prepared = TransactionBuilder.payment({
          chain_id: chainId,
          nonce,
          recipient: context.accounts.batchFailure.address,
          value: fundingAmount,
          token: fixture.tokenAddress
        });
        const { response } =
          await authorizeAndSubmitV2(
            prepared,
            user2Signer,
            authorized =>
              context.client.transactions.payment(
                authorized
              )
          );
        const receipt = await waitForResult(
          () =>
            context.client.transactions.getReceiptByHash(
              response.hash
            ),
          RECEIPT_POLL
        );
        expect(receipt.success).to.equal(true);

        await waitForResult(
          async () => {
            const account =
              await context.client.accounts.getTokenAccount(
                context.accounts.batchFailure.address,
                fixture.tokenAddress
              );
            if (
              BigInt(account.balance) <
              BigInt(fundingAmount)
            ) {
              throw new Error(
                'Batch failure fixture account is not funded yet'
              );
            }
            return account;
          },
          STATE_POLL
        );

        return fixture;
      })();
    }
    return batchFailureFixture;
  }

  function isBlacklisted(
    addresses: string[],
    address: string
  ): boolean {
    return addresses.some(
      entry =>
        entry.toLowerCase() ===
        address.toLowerCase()
    );
  }

  async function setBatchFailureBlacklist(
    token: string,
    action: ManageListAction
  ): Promise<void> {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared = TransactionBuilder.tokenBlacklist({
      chain_id: chainId,
      nonce,
      action,
      address: context.accounts.user3.address,
      token
    });
    const { response } = await authorizeAndSubmitV2(
      prepared,
      masterSigner,
      authorized =>
        context.client.tokens.manageBlacklist(
          authorized
        )
    );
    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    await waitForResult(
      async () => {
        const metadata =
          await context.client.tokens.getTokenMetadata(token);
        const listed = isBlacklisted(
          metadata.black_list,
          context.accounts.user3.address
        );
        if (
          listed !==
          (action === ManageListAction.Add)
        ) {
          throw new Error(
            `Batch failure recipient blacklist did not ${action.toLowerCase()}`
          );
        }
        return metadata;
      },
      STATE_POLL
    );
  }

  async function cleanupBatchFailureBlacklist(
    token: string
  ): Promise<void> {
    await cleanupBlacklistedAddress(
      () =>
        context.client.tokens.getTokenMetadata(token),
      () =>
        setBatchFailureBlacklist(
          token,
          ManageListAction.Remove
        ),
      context.accounts.user3.address,
      {
        attempts:
          BATCH_FAILURE_OBSERVATION_ATTEMPTS,
        intervalMs:
          BATCH_FAILURE_OBSERVATION_INTERVAL_MS
      }
    );
  }

  it('issues a token through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.operator.address
      )
    ).nonce;
    tokenSymbol = generateRandomSymbol('V2');

    const prepared =
      TransactionBuilder.tokenIssue({
        chain_id: chainId,
        nonce,
        symbol: tokenSymbol,
        name: 'V2 Integration Token',
        decimals: 18,
        master_authority:
          context.accounts.master.address,
        is_private: false,
        clawback_enabled: true
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        operatorSigner,
        authorized =>
          context.client.tokens.issueToken(
            authorized
          )
      );

    issueHash = response.hash;
    tokenAddress = response.token;
    expect(tokenAddress).to.match(
      /^0x[0-9a-fA-F]{40}$/
    );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          issueHash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    const transaction = await waitForResult(
      () =>
        context.client.transactions.getByHash(
          issueHash
        ),
      STATE_POLL
    );
    expect(transaction.hash).to.equal(issueHash);
    expect(transaction.transaction_type).to.equal(
      'TokenCreate'
    );

    const metadata = await waitForResult(
      () =>
        context.client.tokens.getTokenMetadata(
          tokenAddress
        ),
      STATE_POLL
    );
    expect(metadata.symbol).to.equal(tokenSymbol);
    expect(metadata.meta.name).to.equal(
      'V2 Integration Token'
    );
    expect(metadata.clawback_enabled).to.equal(
      true
    );
  });

  it('grants mint authority through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenAuthority({
        chain_id: chainId,
        nonce,
        action: AuthorityAction.Grant,
        authority_type:
          AuthorityType.MintBurnTokens,
        authority_address:
          context.accounts.user1.address,
        token: tokenAddress,
        value: '1000'
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        masterSigner,
        authorized =>
          context.client.tokens.grantAuthority(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    const metadata = await waitForResult(
      async () => {
        const result =
          await context.client.tokens.getTokenMetadata(
            tokenAddress
          );
        if (
          !result.mint_burn_authorities.some(
            authority =>
              authority.minter.toLowerCase() ===
              context.accounts.user1.address.toLowerCase()
          )
        ) {
          throw new Error(
            'mint authority is not visible yet'
          );
        }
        return result;
      },
      STATE_POLL
    );
    expect(
      metadata.mint_burn_authorities.some(
        authority =>
          authority.minter.toLowerCase() ===
          context.accounts.user1.address.toLowerCase()
      )
    ).to.equal(true);
  });

  it('mints tokens through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.user1.address
      )
    ).nonce;
    const prepared = TransactionBuilder.tokenMint({
      chain_id: chainId,
      nonce,
      recipient: context.accounts.user2.address,
      value: '1000',
      token: tokenAddress
    });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        user1Signer,
        authorized =>
          context.client.tokens.mintToken(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    const tokenAccount = await waitForResult(
      async () => {
        const result =
          await context.client.accounts.getTokenAccount(
            context.accounts.user2.address,
            tokenAddress
          );
        if (result.balance !== '1000') {
          throw new Error(
            `expected balance 1000, received ${result.balance}`
          );
        }
        return result;
      },
      STATE_POLL
    );
    expect(tokenAccount.balance).to.equal('1000');
  });

  it('transfers tokens through a v2 payment', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.user2.address
      )
    ).nonce;
    const prepared = TransactionBuilder.payment({
      chain_id: chainId,
      nonce,
      recipient: context.accounts.user3.address,
      value: '100',
      token: tokenAddress
    });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        user2Signer,
        authorized =>
          context.client.transactions.payment(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    await waitForResult(
      async () => {
        const sender =
          await context.client.accounts.getTokenAccount(
            context.accounts.user2.address,
            tokenAddress
          );
        const recipient =
          await context.client.accounts.getTokenAccount(
            context.accounts.user3.address,
            tokenAddress
          );
        if (
          sender.balance !== '900' ||
          recipient.balance !== '100'
        ) {
          throw new Error(
            `expected balances 900/100, received ${sender.balance}/${recipient.balance}`
          );
        }
        return { sender, recipient };
      },
      STATE_POLL
    );
  });

  it('blacklists the clawback source through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenBlacklist({
        chain_id: chainId,
        nonce,
        action: ManageListAction.Add,
        address: context.accounts.user3.address,
        token: tokenAddress
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        masterSigner,
        authorized =>
          context.client.tokens.manageBlacklist(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    const metadata = await waitForResult(
      async () => {
        const result =
          await context.client.tokens.getTokenMetadata(
            tokenAddress
          );
        if (
          !result.black_list.some(
            address =>
              address.toLowerCase() ===
              context.accounts.user3.address.toLowerCase()
          )
        ) {
          throw new Error(
            'blacklisted account is not visible yet'
          );
        }
        return result;
      },
      STATE_POLL
    );
    expect(
      metadata.black_list.some(
        address =>
          address.toLowerCase() ===
          context.accounts.user3.address.toLowerCase()
      )
    ).to.equal(true);
  });

  it('claws back tokens through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenClawback({
        chain_id: chainId,
        nonce,
        token: tokenAddress,
        from: context.accounts.user3.address,
        recipient: context.accounts.master.address,
        value: '25'
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        masterSigner,
        authorized =>
          context.client.tokens.clawbackToken(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    await waitForResult(
      async () => {
        const source =
          await context.client.accounts.getTokenAccount(
            context.accounts.user3.address,
            tokenAddress
          );
        const recipient =
          await context.client.accounts.getTokenAccount(
            context.accounts.master.address,
            tokenAddress
          );
        if (
          source.balance !== '75' ||
          recipient.balance !== '25'
        ) {
          throw new Error(
            `expected balances 75/25, received ${source.balance}/${recipient.balance}`
          );
        }
        return { source, recipient };
      },
      STATE_POLL
    );
  });

  it('removes the source from the blacklist through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenBlacklist({
        chain_id: chainId,
        nonce,
        action: ManageListAction.Remove,
        address: context.accounts.user3.address,
        token: tokenAddress
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        masterSigner,
        authorized =>
          context.client.tokens.manageBlacklist(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    await waitForResult(
      async () => {
        const metadata =
          await context.client.tokens.getTokenMetadata(
            tokenAddress
          );
        if (
          metadata.black_list.some(
            address =>
              address.toLowerCase() ===
              context.accounts.user3.address.toLowerCase()
          )
        ) {
          throw new Error(
            'blacklisted account is still visible'
          );
        }
        return metadata;
      },
      STATE_POLL
    );
  });

  it('grants burn authority through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenAuthority({
        chain_id: chainId,
        nonce,
        action: AuthorityAction.Grant,
        authority_type:
          AuthorityType.MintBurnTokens,
        authority_address:
          context.accounts.user3.address,
        token: tokenAddress,
        value: '100'
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        masterSigner,
        authorized =>
          context.client.tokens.grantAuthority(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    await waitForResult(
      async () => {
        const metadata =
          await context.client.tokens.getTokenMetadata(
            tokenAddress
          );
        if (
          !metadata.mint_burn_authorities.some(
            authority =>
              authority.minter.toLowerCase() ===
              context.accounts.user3.address.toLowerCase()
          )
        ) {
          throw new Error(
            'burn authority is not visible yet'
          );
        }
        return metadata;
      },
      STATE_POLL
    );
  });

  it('burns tokens through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.user3.address
      )
    ).nonce;
    const prepared = TransactionBuilder.tokenBurn({
      chain_id: chainId,
      nonce,
      value: '10',
      token: tokenAddress
    });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        user3Signer,
        authorized =>
          context.client.tokens.burnToken(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    await waitForResult(
      async () => {
        const account =
          await context.client.accounts.getTokenAccount(
            context.accounts.user3.address,
            tokenAddress
          );
        const metadata =
          await context.client.tokens.getTokenMetadata(
            tokenAddress
          );
        if (
          account.balance !== '65' ||
          metadata.supply !== '990'
        ) {
          throw new Error(
            `expected balance/supply 65/990, received ${account.balance}/${metadata.supply}`
          );
        }
        return { account, metadata };
      },
      STATE_POLL
    );
  });

  it('pauses the token through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared = TransactionBuilder.tokenPause({
      chain_id: chainId,
      nonce,
      action: PauseAction.Pause,
      token: tokenAddress
    });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        masterSigner,
        authorized =>
          context.client.tokens.pauseToken(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    await waitForResult(
      async () => {
        const metadata =
          await context.client.tokens.getTokenMetadata(
            tokenAddress
          );
        if (!metadata.is_paused) {
          throw new Error(
            'token is not paused yet'
          );
        }
        return metadata;
      },
      STATE_POLL
    );
  });

  it('unpauses the token through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared = TransactionBuilder.tokenPause({
      chain_id: chainId,
      nonce,
      action: PauseAction.Unpause,
      token: tokenAddress
    });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        masterSigner,
        authorized =>
          context.client.tokens.pauseToken(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    await waitForResult(
      async () => {
        const metadata =
          await context.client.tokens.getTokenMetadata(
            tokenAddress
          );
        if (metadata.is_paused) {
          throw new Error(
            'token is still paused'
          );
        }
        return metadata;
      },
      STATE_POLL
    );
  });

  it('updates token metadata through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenMetadata({
        chain_id: chainId,
        nonce,
        name: 'Updated V2 Integration Token',
        uri: 'https://example.com/v2-token.json',
        token: tokenAddress,
        additional_metadata: [
          {
            key: 'suite',
            value: 'v2-lifecycle'
          }
        ]
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        masterSigner,
        authorized =>
          context.client.tokens.updateMetadata(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    const metadata = await waitForResult(
      async () => {
        const result =
          await context.client.tokens.getTokenMetadata(
            tokenAddress
          );
        if (
          result.meta.name !==
          'Updated V2 Integration Token'
        ) {
          throw new Error(
            'updated metadata is not visible yet'
          );
        }
        return result;
      },
      STATE_POLL
    );
    expect(metadata.meta.uri).to.equal(
      'https://example.com/v2-token.json'
    );
    expect(metadata.meta.additional_metadata).to.deep.equal(
      [
        {
          key: 'suite',
          value: 'v2-lifecycle'
        }
      ]
    );
  });

  it('grants bridge authority through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenAuthority({
        chain_id: chainId,
        nonce,
        action: AuthorityAction.Grant,
        authority_type: AuthorityType.Bridge,
        authority_address:
          context.accounts.user1.address,
        token: tokenAddress,
        value: '0'
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        masterSigner,
        authorized =>
          context.client.tokens.grantAuthority(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    await waitForResult(
      async () => {
        const metadata =
          await context.client.tokens.getTokenMetadata(
            tokenAddress
          );
        if (
          !metadata.bridge_mint_authorities.some(
            address =>
              address.toLowerCase() ===
              context.accounts.user1.address.toLowerCase()
          )
        ) {
          throw new Error(
            'bridge authority is not visible yet'
          );
        }
        return metadata;
      },
      STATE_POLL
    );
  });

  it('bridges and mints tokens through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.user1.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenBridgeAndMint({
        chain_id: chainId,
        nonce,
        recipient: context.accounts.user2.address,
        value: '100',
        token: tokenAddress,
        source_chain_id: 1,
        source_tx_hash: issueHash,
        bridge_metadata: 'v2-lifecycle'
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        user1Signer,
        authorized =>
          context.client.tokens.bridgeAndMint(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    await waitForResult(
      async () => {
        const account =
          await context.client.accounts.getTokenAccount(
            context.accounts.user2.address,
            tokenAddress
          );
        const metadata =
          await context.client.tokens.getTokenMetadata(
            tokenAddress
          );
        if (
          account.balance !== '1000' ||
          metadata.supply !== '1090'
        ) {
          throw new Error(
            `expected balance/supply 1000/1090, received ${account.balance}/${metadata.supply}`
          );
        }
        return { account, metadata };
      },
      STATE_POLL
    );
  });

  it('burns and bridges tokens through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.user2.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenBurnAndBridge({
        chain_id: chainId,
        nonce,
        sender: context.accounts.user2.address,
        value: '20',
        token: tokenAddress,
        destination_chain_id: 2,
        destination_address:
          context.accounts.user1.address,
        escrow_fee: '1',
        bridge_metadata: 'v2-lifecycle',
        bridge_param: '0x'
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        user2Signer,
        authorized =>
          context.client.tokens.burnAndBridge(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    await waitForResult(
      async () => {
        const account =
          await context.client.accounts.getTokenAccount(
            context.accounts.user2.address,
            tokenAddress
          );
        const metadata =
          await context.client.tokens.getTokenMetadata(
            tokenAddress
          );
        if (
          account.balance !== '979' ||
          metadata.supply !== '1070'
        ) {
          throw new Error(
            `expected balance/supply 979/1070, received ${account.balance}/${metadata.supply}`
          );
        }
        return { account, metadata };
      },
      STATE_POLL
    );
  });

  // AuthorityAction.Grant is exercised three times above; this is the only
  // coverage of the Revoke direction. It is placed after the last bridge
  // operation so that nothing downstream depends on the authority it
  // removes.
  it('revokes bridge authority through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenAuthority({
        chain_id: chainId,
        nonce,
        action: AuthorityAction.Revoke,
        authority_type: AuthorityType.Bridge,
        authority_address:
          context.accounts.user1.address,
        token: tokenAddress,
        value: '0'
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        masterSigner,
        authorized =>
          context.client.tokens.grantAuthority(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    await waitForResult(
      async () => {
        const metadata =
          await context.client.tokens.getTokenMetadata(
            tokenAddress
          );
        if (
          metadata.bridge_mint_authorities.some(
            address =>
              address.toLowerCase() ===
              context.accounts.user1.address.toLowerCase()
          )
        ) {
          throw new Error(
            'revoked bridge authority is still listed'
          );
        }
        return metadata;
      },
      STATE_POLL
    );
  });

  it('submits a batch payment through v2', async function () {
    const batchFixture =
      await ensureBatchPaymentFixture();
    const batchTokenAddress =
      batchFixture.tokenAddress;

    const operations = [
      {
        recipient: context.accounts.user1.address,
        amount: '10'
      },
      {
        recipient: context.accounts.user3.address,
        amount: '5'
      }
    ];
    let quote: { fee: string };

    try {
      quote =
        await context.client.transactions
          .estimateBatchPaymentFee({
            from: context.accounts.user2.address,
            token: batchTokenAddress,
            operations
          });
    } catch (error) {
      if (isBatchPaymentUnavailable(error)) {
        const configurationError = new Error(
          '[1Money SDK integration]: Enable Batch Payment in the local l1client governance configuration before running this suite; the local node must also expose /v1/transactions/batch_payment/estimate_fee'
        );
        (
          configurationError as Error & { cause?: unknown }
        ).cause = error;
        throw configurationError;
      }
      throw error;
    }

    expect(
      BigInt(quote.fee) >= BigInt(0)
    ).to.equal(true);

    const [
      senderBefore,
      firstBefore,
      secondBefore,
      operatorBefore
    ] = await Promise.all([
      context.client.accounts.getTokenAccount(
        context.accounts.user2.address,
        batchTokenAddress
      ),
      context.client.accounts.getTokenAccount(
        context.accounts.user1.address,
        batchTokenAddress
      ),
      context.client.accounts.getTokenAccount(
        context.accounts.user3.address,
        batchTokenAddress
      ),
      context.client.accounts.getTokenAccount(
        context.accounts.operator.address,
        batchTokenAddress
      )
    ]);

    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.user2.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.batchPayment({
        chain_id: chainId,
        nonce,
        token: batchTokenAddress,
        operations,
        created_at: Math.floor(Date.now() / 1000),
        batch_id: `v2-${batchFixture.tokenSymbol}`
      }, {
        memo: {
          type: 'integration',
          format: 'text/plain',
          data: 'batch payment v2 lifecycle'
        }
      });

    const { authorized, response } =
      await authorizeAndSubmitV2(
        prepared,
        user2Signer,
        authorized =>
          context.client.transactions.batchPayment(
            authorized
          )
      );

    expect(response.hash.toLowerCase()).to.equal(
      authorized.transactionHash.toLowerCase()
    );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);
    expect(receipt.batch_info?.operations_count).to.equal(
      operations.length
    );
    expect(receipt.batch_info?.total_amount).to.equal(
      '15'
    );
    expect(receipt.batch_info?.failure).to.equal(null);
    expect(
      receipt.success_info?.receiver.toLowerCase()
    ).to.equal(ZERO_ADDRESS);

    const events = receipt.execution_events;
    expect(events?.map(event => event.event_type)).to.deep.equal([
      'BatchStarted',
      'PaymentExecuted',
      'PaymentExecuted',
      'BatchCompleted'
    ]);

    const firstPayment = events?.[1];
    const secondPayment = events?.[2];
    if (
      firstPayment?.event_type !== 'PaymentExecuted' ||
      secondPayment?.event_type !== 'PaymentExecuted'
    ) {
      throw new Error(
        '[1Money SDK integration]: expected ordered Batch Payment execution events'
      );
    }
    expect(firstPayment.recipient.toLowerCase()).to.equal(
      operations[0].recipient.toLowerCase()
    );
    expect(firstPayment.amount).to.equal(
      operations[0].amount
    );
    expect(secondPayment.recipient.toLowerCase()).to.equal(
      operations[1].recipient.toLowerCase()
    );
    expect(secondPayment.amount).to.equal(
      operations[1].amount
    );

    await waitForResult(
      async () => {
        const [
          senderAfter,
          firstAfter,
          secondAfter,
          operatorAfter
        ] = await Promise.all([
          context.client.accounts.getTokenAccount(
            context.accounts.user2.address,
            batchTokenAddress
          ),
          context.client.accounts.getTokenAccount(
            context.accounts.user1.address,
            batchTokenAddress
          ),
          context.client.accounts.getTokenAccount(
            context.accounts.user3.address,
            batchTokenAddress
          ),
          context.client.accounts.getTokenAccount(
            context.accounts.operator.address,
            batchTokenAddress
          )
        ]);
        const total = operations.reduce(
          (sum, operation) =>
            sum + BigInt(operation.amount),
          BigInt(0)
        );
        const actualFee = BigInt(receipt.fee_used);

        if (
          BigInt(senderAfter.balance) !==
            BigInt(senderBefore.balance) - total - actualFee ||
          BigInt(firstAfter.balance) !==
            BigInt(firstBefore.balance) +
              BigInt(operations[0].amount) ||
          BigInt(secondAfter.balance) !==
            BigInt(secondBefore.balance) +
              BigInt(operations[1].amount) ||
          BigInt(operatorAfter.balance) !==
            BigInt(operatorBefore.balance) + actualFee
        ) {
          throw new Error(
            '[1Money SDK integration]: Batch Payment balance accounting did not converge'
          );
        }
        return {
          senderAfter,
          firstAfter,
          secondAfter,
          operatorAfter
        };
      },
      STATE_POLL
    );
  });

  // A batch carrying one blacklisted recipient is refused whole: the node
  // runs a pre-execution at admission under the full validation rule set
  // (om-verifier/src/transaction_verifier.rs), so the batch never reaches
  // execution and never lands. The valid operation alongside it must not
  // apply either -- that all-or-nothing property is what this pins, together
  // with the nonce staying reusable so a caller can correct and resubmit.
  it('refuses a blacklisted-recipient batch payment whole and leaves the nonce reusable', async function () {
    this.timeout(context.config.timeout);

    const fixture = await ensureBatchFailureFixture();
    const operations = [
      {
        recipient: context.accounts.user1.address,
        amount: BATCH_FAILURE_OPERATION_AMOUNT
      },
      {
        recipient: context.accounts.user3.address,
        amount: BATCH_FAILURE_OPERATION_AMOUNT
      }
    ];

    try {
      await setBatchFailureBlacklist(
        fixture.tokenAddress,
        ManageListAction.Add
      );
      const nonceBefore = (
        await context.client.accounts.getNonce(
          context.accounts.batchFailure.address
        )
      ).nonce;
      const [
        senderBefore,
        validRecipientBefore,
        blacklistedRecipientBefore,
        operatorBefore
      ] = await Promise.all([
        context.client.accounts.getTokenAccount(
          context.accounts.batchFailure.address,
          fixture.tokenAddress
        ),
        context.client.accounts.getTokenAccount(
          context.accounts.user1.address,
          fixture.tokenAddress
        ),
        context.client.accounts.getTokenAccount(
          context.accounts.user3.address,
          fixture.tokenAddress
        ),
        context.client.accounts.getTokenAccount(
          context.accounts.operator.address,
          fixture.tokenAddress
        )
      ]);
      const prepared = TransactionBuilder.batchPayment({
        chain_id: chainId,
        nonce: nonceBefore,
        token: fixture.tokenAddress,
        operations,
        created_at: Math.floor(Date.now() / 1000),
        batch_id: `failure-${fixture.tokenSymbol}`
      });
      const signature = await batchFailureSigner.signDigest(
        prepared.signingHash
      );
      const authorized = prepared.authorize(signature);
      const transactionHash = authorized.transactionHash;
      let submission: BatchFailureObservation['submission'];
      let rawSubmission: Record<string, unknown>;

      try {
        const response =
          await context.client.transactions.batchPayment(
            authorized
          );
        submission = 'hash_returned';
        rawSubmission = {
          hash: response.hash,
          local_hash: transactionHash
        };
      } catch (error) {
        const classified =
          classifyBatchFailureSubmission(
            error,
            transactionHash
          );
        submission = classified.submission;
        rawSubmission = classified.raw;
      }

      // Refused at submit: the node answers 422
      // business_transaction_failed rather than accepting
      // the batch and failing it later.
      expect(
        submission,
        `batch submission raw response: ${JSON.stringify(
          rawSubmission
        )}`
      ).to.equal('refused');

      const [receiptResult, finalizedResult] =
        await Promise.all([
          observeForWindow(
            () =>
              context.client.transactions.getReceiptByHash(
                transactionHash
              ),
            {
              attempts:
                BATCH_FAILURE_OBSERVATION_ATTEMPTS,
              intervalMs:
                BATCH_FAILURE_OBSERVATION_INTERVAL_MS,
              isNotFound:
                isConfirmedReadNotFound
            }
          ),
          observeForWindow(
            () =>
              context.client.transactions.getFinalizedByHash(
                transactionHash
              ),
            {
              attempts:
                BATCH_FAILURE_OBSERVATION_ATTEMPTS,
              intervalMs:
                BATCH_FAILURE_OBSERVATION_INTERVAL_MS,
              isNotFound:
                isConfirmedReadNotFound
            }
          )
        ]);
      const receipt: BatchFailureObservation['receipt'] =
        classifyFailedBatchObservation(
          receiptResult,
          'receipt'
        );
      const finalized: BatchFailureObservation['finalized'] =
        classifyFailedBatchObservation(
          finalizedResult,
          'finalized receipt'
        );

      // A refused batch never enters the chain, so it has
      // no receipt at all -- not a failure receipt. The
      // observation window above proves the 422 was not a
      // misreport of a transaction that landed late.
      expect(receipt).to.equal('not_found');
      expect(finalized).to.equal('not_found');

      const [
        senderAfter,
        validRecipientAfter,
        blacklistedRecipientAfter,
        operatorAfter
      ] = await Promise.all([
        context.client.accounts.getTokenAccount(
          context.accounts.batchFailure.address,
          fixture.tokenAddress
        ),
        context.client.accounts.getTokenAccount(
          context.accounts.user1.address,
          fixture.tokenAddress
        ),
        context.client.accounts.getTokenAccount(
          context.accounts.user3.address,
          fixture.tokenAddress
        ),
        context.client.accounts.getTokenAccount(
          context.accounts.operator.address,
          fixture.tokenAddress
        )
      ]);
      expect(BigInt(senderAfter.balance)).to.equal(
        BigInt(senderBefore.balance)
      );
      // The all-or-nothing assertion: operation 0 targets a
      // perfectly valid recipient and still must not apply,
      // because operation 1 is blacklisted. A node that
      // settled the batch operation-by-operation would move
      // this balance and fail here.
      expect(BigInt(validRecipientAfter.balance)).to.equal(
        BigInt(validRecipientBefore.balance)
      );
      expect(
        BigInt(blacklistedRecipientAfter.balance)
      ).to.equal(BigInt(blacklistedRecipientBefore.balance));
      expect(BigInt(operatorAfter.balance)).to.equal(
        BigInt(operatorBefore.balance)
      );

      const nodeNonce = (
        await context.client.accounts.getNonce(
          context.accounts.batchFailure.address
        )
      ).nonce;
      const nonceDelta = nodeNonce - nonceBefore;
      // Nothing was admitted, so no nonce was spent. The
      // caller keeps the slot and resubmits a corrected
      // batch at the same nonce -- verified below.
      expect(nonceDelta).to.equal(0);

      const nextPrepared = TransactionBuilder.payment({
        chain_id: chainId,
        nonce: nodeNonce,
        recipient: context.accounts.user1.address,
        value: BATCH_FAILURE_OPERATION_AMOUNT,
        token: fixture.tokenAddress
      });
      const nextSignature =
        await batchFailureSigner.signDigest(
          nextPrepared.signingHash
        );
      const nextAuthorized =
        nextPrepared.authorize(nextSignature);
      let nextResponse: { hash: string } | undefined;
      let blocked:
        | ReturnType<
            typeof classifyNextValidSubmissionError
          >
        | undefined;
      try {
        nextResponse =
          await context.client.transactions.payment(
            nextAuthorized
          );
      } catch (error) {
        blocked = classifyNextValidSubmissionError(
          error,
          nodeNonce,
          nextAuthorized.transactionHash
        );
      }

      // The refusal leaves the account fully usable: the
      // very same nonce still admits a well-formed payment,
      // which is what makes "correct the batch and resubmit"
      // a safe recovery for a caller.
      expect(
        blocked,
        `continuation submission was rejected: ${JSON.stringify(
          blocked?.raw
        )}`
      ).to.equal(undefined);
      if (!nextResponse) {
        throw new Error(
          '[1Money SDK integration]: continuation submission returned no response and no error'
        );
      }
      const nextHash = nextResponse.hash;
      const nextReceipt = await waitForResult(
        () =>
          context.client.transactions.getReceiptByHash(
            nextHash
          ),
        RECEIPT_POLL
      );
      requireSuccessfulReceipt(
        nextReceipt,
        'continuation receipt'
      );
    } finally {
      await cleanupBatchFailureBlacklist(
        fixture.tokenAddress
      );
    }
  });

  it('issues a private token through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.operator.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenIssue({
        chain_id: chainId,
        nonce,
        symbol: generateRandomSymbol('PRV'),
        name: 'Private V2 Integration Token',
        decimals: 6,
        master_authority:
          context.accounts.master.address,
        is_private: true,
        clawback_enabled: false
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        operatorSigner,
        authorized =>
          context.client.tokens.issueToken(
            authorized
          )
      );
    privateTokenAddress = response.token;

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    const metadata = await waitForResult(
      () =>
        context.client.tokens.getTokenMetadata(
          privateTokenAddress
        ),
      STATE_POLL
    );
    expect(metadata.is_private).to.equal(true);
  });

  it('manages a private-token whitelist through v2', async function () {
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenWhitelist({
        chain_id: chainId,
        nonce,
        action: ManageListAction.Add,
        address: context.accounts.user1.address,
        token: privateTokenAddress
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        masterSigner,
        authorized =>
          context.client.tokens.manageWhitelist(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    const metadata = await waitForResult(
      async () => {
        const result =
          await context.client.tokens.getTokenMetadata(
            privateTokenAddress
          );
        if (
          !result.white_list.some(
            address =>
              address.toLowerCase() ===
              context.accounts.user1.address.toLowerCase()
          )
        ) {
          throw new Error(
            'whitelisted account is not visible yet'
          );
        }
        return result;
      },
      STATE_POLL
    );
    expect(
      metadata.white_list.some(
        address =>
          address.toLowerCase() ===
          context.accounts.user1.address.toLowerCase()
      )
    ).to.equal(true);
  });

  it('creates a multisig account through v2', async function () {
    const signers = [
      context.accounts.user1,
      context.accounts.user2
    ].map(account => ({
      public_key: bytesToHex(
        getPublicKey(
          hexToBytes(account.privateKey),
          true
        )
      ),
      weight: 1
    }));
    const threshold = 2;
    const multisigAddress =
      deriveMultisigAddress(signers, threshold);
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.operator.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.createMultisig({
        chain_id: chainId,
        nonce,
        signers,
        threshold
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        operatorSigner,
        authorized =>
          context.client.accounts.createMultisig(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    const transaction = await waitForResult(
      () =>
        context.client.transactions.getByHash(
          response.hash
        ),
      STATE_POLL
    );
    expect(transaction.transaction_type).to.equal(
      'CreateMultiSig'
    );
    if (
      transaction.transaction_type !==
      'CreateMultiSig'
    ) {
      throw new Error(
        'unexpected multisig transaction type'
      );
    }
    expect(
      transaction.data.multisig_address.toLowerCase()
    ).to.equal(multisigAddress.toLowerCase());

    const account = await waitForResult(
      () =>
        context.client.accounts.getNonce(
          multisigAddress
        ),
      STATE_POLL
    );
    expect(account.nonce).to.equal(0);
  });

  // Every v2 operation signs `rlp([payload_fields, memo])`, but only the
  // batch payment above submits a populated memo, and only a short one.
  // These three close that gap end-to-end: the node re-derives the signing
  // hash from the memo bytes it received, so a memo we encode differently
  // fails signature verification instead of round-tripping.
  it('round-trips a maximum-size memo through a v2 payment', async function () {
    // Guard the fixtures themselves -- if they drift off the limit the
    // test silently stops covering the boundary it exists for.
    expect(
      utf8ByteLength(MAX_MEMO_TYPE)
    ).to.equal(128);
    expect(
      utf8ByteLength(MAX_MEMO_FORMAT)
    ).to.equal(64);
    expect(
      utf8ByteLength(MAX_MEMO_DATA)
    ).to.equal(256);

    const memo = {
      type: MAX_MEMO_TYPE,
      format: MAX_MEMO_FORMAT,
      data: MAX_MEMO_DATA
    };
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.user2.address
      )
    ).nonce;
    const prepared = TransactionBuilder.payment(
      {
        chain_id: chainId,
        nonce,
        recipient: context.accounts.user3.address,
        value: '1',
        token: tokenAddress
      },
      { memo }
    );

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        user2Signer,
        authorized =>
          context.client.transactions.payment(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    const transaction = await waitForResult(
      () =>
        context.client.transactions.getByHash(
          response.hash
        ),
      STATE_POLL
    );
    expect(transaction.memo).to.deep.equal(memo);
  });

  it('round-trips a multi-byte UTF-8 memo through a v2 payment', async function () {
    const data = '结算备注：跨境支付 🧾 ¥1,234.56';
    // The whole point of this case: the byte length must exceed the
    // code-point count, or it would not tell byte-counting apart from
    // character-counting on either side of the wire.
    expect(
      utf8ByteLength(data)
    ).to.be.greaterThan([...data].length);

    const memo = {
      type: 'integration/utf8',
      format: 'text/plain',
      data
    };
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.user2.address
      )
    ).nonce;
    const prepared = TransactionBuilder.payment(
      {
        chain_id: chainId,
        nonce,
        recipient: context.accounts.user3.address,
        value: '1',
        token: tokenAddress
      },
      { memo }
    );

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        user2Signer,
        authorized =>
          context.client.transactions.payment(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    const transaction = await waitForResult(
      () =>
        context.client.transactions.getByHash(
          response.hash
        ),
      STATE_POLL
    );
    expect(transaction.memo).to.deep.equal(memo);
  });

  it('round-trips a memo through a v2 token metadata update', async function () {
    // Memo rides on every v2 operation, not only payments and batches.
    // The metadata fields repeat exactly what the update earlier in this
    // suite already set, so re-submitting leaves token state unchanged
    // and the memo is the only thing under test.
    const memo = {
      type: 'integration/metadata',
      format: 'text/plain',
      data: 'memo on a non-payment operation'
    };
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.master.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.tokenMetadata(
        {
          chain_id: chainId,
          nonce,
          name: 'Updated V2 Integration Token',
          uri: 'https://example.com/v2-token.json',
          token: tokenAddress,
          additional_metadata: [
            {
              key: 'suite',
              value: 'v2-lifecycle'
            }
          ]
        },
        { memo }
      );

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        masterSigner,
        authorized =>
          context.client.tokens.updateMetadata(
            authorized
          )
      );

    const receipt = await waitForResult(
      () =>
        context.client.transactions.getReceiptByHash(
          response.hash
        ),
      RECEIPT_POLL
    );
    expect(receipt.success).to.equal(true);

    const transaction = await waitForResult(
      () =>
        context.client.transactions.getByHash(
          response.hash
        ),
      STATE_POLL
    );
    expect(transaction.memo).to.deep.equal(memo);
  });
});
