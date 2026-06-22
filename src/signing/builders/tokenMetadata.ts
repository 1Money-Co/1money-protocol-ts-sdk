import { rlpValue } from '@/utils';
import { buildTx } from './buildTx';
import {
  assertAddress,
  validateChainAndNonce,
} from './validate';

import type { TokenMetadataPayload } from '@/api/tokens/types';

export type TokenMetadataUnsigned = Omit<TokenMetadataPayload, 'signature'>;

export function prepareTokenMetadataTx(unsigned: TokenMetadataUnsigned) {
  validateChainAndNonce(unsigned);
  assertAddress('token', unsigned.token);

  const additionalMetadataRlp = unsigned.additional_metadata.map((item) =>
    rlpValue.list([rlpValue.string(item.key), rlpValue.string(item.value)])
  );

  return buildTx<TokenMetadataUnsigned, TokenMetadataPayload>({
    kind: 'tokenMetadata',
    unsigned,
    payloadFields: [
      rlpValue.string(unsigned.name),
      rlpValue.string(unsigned.uri),
      rlpValue.address(unsigned.token as `0x${string}`),
      rlpValue.list(additionalMetadataRlp),
    ],
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
