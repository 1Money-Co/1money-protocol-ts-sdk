import { keccak256 } from 'viem';

import {
  encodeRlpPayload,
  rlpValue
} from '@/utils';
import {
  assertAddress,
  assertNonNegativeInteger,
  validateChainAndNonce
} from './validate';

import type { PlpPayload } from '@/utils';
import type { B256Schema } from '@/api/types';
import type {
  BatchPaymentPayload,
  PaymentOperation
} from '@/api/transactions/types';

export type BatchPaymentUnsigned =
  BatchPaymentPayload;

const OPERATIONS_HASH_RE =
  /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_UINT_RE = /^\d+$/;
const U256_MAX =
  (BigInt(1) << BigInt(256)) - BigInt(1);
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;

// `operations_hash`/`batch_id` are declared as optional (`?:`)
// in BatchPaymentPayload, which types `undefined` as "absent" but
// says nothing about `null` -- a shape both JSON and SQL round-trips
// commonly produce for an unset field. Both the encoder
// (batchPaymentPayloadFields) and the wire body
// (batchPaymentWireFields) must agree with this same notion of
// "genuinely present", or a `null` takes the "present" branch in one
// and the "absent" branch in the other and the signed digest no
// longer matches what the node recomputes from the JSON body.
function isPresent<T>(
  value: T | null | undefined
): value is T {
  return value !== undefined && value !== null;
}

function canonicalAmount(
  name: string,
  value: unknown
): bigint {
  if (
    typeof value !== 'string' ||
    !DECIMAL_UINT_RE.test(value)
  ) {
    throw new Error(
      `[1Money SDK]: Invalid ${name}: ${String(value)}`
    );
  }
  const amount = BigInt(value);
  if (amount > U256_MAX) {
    throw new Error(
      `[1Money SDK]: Invalid ${name}: exceeds U256::MAX`
    );
  }
  return amount;
}

function assertCanonicalOperation(
  operation: PaymentOperation,
  index: number
): bigint {
  assertAddress(
    `operations[${index}].recipient`,
    operation.recipient
  );
  return canonicalAmount(
    `operations[${index}].amount`,
    operation.amount
  );
}

function batchOperationsPayload(
  operations: readonly PaymentOperation[]
): PlpPayload {
  return rlpValue.list(
    operations.map((operation, index) => {
      const amount = assertCanonicalOperation(
        operation,
        index
      );
      return rlpValue.list([
        rlpValue.address(
          operation.recipient as `0x${string}`
        ),
        rlpValue.uint(amount)
      ]);
    })
  );
}

export function calculateBatchPaymentOperationsHash(
  operations: readonly PaymentOperation[]
): B256Schema {
  return keccak256(
    encodeRlpPayload(
      batchOperationsPayload(operations)
    )
  ) as B256Schema;
}

export function validateBatchPayment(
  unsigned: BatchPaymentUnsigned
): void {
  if (
    Object.prototype.hasOwnProperty.call(
      unsigned as object,
      'max_fee'
    )
  ) {
    throw new Error(
      '[1Money SDK]: Batch Payment no longer accepts max_fee; call estimateBatchPaymentFee() for an unsigned quote'
    );
  }
  validateChainAndNonce(unsigned);
  assertAddress('token', unsigned.token);
  assertNonNegativeInteger(
    'created_at',
    unsigned.created_at
  );
  if (!Array.isArray(unsigned.operations)) {
    throw new Error(
      '[1Money SDK]: Invalid operations: must be an array'
    );
  }
  if (unsigned.operations.length === 0) {
    throw new Error(
      '[1Money SDK]: Invalid operations: must not be empty'
    );
  }
  let total = BigInt(0);
  unsigned.operations.forEach((operation, index) => {
    const amount = assertCanonicalOperation(
      operation,
      index
    );
    if (
      operation.recipient.toLowerCase() ===
      ZERO_ADDRESS
    ) {
      throw new Error(
        `[1Money SDK]: Invalid operations[${index}].recipient: zero address`
      );
    }
    if (amount === BigInt(0)) {
      throw new Error(
        `[1Money SDK]: Invalid operations[${index}].amount: must be greater than zero`
      );
    }
    total += amount;
    if (total > U256_MAX) {
      throw new Error(
        '[1Money SDK]: Invalid operations: total exceeds U256::MAX'
      );
    }
  });
  if (
    isPresent(unsigned.operations_hash) &&
    !OPERATIONS_HASH_RE.test(
      unsigned.operations_hash
    )
  ) {
    throw new Error(
      `[1Money SDK]: Invalid operations_hash: must be 32-byte 0x-hex, got ${unsigned.operations_hash}`
    );
  }
  const canonicalHash =
    calculateBatchPaymentOperationsHash(
      unsigned.operations
    );
  if (
    isPresent(unsigned.operations_hash) &&
    unsigned.operations_hash.toLowerCase() !==
      canonicalHash.toLowerCase()
  ) {
    throw new Error(
      `[1Money SDK]: Invalid operations_hash: supplied ${unsigned.operations_hash}, canonical ${canonicalHash}`
    );
  }
  if (
    isPresent(unsigned.batch_id) &&
    typeof unsigned.batch_id !== 'string'
  ) {
    throw new Error(
      `[1Money SDK]: Invalid batch_id: must be a string, got ${String(unsigned.batch_id)}`
    );
  }
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
    batchOperationsPayload(unsigned.operations),
    rlpValue.uint(unsigned.created_at)
  ];

  const hasHash = isPresent(
    unsigned.operations_hash
  );
  const hasBatchId = isPresent(
    unsigned.batch_id
  );

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
    // Project the signed shape exactly: untyped callers may supply
    // extra operation keys that were not encoded and must not reach
    // the wire.
    operations: unsigned.operations.map(op => ({
      recipient: op.recipient,
      amount: op.amount
    })),
    created_at: unsigned.created_at
  };
  if (isPresent(unsigned.operations_hash)) {
    body.operations_hash =
      unsigned.operations_hash;
  }
  if (isPresent(unsigned.batch_id)) {
    body.batch_id = unsigned.batch_id;
  }
  return body;
}
