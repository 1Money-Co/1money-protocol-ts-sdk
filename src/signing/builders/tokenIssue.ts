import { rlpValue, type PlpPayload } from '@/utils';
import { buildTx } from './buildTx';
import {
  assertAddress,
  assertNonNegativeInteger,
  validateChainAndNonce,
} from './validate';

import type { TokenIssuePayload } from '@/api/tokens/types';

export type TokenIssueUnsigned = Omit<TokenIssuePayload, 'signature'>;

export function validateTokenIssue(unsigned: TokenIssueUnsigned) {
  validateChainAndNonce(unsigned);
  assertNonNegativeInteger('decimals', unsigned.decimals);
  assertAddress('master_authority', unsigned.master_authority);
}

export function tokenIssuePayloadFields(
  unsigned: TokenIssueUnsigned
): PlpPayload[] {
  return [
    rlpValue.string(unsigned.symbol),
    rlpValue.string(unsigned.name),
    rlpValue.uint(unsigned.decimals),
    rlpValue.address(unsigned.master_authority as `0x${string}`),
    rlpValue.bool(unsigned.is_private),
    rlpValue.bool(unsigned.clawback_enabled ?? true),
  ];
}

export function prepareTokenIssueTx(unsigned: TokenIssueUnsigned) {
  validateTokenIssue(unsigned);

  const clawbackEnabled = unsigned.clawback_enabled ?? true;
  const unsignedWithDefaults: TokenIssueUnsigned = {
    ...unsigned,
    clawback_enabled: clawbackEnabled,
  };

  return buildTx<TokenIssueUnsigned, TokenIssuePayload>({
    kind: 'tokenIssue',
    unsigned: unsignedWithDefaults,
    payloadFields: tokenIssuePayloadFields(unsignedWithDefaults),
    toRequest: (payload, signature) => ({
      ...payload,
      signature,
    }),
  });
}
