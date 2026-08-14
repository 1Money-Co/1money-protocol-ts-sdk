import { rlpValue, type PlpPayload } from '@/utils';
import { buildTx } from './buildTx';
import {
  assertAddress,
  assertOptionalUintString,
  validateChainAndNonce,
} from './validate';

import type { TokenAuthorityPayload } from '@/api/tokens/types';

export type TokenAuthorityUnsigned = Omit<TokenAuthorityPayload, 'signature'>;

export function validateTokenAuthority(unsigned: TokenAuthorityUnsigned) {
  validateChainAndNonce(unsigned);
  assertAddress('authority_address', unsigned.authority_address);
  assertAddress('token', unsigned.token);
  assertOptionalUintString('value', unsigned.value);
}

export function tokenAuthorityPayloadFields(
  unsigned: TokenAuthorityUnsigned
): PlpPayload[] {
  return [
    rlpValue.string(unsigned.action),
    rlpValue.string(unsigned.authority_type),
    rlpValue.address(unsigned.authority_address as `0x${string}`),
    rlpValue.address(unsigned.token as `0x${string}`),
    // Rust `TokenAuthorityPayload.value` is a non-optional U256
    // defaulting to 0, so the field is always encoded.
    rlpValue.uint(unsigned.value ?? '0'),
  ];
}

export function prepareTokenAuthorityTx(unsigned: TokenAuthorityUnsigned) {
  validateTokenAuthority(unsigned);

  return buildTx<TokenAuthorityUnsigned, TokenAuthorityPayload>({
    kind: 'tokenAuthority',
    unsigned,
    payloadFields: tokenAuthorityPayloadFields(unsigned),
    toRequest: (payload, signature) => ({
      ...payload,
      // Rust `TokenAuthorityPayload.value` is a non-optional U256
      // with no `#[serde(default)]`, so an omitted field 400s even
      // though the signed bytes above always encode value = 0 -- the
      // wire body must default it the same way the signature does.
      value: payload.value ?? '0',
      signature,
    }),
  });
}
