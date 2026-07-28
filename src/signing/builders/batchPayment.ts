import { rlpValue } from '@/utils';
import {
  assertAddress,
  assertNonNegativeInteger,
  assertUintString,
  validateChainAndNonce
} from './validate';

import type { PlpPayload } from '@/utils';
import type { BatchPaymentPayload } from '@/api/transactions/types';

export type BatchPaymentUnsigned = Omit<
  BatchPaymentPayload,
  'signature'
>;

export function validateBatchPayment(
  unsigned: BatchPaymentUnsigned
): void {
  validateChainAndNonce(unsigned);
  assertAddress('token', unsigned.token);
  assertUintString('max_fee', unsigned.max_fee);
  assertNonNegativeInteger(
    'created_at',
    unsigned.created_at
  );
  if (unsigned.operations.length === 0) {
    throw new Error(
      '[1Money SDK]: Invalid operations: must not be empty'
    );
  }
  unsigned.operations.forEach((op, index) => {
    assertAddress(
      `operations[${index}].recipient`,
      op.recipient
    );
    assertUintString(
      `operations[${index}].amount`,
      op.amount
    );
  });
}

// Trailing optional fields follow native-v2-signing-spec section
// 4.3: both absent means the list simply ends; an absent field
// followed by a present one is encoded as the empty-string
// placeholder so positional decoding still works.
export function batchPaymentPayloadFields(
  unsigned: BatchPaymentUnsigned
): PlpPayload[] {
  const fields: PlpPayload[] = [
    rlpValue.address(
      unsigned.token as `0x${string}`
    ),
    rlpValue.list(
      unsigned.operations.map(op =>
        rlpValue.list([
          rlpValue.address(
            op.recipient as `0x${string}`
          ),
          rlpValue.uint(op.amount)
        ])
      )
    ),
    rlpValue.uint(unsigned.max_fee),
    rlpValue.uint(unsigned.created_at)
  ];

  const hasHash =
    unsigned.operations_hash !== undefined;
  const hasBatchId =
    unsigned.batch_id !== undefined;

  if (hasHash) {
    fields.push(
      rlpValue.hex(
        unsigned.operations_hash as `0x${string}`
      )
    );
  } else if (hasBatchId) {
    fields.push(rlpValue.string(''));
  }

  if (hasBatchId) {
    fields.push(
      rlpValue.string(
        unsigned.batch_id as string
      )
    );
  }

  return fields;
}

export function batchPaymentWireFields(
  unsigned: BatchPaymentUnsigned
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    chain_id: unsigned.chain_id,
    nonce: unsigned.nonce,
    token: unsigned.token,
    // Copied, not aliased -- see tokenMetadataWireFields.
    operations: unsigned.operations.map(op => ({
      ...op
    })),
    max_fee: unsigned.max_fee,
    created_at: unsigned.created_at
  };
  if (unsigned.operations_hash !== undefined) {
    body.operations_hash =
      unsigned.operations_hash;
  }
  if (unsigned.batch_id !== undefined) {
    body.batch_id = unsigned.batch_id;
  }
  return body;
}
