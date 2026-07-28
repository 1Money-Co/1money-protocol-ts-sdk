import { expect } from 'chai';
import 'mocha';

import {
  assertTransactionHash,
  isLegacyWriteDisabled,
  isNativeV2NotActive,
  TransactionHashMismatchError,
  V2_ERROR_CODES
} from '../errors';

const LOCAL = `0x${'ab'.repeat(32)}`;
const OTHER = `0x${'cd'.repeat(32)}`;

describe('v2 errors', function () {
  it('exposes the five v2 error codes', function () {
    expect(
      Object.values(V2_ERROR_CODES)
    ).to.have.members([
      'DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE',
      'LEGACY_NATIVE_WRITE_ENDPOINT_DISABLED',
      'UNSUPPORTED_AUTHORIZATION_TYPE',
      'DOMAIN_SEPARATED_SIGNATURE_REQUIRED',
      'RAW_TRANSACTION_ENDPOINT_REMOVED'
    ]);
  });

  it('narrows a not-active rejection', function () {
    expect(
      isNativeV2NotActive({
        status: 403,
        data: {
          error_code:
            'DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE'
        }
      })
    ).to.equal(true);
    expect(isNativeV2NotActive({})).to.equal(
      false
    );
    expect(
      isNativeV2NotActive(undefined)
    ).to.equal(false);
  });

  it('narrows a legacy-disabled rejection', function () {
    expect(
      isLegacyWriteDisabled({
        status: 410,
        data: {
          error_code:
            'LEGACY_NATIVE_WRITE_ENDPOINT_DISABLED'
        }
      })
    ).to.equal(true);
  });

  it('accepts a matching hash regardless of case', function () {
    expect(() =>
      assertTransactionHash(
        LOCAL,
        LOCAL.toUpperCase()
      )
    ).to.not.throw();
  });

  it(
    'throws a submitted-flagged error on mismatch',
    function () {
      let caught: unknown;
      try {
        assertTransactionHash(LOCAL, OTHER);
      } catch (error) {
        caught = error;
      }
      expect(caught).to.be.instanceOf(
        TransactionHashMismatchError
      );
      const err =
        caught as TransactionHashMismatchError;
      expect(err.submitted).to.equal(true);
      expect(err.localHash).to.equal(LOCAL);
      expect(err.serverHash).to.equal(OTHER);
    }
  );

  // Fail-closed: a malformed serverHash must never
  // escape as a bare TypeError. The tx was already
  // admitted, so this must still surface as
  // TransactionHashMismatchError with
  // submitted === true.
  for (const bad of [
    undefined,
    null,
    12345
  ] as unknown[]) {
    it(
      `throws TransactionHashMismatchError (submitted: true) for serverHash ${String(bad)}`,
      function () {
        let caught: unknown;
        try {
          assertTransactionHash(LOCAL, bad);
        } catch (error) {
          caught = error;
        }
        expect(caught).to.be.instanceOf(
          TransactionHashMismatchError
        );
        const err =
          caught as TransactionHashMismatchError;
        expect(err.submitted).to.equal(true);
      }
    );
  }
});
