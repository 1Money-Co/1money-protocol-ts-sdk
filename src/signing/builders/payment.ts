import {
  encodeRlpPayload,
  rlpValue,
} from '@/utils';
import { createPreparedTx } from '../core';
import {
  validateChainAndNonce,
  validateRecipientValueToken,
} from './validate';

import type { PaymentPayload } from '@/api/transactions/types';

export type PaymentUnsigned = Omit<
  PaymentPayload,
  'signature'
>;

export function preparePaymentTx(
  unsigned: PaymentUnsigned
) {
  validateChainAndNonce(unsigned);
  validateRecipientValueToken(unsigned);

  const rlpBytes = encodeRlpPayload(
    rlpValue.list([
      rlpValue.uint(unsigned.chain_id),
      rlpValue.uint(unsigned.nonce),
      rlpValue.address(
        unsigned.recipient as `0x${string}`
      ),
      rlpValue.uint(unsigned.value),
      rlpValue.address(
        unsigned.token as `0x${string}`
      ),
    ])
  );

  return createPreparedTx<
    PaymentUnsigned,
    PaymentPayload
  >({
    kind: 'payment',
    unsigned,
    rlpBytes,
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
