import { rlpValue, type PlpPayload } from '@/utils';
import { buildTx } from './buildTx';
import { assertAddress, validateChainAndNonce } from './validate';

import type { TokenMetadataPayload } from '@/api/tokens/types';

export type TokenMetadataUnsigned = Omit<TokenMetadataPayload, 'signature'>;

export function validateTokenMetadata(unsigned: TokenMetadataUnsigned) {
  validateChainAndNonce(unsigned);
  assertAddress('token', unsigned.token);
}

export function tokenMetadataPayloadFields(
  unsigned: TokenMetadataUnsigned
): PlpPayload[] {
  const additionalMetadataRlp = unsigned.additional_metadata.map(item =>
    rlpValue.list([rlpValue.string(item.key), rlpValue.string(item.value)])
  );

  return [
    rlpValue.string(unsigned.name),
    rlpValue.string(unsigned.uri),
    rlpValue.address(unsigned.token as `0x${string}`),
    rlpValue.list(additionalMetadataRlp),
  ];
}

export function prepareTokenMetadataTx(unsigned: TokenMetadataUnsigned) {
  validateTokenMetadata(unsigned);

  return buildTx<TokenMetadataUnsigned, TokenMetadataPayload>({
    kind: 'tokenMetadata',
    unsigned,
    payloadFields: tokenMetadataPayloadFields(unsigned),
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
