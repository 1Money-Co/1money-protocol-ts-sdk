import type { SignerAdapter } from '@/signing/core';
import type {
  AuthorizedTxV2,
  PreparedTxV2
} from '@/signing/v2';

export async function authorizeAndSubmitV2<
  TUnsigned,
  TResponse extends { hash: string }
>(
  prepared: PreparedTxV2<TUnsigned>,
  signer: SignerAdapter,
  submit: (
    authorized: AuthorizedTxV2
  ) => PromiseLike<TResponse>
): Promise<{
  authorized: AuthorizedTxV2;
  response: TResponse;
}> {
  const signature = await signer.signDigest(
    prepared.signingHash
  );
  const authorized =
    prepared.authorize(signature);
  const response = await submit(authorized);

  if (
    response.hash.toLowerCase() !==
    authorized.transactionHash.toLowerCase()
  ) {
    throw new Error(
      `[1Money SDK integration]: node returned a different transaction hash: ${response.hash} !== ${authorized.transactionHash}`
    );
  }

  return { authorized, response };
}
