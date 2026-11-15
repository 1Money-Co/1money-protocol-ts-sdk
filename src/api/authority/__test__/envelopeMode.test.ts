import { expect } from 'chai';
import 'mocha';

import {
  authorityEnvelope,
  clawbackEnvelope,
  envelopeModeOf,
  readEnvelopeMode,
  UnrecognizedEnvelopeModeError,
  UpgradeGapError
} from '../envelopeMode';
import { VERIFY_TOKEN_ADDRESS } from '@/signing/builders/laneClawback';
import { MockNode, ok } from './helpers/mockNode';

import type { EnvelopeMode } from '../envelopeMode';

const STATUS = {
  native_write_mode: 'v2_only',
  read_only: false,
  activation_source: 'binary_release',
  dual_activated_at_secs: null,
  native_domain_separated_transactions: {
    support_count: 7,
    required_count: 7,
    full_support: true
  }
};
const TOKEN = `0x${'01'.repeat(20)}`;

describe('envelope mode (the client switch point)', function () {
  let node: MockNode;

  afterEach(function () {
    node?.uninstall();
  });

  async function modeFor(answer: {
    status: number;
    body: unknown;
  }): Promise<EnvelopeMode> {
    node = new MockNode({ '/api/status': answer }).install();
    return readEnvelopeMode();
  }

  it('reads a node with no envelope_mode as legacy', async function () {
    expect(await modeFor(ok(STATUS))).to.deep.equal({
      mode: 'legacy',
      reason: { kind: 'not_reported' }
    });
  });

  it('reads a null envelope_mode as legacy', async function () {
    expect(
      await modeFor(ok({ ...STATUS, envelope_mode: null }))
    ).to.deep.equal({
      mode: 'legacy',
      reason: { kind: 'not_reported' }
    });
  });

  it('reads upgrade_gap and settled', async function () {
    expect(
      await modeFor(ok({ ...STATUS, envelope_mode: 'upgrade_gap' }))
    ).to.deep.equal({ mode: 'upgrade_gap' });
    node.uninstall();
    expect(
      await modeFor(ok({ ...STATUS, envelope_mode: 'settled' }))
    ).to.deep.equal({ mode: 'settled' });
  });

  it('reads an unknown mode as unrecognized', async function () {
    expect(
      await modeFor(ok({ ...STATUS, envelope_mode: 'later' }))
    ).to.deep.equal({ mode: 'unrecognized', reported: 'later' });
  });

  it('reads an HTTP error as legacy with its status', async function () {
    expect(
      await modeFor({ status: 503, body: 'down' })
    ).to.deep.equal({
      mode: 'legacy',
      reason: { kind: 'status_answered', status: 503 }
    });
  });

  it('reads a body that is not an object as legacy', function () {
    expect(envelopeModeOf('UP')).to.deep.equal({
      mode: 'legacy',
      reason: { kind: 'undecodable' }
    });
    expect(envelopeModeOf(new Error('ECONNRESET'))).to.deep.equal({
      mode: 'legacy',
      reason: { kind: 'no_answer', message: 'ECONNRESET' }
    });
  });

  it('sends nothing of the class in the gap or an unknown mode', function () {
    expect(() =>
      authorityEnvelope({ mode: 'upgrade_gap' })
    ).to.throw(UpgradeGapError);
    expect(() =>
      authorityEnvelope({ mode: 'unrecognized', reported: 'x' })
    ).to.throw(UnrecognizedEnvelopeModeError);
    expect(
      authorityEnvelope({
        mode: 'legacy',
        reason: { kind: 'not_reported' }
      })
    ).to.equal('legacy');
    expect(authorityEnvelope({ mode: 'settled' })).to.equal(
      'settled'
    );
  });

  it('keeps a clawback of VERIFY or of a hold legacy in every mode', function () {
    for (const mode of [
      { mode: 'settled' },
      { mode: 'upgrade_gap' }
    ] as EnvelopeMode[]) {
      expect(
        clawbackEnvelope(mode, VERIFY_TOKEN_ADDRESS, 'account')
      ).to.equal('legacy');
      expect(clawbackEnvelope(mode, TOKEN, 'hold')).to.equal(
        'legacy'
      );
    }
    expect(
      clawbackEnvelope({ mode: 'settled' }, TOKEN, 'account')
    ).to.equal('settled');
    expect(() =>
      clawbackEnvelope({ mode: 'upgrade_gap' }, TOKEN, 'account')
    ).to.throw(UpgradeGapError);
  });
});
