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
  generateRandomSymbol,
  isConfirmedReadNotFound,
  observeForWindow,
  requireSuccessfulReceipt,
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

interface BatchPaymentFixture {
  tokenAddress: string;
  tokenSymbol: string;
}

export interface BatchFailureObservation {
  submission:
    | 'hash_returned'
    | 'refused'
    | 'outcome_unknown';
  receipt: 'not_found' | 'failure_receipt';
  finalized: 'not_found' | 'failure_receipt';
  nonce_delta: 0 | 1;
  next_valid_transaction:
    | 'same_nonce_accepted'
    | 'next_nonce_accepted'
    | 'blocked';
  balances_unchanged: true;
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

        const issueReceipt = await waitForResult(
          () =>
            context.client.transactions.getReceiptByHash(
              issueResponse.hash
            ),
          { intervalMs: 250 }
        );
        expect(issueReceipt.success).to.equal(true);

        await waitForResult(
          () =>
            context.client.tokens.getTokenMetadata(
              fixtureTokenAddress
            ),
          { intervalMs: 250 }
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
            value: BATCH_PAYMENT_FIXTURE_BALANCE
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
          { intervalMs: 250 }
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
          { intervalMs: 250 }
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
            { intervalMs: 250 }
          );
          expect(receipt.success).to.equal(true);
        };

        await mintTo(
          context.accounts.user2.address,
          BATCH_PAYMENT_FIXTURE_BALANCE
        );
        await mintTo(
          context.accounts.user1.address,
          BATCH_PAYMENT_RECIPIENT_BALANCE
        );
        await mintTo(
          context.accounts.user3.address,
          BATCH_PAYMENT_RECIPIENT_BALANCE
        );
        await mintTo(
          context.accounts.operator.address,
          BATCH_PAYMENT_RECIPIENT_BALANCE
        );

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
          { intervalMs: 250 }
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
          { intervalMs: 250 }
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
          { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
    );
  }

  async function cleanupBatchFailureBlacklist(
    token: string
  ): Promise<void> {
    const metadata =
      await context.client.tokens.getTokenMetadata(token);
    if (
      !isBlacklisted(
        metadata.black_list,
        context.accounts.user3.address
      )
    ) {
      return;
    }
    await setBatchFailureBlacklist(
      token,
      ManageListAction.Remove
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
      { intervalMs: 250 }
    );
    expect(receipt.success).to.equal(true);

    const transaction = await waitForResult(
      () =>
        context.client.transactions.getByHash(
          issueHash
        ),
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
    );
  });

  it('probes batch payment atomic failure', async function () {
    this.timeout(context.config.timeout);
    if (
      process.env.BATCH_FAILURE_PROBE_MODE !==
      'record'
    ) {
      this.skip();
    }

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
      if (nonceDelta !== 0 && nonceDelta !== 1) {
        throw new Error(
          `[1Money SDK integration]: expected failed batch nonce delta 0 or 1, received ${nonceDelta}`
        );
      }

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

      let nextValidTransaction:
        BatchFailureObservation['next_valid_transaction'];
      let rawNextValidTransaction: Record<string, unknown>;
      if (blocked) {
        nextValidTransaction =
          blocked.nextValidTransaction;
        rawNextValidTransaction = blocked.raw;
      } else {
        if (!nextResponse) {
          throw new Error(
            '[1Money SDK integration]: continuation submission returned no response and no error'
          );
        }
        const nextReceipt = await waitForResult(
          () =>
            context.client.transactions.getReceiptByHash(
              nextResponse.hash
            ),
          { intervalMs: 250 }
        );
        requireSuccessfulReceipt(
          nextReceipt,
          'continuation receipt'
        );
        nextValidTransaction =
          nonceDelta === 0
            ? 'same_nonce_accepted'
            : 'next_nonce_accepted';
        rawNextValidTransaction = {
          hash: nextResponse.hash,
          nonce: nodeNonce
        };
      }

      const observation: BatchFailureObservation = {
        submission,
        receipt,
        finalized,
        nonce_delta: nonceDelta,
        next_valid_transaction:
          nextValidTransaction,
        balances_unchanged: true
      };
      console.log('BATCH_FAILURE_DIAGNOSTIC', {
        submission: rawSubmission,
        receipt:
          receiptResult.state === 'found'
            ? receiptResult.value
            : receiptResult.error,
        finalized:
          finalizedResult.state === 'found'
            ? finalizedResult.value
            : finalizedResult.error,
        next_valid_transaction:
          rawNextValidTransaction
      });
      console.log('BATCH_FAILURE_OBSERVATION_BEGIN');
      console.log(JSON.stringify(observation, null, 2));
      console.log('BATCH_FAILURE_OBSERVATION_END');
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
      { intervalMs: 250 }
    );
    expect(receipt.success).to.equal(true);

    const metadata = await waitForResult(
      () =>
        context.client.tokens.getTokenMetadata(
          privateTokenAddress
        ),
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
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
      { intervalMs: 250 }
    );
    expect(receipt.success).to.equal(true);

    const transaction = await waitForResult(
      () =>
        context.client.transactions.getByHash(
          response.hash
        ),
      { intervalMs: 250 }
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
      { intervalMs: 250 }
    );
    expect(account.nonce).to.equal(0);
  });
});
