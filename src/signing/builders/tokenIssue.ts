import { rlpValue } from '@/utils';
import { buildTx } from './buildTx';
import {
  assertAddress,
  assertNonNegativeInteger,
  validateChainAndNonce,
} from './validate';

import type { TokenIssuePayload } from '@/api/tokens/types';

export type TokenIssueUnsigned = Omit<TokenIssuePayload, 'signature'>;

export function prepareTokenIssueTx(unsigned: TokenIssueUnsigned) {
  validateChainAndNonce(unsigned);
  assertNonNegativeInteger('decimals', unsigned.decimals);
  assertAddress('master_authority', unsigned.master_authority);

  const clawbackEnabled = unsigned.clawback_enabled ?? true;
  const unsignedWithDefaults: TokenIssueUnsigned = {
    ...unsigned,
    clawback_enabled: clawbackEnabled,
  };

  return buildTx<TokenIssueUnsigned, TokenIssuePayload>({
    kind: 'tokenIssue',
    unsigned: unsignedWithDefaults,
    payloadFields: [
      rlpValue.string(unsignedWithDefaults.symbol),
      rlpValue.string(unsignedWithDefaults.name),
      rlpValue.uint(unsignedWithDefaults.decimals),
      rlpValue.address(unsignedWithDefaults.master_authority as `0x${string}`),
      rlpValue.bool(unsignedWithDefaults.is_private),
      rlpValue.bool(clawbackEnabled),
    ],
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
