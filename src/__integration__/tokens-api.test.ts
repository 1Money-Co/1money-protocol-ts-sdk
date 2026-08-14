import { expect } from 'chai';
import 'mocha';

import {
  AuthorityType,
  ManageListAction,
  PauseAction,
} from '@/api/tokens/types';

import { getIntegrationContext } from './context';

type Context = ReturnType<
  typeof getIntegrationContext
>;

describe('tokens API integration', function () {
  let context: Context;

  before(function () {
    context = getIntegrationContext();
    if (!context.config.enabled) {
      this.skip();
    }
  });

  it('exposes token reads and all v2 writes', function () {
    const { tokens } = context.client;

    expect(tokens.getTokenMetadata).to.be.a(
      'function'
    );
    [
      tokens.issueToken,
      tokens.mintToken,
      tokens.burnToken,
      tokens.clawbackToken,
      tokens.grantAuthority,
      tokens.manageBlacklist,
      tokens.manageWhitelist,
      tokens.pauseToken,
      tokens.updateMetadata,
      tokens.bridgeAndMint,
      tokens.burnAndBridge
    ].forEach(method => {
      expect(method).to.be.a('function');
    });
  });

  it('exports the action enums used by v2 builders', function () {
    expect(AuthorityType.Clawback).to.equal(
      'Clawback'
    );
    expect(ManageListAction.Add).to.equal('Add');
    expect(ManageListAction.Remove).to.equal(
      'Remove'
    );
    expect(PauseAction.Pause).to.equal('Pause');
  });
});
