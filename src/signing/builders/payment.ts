import { rlpValue, type PlpPayload } from '@/utils';
import { buildTx } from './buildTx';
import {
  validateChainAndNonce,
  validateRecipientValueToken,
} from './validate';

import type { PaymentPayload } from '@/api/transactions/types';

export type PaymentUnsigned = Omit<PaymentPayload, 'signature'>;

export function validatePayment(unsigned: PaymentUnsigned) {
  validateChainAndNonce(unsigned);
  validateRecipientValueToken(unsigned);
}

export function paymentPayloadFields(
  unsigned: PaymentUnsigned
): PlpPayload[] {
  return [
    rlpValue.address(unsigned.recipient as `0x${string}`),
    rlpValue.uint(unsigned.value),
    rlpValue.address(unsigned.token as `0x${string}`),
  ];
}

export function preparePaymentTx(unsigned: PaymentUnsigned) {
  validatePayment(unsigned);

  return buildTx<PaymentUnsigned, PaymentPayload>({
    kind: 'payment',
    unsigned,
    payloadFields: paymentPayloadFields(unsigned),
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
