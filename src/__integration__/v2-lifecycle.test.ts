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
  generateRandomSymbol,
  waitForResult
} from './helpers';
import { authorizeAndSubmitV2 } from './v2';

type Context = ReturnType<
  typeof getIntegrationContext
>;
type PrivateKeySigner = ReturnType<
  typeof createPrivateKeySigner
>;

describe('native v2 lifecycle integration', function () {
  let context: Context;
  let operatorSigner: PrivateKeySigner;
  let masterSigner: PrivateKeySigner;
  let user1Signer: PrivateKeySigner;
  let user2Signer: PrivateKeySigner;
  let user3Signer: PrivateKeySigner;
  let chainId: number;
  let tokenAddress: string;
  let privateTokenAddress: string;
  let issueHash: string;
  let tokenSymbol: string;

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
  });

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
    const nonce = (
      await context.client.accounts.getNonce(
        context.accounts.user2.address
      )
    ).nonce;
    const prepared =
      TransactionBuilder.batchPayment({
        chain_id: chainId,
        nonce,
        token: tokenAddress,
        operations: [
          {
            recipient:
              context.accounts.user1.address,
            amount: '10'
          },
          {
            recipient:
              context.accounts.user3.address,
            amount: '5'
          }
        ],
        max_fee: '1000000',
        created_at: Math.floor(Date.now() / 1000),
        batch_id: `v2-${tokenSymbol}`
      });

    const { response } =
      await authorizeAndSubmitV2(
        prepared,
        user2Signer,
        authorized =>
          context.client.transactions.batchPayment(
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
        const firstRecipient =
          await context.client.accounts.getTokenAccount(
            context.accounts.user1.address,
            tokenAddress
          );
        const secondRecipient =
          await context.client.accounts.getTokenAccount(
            context.accounts.user3.address,
            tokenAddress
          );
        if (
          sender.balance !== '964' ||
          firstRecipient.balance !== '10' ||
          secondRecipient.balance !== '70'
        ) {
          throw new Error(
            `expected balances 964/10/70, received ${sender.balance}/${firstRecipient.balance}/${secondRecipient.balance}`
          );
        }
        return {
          sender,
          firstRecipient,
          secondRecipient
        };
      },
      { intervalMs: 250 }
    );
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
