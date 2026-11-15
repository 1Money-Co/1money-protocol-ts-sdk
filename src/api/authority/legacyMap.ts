import {
  AuthorityAction,
  AuthorityType,
  ManageListAction,
  PauseAction
} from '../tokens/types';

import type {
  AuthorityListAction,
  AuthorityListKind,
  AuthorityOperation,
  AuthorityRole,
  SettledAuthorityPayload
} from '../tokens/types';
import type { OperationUnsignedMap } from '@/signing/v2';

/**
 * An authority operation in the legacy payload a caller already
 * builds. In the settled mode it is signed again as the new
 * envelope at the same chain and nonce.
 */
export type LegacyAuthorityOperation =
  | { kind: 'mint'; payload: OperationUnsignedMap['tokenMint'] }
  /** Grant or revoke. */
  | {
      kind: 'authority';
      payload: OperationUnsignedMap['tokenAuthority'];
    }
  | {
      kind: 'blacklist';
      payload: OperationUnsignedMap['tokenBlacklist'];
    }
  | {
      kind: 'whitelist';
      payload: OperationUnsignedMap['tokenWhitelist'];
    }
  | { kind: 'pause'; payload: OperationUnsignedMap['tokenPause'] }
  | {
      kind: 'metadata';
      payload: OperationUnsignedMap['tokenMetadata'];
    };

const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000';

const DELEGATED_ROLES: Partial<
  Record<AuthorityType, AuthorityRole>
> = {
  [AuthorityType.Pause]: 'pause',
  [AuthorityType.ManageList]: 'manage_list',
  [AuthorityType.UpdateMetadata]: 'update_metadata',
  [AuthorityType.Bridge]: 'bridge',
  [AuthorityType.Clawback]: 'clawback'
};

/** The list operation decides the list from the token's privacy. */
export function isListOperation(
  legacy: LegacyAuthorityOperation
): boolean {
  return (
    legacy.kind === 'blacklist' || legacy.kind === 'whitelist'
  );
}

// The legacy list envelope's effect follows the token's privacy:
// on a private token a freeze is a whitelist remove, and admission
// refuses a blacklist operation on a private token.
function settledList(
  tokenIsPrivate: boolean,
  freeze: boolean,
  account: string
): AuthorityOperation {
  const list: AuthorityListKind = tokenIsPrivate
    ? 'whitelist'
    : 'blacklist';
  const action: AuthorityListAction =
    tokenIsPrivate === freeze ? 'remove' : 'add';
  return { type: 'list', list, action, account };
}

// A legacy grant of MintBurnTokens sets the minter's absolute
// allowance, and a legacy grant of MasterMintBurn replaces the
// master minter, or clears it when it names the zero address.
function settledAuthority(
  payload: OperationUnsignedMap['tokenAuthority']
): AuthorityOperation {
  const account = payload.authority_address;
  const grant = payload.action === AuthorityAction.Grant;
  switch (payload.authority_type) {
    case AuthorityType.MasterMint:
      return grant && account.toLowerCase() !== ZERO_ADDRESS
        ? { type: 'rotate_master_mint_burn', account }
        : { type: 'revoke_master_mint_burn' };
    case AuthorityType.MintBurnTokens:
      return grant
        ? {
            type: 'set_minter_allowance',
            minter: account,
            allowance: payload.value ?? '0'
          }
        : { type: 'revoke_minter', minter: account };
  }
  const role = DELEGATED_ROLES[payload.authority_type];
  if (role === undefined) {
    throw new Error(
      `[1Money SDK]: Invalid authority_type: ${String(payload.authority_type)}`
    );
  }
  return {
    type: grant ? 'grant_role' : 'revoke_role',
    role,
    account
  };
}

/** The settled operation with the legacy operation's effect. */
export function settledOperationOf(
  legacy: LegacyAuthorityOperation,
  tokenIsPrivate: boolean
): AuthorityOperation {
  switch (legacy.kind) {
    case 'mint':
      return {
        type: 'mint',
        recipient: legacy.payload.recipient,
        value: legacy.payload.value
      };
    case 'authority':
      return settledAuthority(legacy.payload);
    case 'blacklist':
      return settledList(
        tokenIsPrivate,
        legacy.payload.action === ManageListAction.Add,
        legacy.payload.address
      );
    case 'whitelist':
      return settledList(
        tokenIsPrivate,
        legacy.payload.action === ManageListAction.Remove,
        legacy.payload.address
      );
    case 'pause':
      return {
        type:
          legacy.payload.action === PauseAction.Pause
            ? 'pause'
            : 'unpause'
      };
    case 'metadata':
      return {
        type: 'update_metadata',
        name: legacy.payload.name,
        uri: legacy.payload.uri,
        additional_metadata:
          legacy.payload.additional_metadata.map(pair => ({
            ...pair
          }))
      };
  }
}

/** The new envelope at the legacy payload's chain and nonce. */
export function settledPayloadOf(
  legacy: LegacyAuthorityOperation,
  tokenIsPrivate: boolean,
  referenceCheckpoint: number
): SettledAuthorityPayload {
  const { chain_id, nonce, token } = legacy.payload;
  return {
    chain_id,
    nonce,
    token,
    reference_checkpoint: referenceCheckpoint,
    operation: settledOperationOf(legacy, tokenIsPrivate)
  };
}
