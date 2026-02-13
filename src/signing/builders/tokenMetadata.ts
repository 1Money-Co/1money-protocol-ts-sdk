import { createPreparedTx } from '../core';
import {
  encodeRlpPayload,
  rlpValue,
} from '@/utils';

import type { TokenMetadataPayload } from '@/api/tokens/types';

export type TokenMetadataUnsigned = Omit<
  TokenMetadataPayload,
  'signature'
>;

export function prepareTokenMetadataTx(
  unsigned: TokenMetadataUnsigned
) {
  const additionalMetadataRlp = unsigned.additional_metadata.map(
    item =>
      rlpValue.list([
        rlpValue.string(item.key),
        rlpValue.string(item.value),
      ])
  );

  const rlpBytes = encodeRlpPayload(
    rlpValue.list([
      rlpValue.uint(unsigned.chain_id),
      rlpValue.uint(unsigned.nonce),
      rlpValue.string(unsigned.name),
      rlpValue.string(unsigned.uri),
      rlpValue.address(unsigned.token as `0x${string}`),
      rlpValue.list(additionalMetadataRlp),
    ])
  );

  return createPreparedTx<
    TokenMetadataUnsigned,
    TokenMetadataPayload
  >({
    kind: 'tokenMetadata',
    unsigned,
    rlpBytes,
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
