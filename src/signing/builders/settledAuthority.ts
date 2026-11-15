import { rlpValue, type PlpPayload } from '@/utils';
import {
  assertAddress,
  assertNonNegativeInteger,
  assertUintString,
  validateChainAndNonce
} from './validate';

import type {
  AuthorityListAction,
  AuthorityListKind,
  AuthorityOperation,
  AuthorityRole,
  SettledAuthorityPayload
} from '@/api/tokens/types';

export type SettledAuthorityUnsigned =
  SettledAuthorityPayload;

// The signed form names each operation, role, list and action by
// the PascalCase string of the canonical payload, while the REST
// body uses snake_case tags.
// https://github.com/1Money-Co/l1client/blob/main/docs/specs/native-v2-signing-spec.md
const OPERATION_NAMES: Record<
  AuthorityOperation['type'],
  string
> = {
  pause: 'Pause',
  unpause: 'Unpause',
  list: 'List',
  update_metadata: 'UpdateMetadata',
  grant_role: 'GrantRole',
  revoke_role: 'RevokeRole',
  set_minter_allowance: 'SetMinterAllowance',
  revoke_minter: 'RevokeMinter',
  rotate_master_mint_burn: 'RotateMasterMintBurn',
  revoke_master_mint_burn: 'RevokeMasterMintBurn',
  mint: 'Mint'
};

const ROLE_NAMES: Record<AuthorityRole, string> = {
  pause: 'Pause',
  manage_list: 'ManageList',
  update_metadata: 'UpdateMetadata',
  bridge: 'Bridge',
  clawback: 'Clawback'
};

const LIST_NAMES: Record<AuthorityListKind, string> = {
  blacklist: 'Blacklist',
  whitelist: 'Whitelist'
};

const LIST_ACTION_NAMES: Record<
  AuthorityListAction,
  string
> = {
  add: 'Add',
  remove: 'Remove'
};

function fail(field: string, value: unknown): never {
  throw new Error(
    `[1Money SDK]: Invalid ${field}: ${String(value)}`
  );
}

function assertKey<T extends string>(
  field: string,
  names: Record<T, string>,
  value: unknown
): asserts value is T {
  if (
    typeof value !== 'string' ||
    !Object.prototype.hasOwnProperty.call(names, value)
  ) {
    fail(field, value);
  }
}

function validateOperation(
  operation: AuthorityOperation
): void {
  if (typeof operation !== 'object' || operation === null) {
    fail('operation', operation);
  }
  assertKey('operation.type', OPERATION_NAMES, operation.type);
  switch (operation.type) {
    case 'pause':
    case 'unpause':
    case 'revoke_master_mint_burn':
      return;
    case 'list':
      assertKey('operation.list', LIST_NAMES, operation.list);
      assertKey(
        'operation.action',
        LIST_ACTION_NAMES,
        operation.action
      );
      assertAddress('operation.account', operation.account);
      return;
    case 'update_metadata':
      if (
        typeof operation.name !== 'string' ||
        typeof operation.uri !== 'string' ||
        !Array.isArray(operation.additional_metadata)
      ) {
        fail('operation', JSON.stringify(operation));
      }
      return;
    case 'grant_role':
    case 'revoke_role':
      assertKey('operation.role', ROLE_NAMES, operation.role);
      assertAddress('operation.account', operation.account);
      return;
    case 'set_minter_allowance':
      assertAddress('operation.minter', operation.minter);
      assertUintString(
        'operation.allowance',
        operation.allowance
      );
      return;
    case 'revoke_minter':
      assertAddress('operation.minter', operation.minter);
      return;
    case 'rotate_master_mint_burn':
      assertAddress('operation.account', operation.account);
      return;
    case 'mint':
      assertAddress('operation.recipient', operation.recipient);
      assertUintString('operation.value', operation.value);
      return;
  }
}

export function validateSettledAuthority(
  unsigned: SettledAuthorityUnsigned
): void {
  validateChainAndNonce(unsigned);
  assertAddress('token', unsigned.token);
  assertNonNegativeInteger(
    'reference_checkpoint',
    unsigned.reference_checkpoint
  );
  validateOperation(unsigned.operation);
}

function address(value: string): PlpPayload {
  return rlpValue.address(value as `0x${string}`);
}

function operationFields(
  operation: AuthorityOperation
): PlpPayload[] {
  switch (operation.type) {
    case 'pause':
    case 'unpause':
    case 'revoke_master_mint_burn':
      return [];
    case 'list':
      return [
        rlpValue.string(LIST_NAMES[operation.list]),
        rlpValue.string(LIST_ACTION_NAMES[operation.action]),
        address(operation.account)
      ];
    case 'update_metadata':
      return [
        rlpValue.string(operation.name),
        rlpValue.string(operation.uri),
        rlpValue.list(
          operation.additional_metadata.map(pair =>
            rlpValue.list([
              rlpValue.string(pair.key),
              rlpValue.string(pair.value)
            ])
          )
        )
      ];
    case 'grant_role':
    case 'revoke_role':
      return [
        rlpValue.string(ROLE_NAMES[operation.role]),
        address(operation.account)
      ];
    case 'set_minter_allowance':
      return [
        address(operation.minter),
        rlpValue.uint(operation.allowance)
      ];
    case 'revoke_minter':
      return [address(operation.minter)];
    case 'rotate_master_mint_burn':
      return [address(operation.account)];
    case 'mint':
      return [
        address(operation.recipient),
        rlpValue.uint(operation.value)
      ];
  }
}

export function settledAuthorityPayloadFields(
  unsigned: SettledAuthorityUnsigned
): PlpPayload[] {
  const { operation } = unsigned;
  return [
    address(unsigned.token),
    rlpValue.uint(unsigned.reference_checkpoint),
    rlpValue.list([
      rlpValue.string(OPERATION_NAMES[operation.type]),
      ...operationFields(operation)
    ])
  ];
}
