import { rlpValue } from '@/utils';
import { buildTx } from './buildTx';
import {
  validateChainAndNonce,
  validateRecipientValueToken,
} from './validate';

import type { PaymentPayload } from '@/api/transactions/types';

export type PaymentUnsigned = Omit<PaymentPayload, 'signature'>;

export function preparePaymentTx(unsigned: PaymentUnsigned) {
  validateChainAndNonce(unsigned);
  validateRecipientValueToken(unsigned);

  return buildTx<PaymentUnsigned, PaymentPayload>({
    kind: 'payment',
    unsigned,
    payloadFields: [
      rlpValue.address(unsigned.recipient as `0x${string}`),
      rlpValue.uint(unsigned.value),
      rlpValue.address(unsigned.token as `0x${string}`),
    ],
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
