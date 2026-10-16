import { expect } from 'chai';
import fc from 'fast-check';
import 'mocha';

import { classifySubmitResponse } from '../classify';
import { matchLegacyReason } from '../legacyText';
import {
  BYTES_REFUSAL_TYPES,
  CLIENT_ACTIONS,
  NO_EFFECT_ACTIONS
} from '../problem';

const LOCAL = `0x${'ab'.repeat(32)}`;
const OTHER = `0x${'cd'.repeat(32)}`;
const TYPE_PREFIX =
  'https://developer.1moneynetwork.com/problem/';

// The value `post()` gives for a non-2xx answer
// (src/client/core.ts parseError): `message` is the
// axios text, `data` is the response body.
function parsedError(
  status: number,
  data: unknown,
  message = `Request failed with status code ${status}`
) {
  return {
    name: 'AxiosError',
    message,
    stack: '',
    status,
    data
  };
}

// A node problem body (RFC 9457), as the node
// sends it on a Stage A node.
function problem(
  identifier: string,
  action: string,
  status: number,
  errorCode: string,
  members: Record<string, unknown> = {}
) {
  return {
    type: `${TYPE_PREFIX}${identifier}`,
    title: identifier,
    status,
    instance: 'urn:uuid:0192f0c4-7d2e-7a51-9b0e-3c1d2e4f5a6b',
    action,
    error_code: errorCode,
    message: `${identifier} message`,
    ...members
  };
}

const IN_FLIGHT = problem(
  'submission_already_in_flight',
  'in_progress',
  422,
  'business_transaction_failed',
  { tx_hash: LOCAL }
);

describe('classifySubmitResponse', function () {
  describe('rule 1: a string hash', function () {
    it('is accepted, with the hash the node sent (UC10)', function () {
      const response = { hash: OTHER, extra: 1 };
      expect(
        classifySubmitResponse(response, LOCAL)
      ).to.deep.equal({
        kind: 'accepted',
        serverHash: OTHER,
        response
      });
    });

    it('wins over an action in the same body', function () {
      expect(
        classifySubmitResponse(
          { hash: LOCAL, action: 'fix_request' },
          LOCAL
        ).kind
      ).to.equal('accepted');
    });
  });

  describe('rule 2: a no-effect action', function () {
    for (const action of NO_EFFECT_ACTIONS) {
      it(`is rejected for a 4xx with ${action} (UC3)`, function () {
        const body = problem(
          'some_problem',
          action,
          400,
          'validation_invalid_signature'
        );
        expect(
          classifySubmitResponse(
            parsedError(400, body),
            LOCAL
          )
        ).to.deep.equal({
          kind: 'rejected',
          status: 400,
          data: body,
          nodeMessage: 'some_problem message',
          refusal: 'request',
          action,
          problemType: `${TYPE_PREFIX}some_problem`
        });
      });
    }

    it('is rejected for a 5xx that proves no effect (UC5)', function () {
      for (const [id, status] of [
        ['node_syncing', 503],
        ['submit_queue_full', 500]
      ] as const) {
        const outcome = classifySubmitResponse(
          parsedError(
            status,
            problem(
              id,
              'retry_later',
              status,
              'service_unavailable'
            )
          ),
          LOCAL
        );
        expect(outcome.kind).to.equal('rejected');
        expect(outcome).to.include({
          status,
          action: 'retry_later'
        });
      }
    });

    it('takes the status from a resolved bare body', function () {
      const body = problem(
        'rate_limited',
        'retry_later',
        429,
        'rate_limit_exceeded'
      );
      expect(
        classifySubmitResponse(body, LOCAL)
      ).to.include({
        kind: 'rejected',
        status: 429,
        data: body,
        nodeMessage: 'rate_limited message'
      });

      const noStatus = { action: 'fix_request' };
      expect(
        classifySubmitResponse(noStatus, LOCAL)
      ).to.include({ kind: 'rejected', status: 0 });
    });
  });

  describe('rule 3: in_progress for this transaction', function () {
    it('is locked, not rejected, for a 422 in-flight answer (issue #49, UC1)', function () {
      expect(
        classifySubmitResponse(
          parsedError(422, IN_FLIGHT),
          LOCAL
        )
      ).to.deep.equal({
        kind: 'locked',
        status: 422,
        data: IN_FLIGHT,
        problemType: `${TYPE_PREFIX}submission_already_in_flight`
      });
    });

    it('matches the hash ignoring case', function () {
      const body = {
        ...IN_FLIGHT,
        tx_hash: LOCAL.toUpperCase()
      };
      expect(
        classifySubmitResponse(
          parsedError(422, body),
          LOCAL
        ).kind
      ).to.equal('locked');
    });

    it('is locked when the body has no tx_hash member', function () {
      const { tx_hash: _omitted, ...body } =
        IN_FLIGHT;
      expect(
        classifySubmitResponse(
          parsedError(422, body),
          LOCAL
        ).kind
      ).to.equal('locked');
    });
  });

  describe('rule 4: any other action', function () {
    it('is unknown for check_status (UC2)', function () {
      for (const body of [
        problem(
          'nonce_too_low',
          'check_status',
          422,
          'business_transaction_failed',
          { nonce: 3, nonce_expected: 4 }
        ),
        problem(
          'sender_locked_by_other_transaction',
          'check_status',
          422,
          'business_transaction_failed',
          {
            tx_hash_locked: OTHER,
            nonce_locked: 3,
            nonce: 3
          }
        )
      ]) {
        expect(
          classifySubmitResponse(
            parsedError(422, body),
            LOCAL
          )
        ).to.deep.equal({
          kind: 'unknown',
          status: 422,
          data: body,
          cause: parsedError(422, body),
          action: 'check_status',
          problemType: body.type
        });
      }
    });

    it('is unknown for check_status on a 5xx or a 408 (UC4)', function () {
      for (const status of [500, 504, 408]) {
        expect(
          classifySubmitResponse(
            parsedError(
              status,
              problem(
                'request_timeout',
                'check_status',
                status,
                'request_timeout'
              )
            ),
            LOCAL
          ).kind
        ).to.equal('unknown');
      }
    });

    it('is unknown for in_progress with another hash (LD2)', function () {
      expect(
        classifySubmitResponse(
          parsedError(422, {
            ...IN_FLIGHT,
            tx_hash: OTHER
          }),
          LOCAL
        ).kind
      ).to.equal('unknown');
    });

    it('is unknown for in_progress with a tx_hash that is not a string (LD7)', function () {
      for (const raw of [42, null, {}]) {
        expect(
          classifySubmitResponse(
            parsedError(422, {
              ...IN_FLIGHT,
              tx_hash: raw
            }),
            LOCAL
          ).kind
        ).to.equal('unknown');
      }
    });

    it('is unknown, with the raw value, for an action it does not know (UC6, LD8)', function () {
      for (const raw of [
        'wait_and_see',
        'Retry_Later',
        null,
        42
      ]) {
        const outcome = classifySubmitResponse(
          parsedError(400, {
            type: `${TYPE_PREFIX}future_problem`,
            action: raw
          }),
          LOCAL
        );
        expect(outcome.kind).to.equal('unknown');
        expect(outcome).to.have.property(
          'action',
          raw
        );
      }
    });

    it('never falls through to the status rules for a 4xx', function () {
      expect(
        classifySubmitResponse(
          parsedError(400, { action: 'later' }),
          LOCAL
        ).kind
      ).to.equal('unknown');
    });
  });

  describe('response shape', function () {
    it('reads the action of a bare body that also has status and data members', function () {
      expect(
        classifySubmitResponse(
          {
            status: 422,
            action: 'in_progress',
            tx_hash: LOCAL,
            data: { x: 1 }
          },
          LOCAL
        ).kind
      ).to.equal('locked');
    });

    it('does not take a value without a name for a ParsedError', function () {
      expect(
        classifySubmitResponse(
          {
            status: 400,
            data: { error_code: 'validation_failed' }
          },
          LOCAL
        ).kind
      ).to.equal('unknown');
    });

    it('does not read inherited members', function () {
      const inherited = Object.create({
        hash: LOCAL,
        code: 401
      }) as object;
      expect(
        classifySubmitResponse(inherited, LOCAL).kind
      ).to.equal('unknown');
    });
  });

  describe('exact outcome shapes', function () {
    it('leaves out the members it did not find', function () {
      const body = { action: 'fix_request' };
      expect(
        classifySubmitResponse(body, LOCAL)
      ).to.deep.equal({
        kind: 'rejected',
        status: 0,
        data: body,
        nodeMessage: 'the node rejected the request',
        refusal: 'request',
        action: 'fix_request'
      });

      const lockedBody = { action: 'in_progress' };
      expect(
        classifySubmitResponse(lockedBody, LOCAL)
      ).to.deep.equal({
        kind: 'locked',
        data: lockedBody
      });

      expect(
        classifySubmitResponse(undefined, LOCAL)
      ).to.deep.equal({ kind: 'unknown' });

      const failure = new Error('socket hang up');
      expect(
        classifySubmitResponse(failure, LOCAL)
      ).to.deep.equal({
        kind: 'unknown',
        cause: failure
      });
    });

    it('keeps the data member of an unknown bare value', function () {
      const value = { data: { x: 1 } };
      expect(
        classifySubmitResponse(value, LOCAL)
      ).to.deep.equal({
        kind: 'unknown',
        data: { x: 1 },
        cause: value
      });
    });

    it('uses a text fallback when the message is absent or not a string', function () {
      expect(
        classifySubmitResponse(
          { action: 'retry_later', message: 42 },
          LOCAL
        )
      ).to.include({
        nodeMessage: 'the node rejected the request'
      });
      expect(
        classifySubmitResponse(
          { name: 'AxiosError', status: 400, data: {} },
          LOCAL
        )
      ).to.include({
        kind: 'rejected',
        nodeMessage: 'the node rejected the request'
      });
      expect(
        classifySubmitResponse(
          { code: 401, data: null },
          LOCAL
        )
      ).to.include({
        kind: 'rejected',
        nodeMessage:
          'the node returned a 401 (unauthorized) response'
      });
    });

    it('takes no status that is not a number', function () {
      expect(
        classifySubmitResponse(
          { action: 'fix_request', status: '429' },
          LOCAL
        )
      ).to.include({ kind: 'rejected', status: 0 });
      // A ParsedError always has a numeric status; with a
      // string one the value is a bare body without an
      // action, so it is unknown, not rejected.
      expect(
        classifySubmitResponse(
          {
            name: 'AxiosError',
            status: '400',
            data: { error_code: 'validation_failed' }
          },
          LOCAL
        ).kind
      ).to.equal('unknown');
    });
  });

  describe('rules 5 to 8: no action (legacy node or gateway)', function () {
    it('is unknown, marked unpinned, for a 422 business_transaction_failed (rule 5, UC7)', function () {
      const body = {
        error_code: 'business_transaction_failed',
        message:
          'Transaction processing failed: nonce higher than expected; local submit does not queue'
      };
      expect(
        classifySubmitResponse(
          parsedError(422, body),
          LOCAL
        )
      ).to.deep.equal({
        kind: 'unknown',
        status: 422,
        data: body,
        cause: parsedError(422, body),
        legacyUnpinned: true
      });
    });

    it('does not mark a 422 business_transaction_failed with an action as unpinned', function () {
      const outcome = classifySubmitResponse(
        parsedError(422, {
          error_code: 'business_transaction_failed',
          action: 'check_status',
          message: 'Transaction processing failed: x'
        }),
        LOCAL
      );
      expect(outcome.kind).to.equal('unknown');
      expect(outcome).to.not.have.property('legacyUnpinned');
    });

    it('is unknown for a 408 (rule 6)', function () {
      expect(
        classifySubmitResponse(
          parsedError(408, { message: 'timeout' }),
          LOCAL
        ).kind
      ).to.equal('unknown');
    });

    it('is rejected for any other 4xx with a body (rule 7, UC8)', function () {
      for (const [status, errorCode] of [
        [400, 'validation_invalid_signature'],
        [403, 'DOMAIN_SEPARATED_SIGNATURE_NOT_ACTIVE'],
        [404, 'resource_not_found'],
        [410, 'LEGACY_NATIVE_WRITE_ENDPOINT_DISABLED'],
        [429, 'rate_limit_exceeded'],
        [422, 'business_token_operation_failed']
      ] as const) {
        const body = {
          error_code: errorCode,
          message: 'refused'
        };
        expect(
          classifySubmitResponse(
            parsedError(status, body),
            LOCAL
          )
        ).to.deep.equal({
          kind: 'rejected',
          status,
          data: body,
          nodeMessage: 'refused',
          refusal: 'request'
        });
      }
    });

    it('is rejected for a gateway 4xx with a text body (rule 7)', function () {
      expect(
        classifySubmitResponse(
          parsedError(403, '<html>Forbidden</html>'),
          LOCAL
        ).kind
      ).to.equal('rejected');
    });

    it('is rejected for the 401 login body that has no status (rule 7)', function () {
      for (const code of [401, '401']) {
        expect(
          classifySubmitResponse(
            {
              code,
              data: null,
              msg: 'authentication required'
            },
            LOCAL
          )
        ).to.deep.equal({
          kind: 'rejected',
          status: 401,
          data: null,
          nodeMessage: 'authentication required',
          refusal: 'request'
        });
      }
    });

    it('is unknown for a 5xx, a timeout, a network error, or a 2xx without a hash (rule 8, UC9)', function () {
      const cases: unknown[] = [
        parsedError(500, { message: 'system error' }),
        parsedError(502, '<html>Bad Gateway</html>'),
        parsedError(503, undefined),
        // A timeout: status 500 and no body.
        parsedError(
          500,
          undefined,
          'timeout of 10000ms exceeded'
        ),
        // A 4xx without a body.
        parsedError(400, undefined),
        {},
        { hash: 42 },
        undefined,
        null,
        'ok',
        new Error('socket hang up')
      ];
      for (const response of cases) {
        expect(
          classifySubmitResponse(response, LOCAL).kind,
          JSON.stringify(response)
        ).to.equal('unknown');
      }
    });

    it('keeps the status and the body of an unknown outcome', function () {
      const response = parsedError(502, {
        message: 'downstream failure'
      });
      expect(
        classifySubmitResponse(response, LOCAL)
      ).to.deep.equal({
        kind: 'unknown',
        status: 502,
        data: { message: 'downstream failure' },
        cause: response
      });
    });

    it('never reads the message text', function () {
      expect(
        classifySubmitResponse(
          parsedError(
            400,
            { message: 'already inflight' },
            'already inflight'
          ),
          LOCAL
        ).kind
      ).to.equal('rejected');
    });
  });

  describe('rules 5a to 5c: pinned legacy texts (no action)', function () {
    function legacy(reason: string) {
      return {
        error_code: 'business_transaction_failed',
        message: `Transaction processing failed: ${reason}`
      };
    }

    it('is locked for the in-flight text (5a, UC19)', function () {
      const body = legacy(
        'already inflight; please retry later'
      );
      expect(
        classifySubmitResponse(parsedError(422, body), LOCAL)
      ).to.deep.equal({
        kind: 'locked',
        status: 422,
        data: body,
        legacyText: true
      });
    });

    it('is rejected as a refusal of the bytes for a validity text (5b, UC18)', function () {
      const body = legacy(
        'Failed to recover REST envelope: invalid signature bytes'
      );
      expect(
        classifySubmitResponse(parsedError(422, body), LOCAL)
      ).to.deep.equal({
        kind: 'rejected',
        status: 422,
        data: body,
        nodeMessage: body.message,
        refusal: 'bytes'
      });
    });

    it('is unknown with nonceUsed for a nonce text (5c)', function () {
      for (const reason of [
        'nonce already used; state advanced',
        `Execution admission denied: nonce too low to execute: expected 6, got 5 of tx ${LOCAL}`
      ]) {
        const body = legacy(reason);
        expect(
          classifySubmitResponse(
            parsedError(422, body),
            LOCAL
          )
        ).to.deep.include({
          kind: 'unknown',
          status: 422,
          nonceUsed: true
        });
      }
    });

    it('stays unknown for a message that is not a string', function () {
      for (const message of [42, null, { text: 'x' }]) {
        expect(
          classifySubmitResponse(
            parsedError(422, {
              error_code: 'business_transaction_failed',
              message
            }),
            LOCAL
          ).kind
        ).to.equal('unknown');
      }
    });

    it('stays unknown for a state text (rule 5)', function () {
      const body = legacy(
        'Execution admission denied: token process error: TokenProcessError: mint_address: 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed, error: Transfer failed: insufficient balance in source account'
      );
      const outcome = classifySubmitResponse(
        parsedError(422, body),
        LOCAL
      );
      expect(outcome.kind).to.equal('unknown');
      expect(outcome).to.not.have.property('nonceUsed');
    });

    it('reads the texts only for a 422 business_transaction_failed without action', function () {
      const reason =
        'Failed to recover REST envelope: invalid signature bytes';
      // A body with an action decides by the action.
      expect(
        classifySubmitResponse(
          parsedError(422, {
            ...legacy(reason),
            action: 'check_status'
          }),
          LOCAL
        ).kind
      ).to.equal('unknown');
      // Another status or code keeps its 3.1.0 rule.
      expect(
        classifySubmitResponse(
          parsedError(500, legacy(reason)),
          LOCAL
        ).kind
      ).to.equal('unknown');
      expect(
        classifySubmitResponse(
          parsedError(422, {
            error_code: 'business_token_operation_failed',
            message: legacy(reason).message
          }),
          LOCAL
        )
      ).to.include({ kind: 'rejected', refusal: 'request' });
      // A bare body is not a ParsedError.
      expect(
        classifySubmitResponse(legacy(reason), LOCAL).kind
      ).to.equal('unknown');
    });
  });

  describe('refusal: bytes or request', function () {
    it('marks a bytes-refusal problem type as bytes', function () {
      for (const id of [
        'envelope_signature_invalid',
        'signature_pairing_invalid',
        'chain_id_mismatch',
        'sender_not_allowed',
        'memo_invalid'
      ]) {
        expect(
          classifySubmitResponse(
            parsedError(
              422,
              problem(
                id,
                'fix_request',
                422,
                'business_transaction_failed'
              )
            ),
            LOCAL
          ),
          id
        ).to.include({ kind: 'rejected', refusal: 'bytes' });
      }
    });

    it('marks every other rejection as request', function () {
      for (const id of [
        'transaction_too_large',
        'batch_payment_invalid',
        'batch_payments_disabled',
        'zero_payment_value',
        'bridge_sender_mismatch',
        'token_field_invalid',
        'provenance_not_admissible',
        'insufficient_balance',
        'rate_limited',
        'node_syncing'
      ]) {
        expect(
          classifySubmitResponse(
            parsedError(
              422,
              problem(
                id,
                'fix_request',
                422,
                'business_transaction_failed'
              )
            ),
            LOCAL
          ),
          id
        ).to.include({ kind: 'rejected', refusal: 'request' });
      }
      expect(
        classifySubmitResponse(
          parsedError(400, {
            error_code: 'validation_invalid_signature',
            message: 'refused'
          }),
          LOCAL
        )
      ).to.include({ kind: 'rejected', refusal: 'request' });
    });
  });

  describe('nodeMessage: the node text, not the transport text', function () {
    it('reads the body message, then the title, then the transport text', function () {
      expect(
        classifySubmitResponse(
          parsedError(400, {
            error_code: 'x',
            message: 'bad address'
          }),
          LOCAL
        )
      ).to.include({ nodeMessage: 'bad address' });
      expect(
        classifySubmitResponse(
          parsedError(400, {
            type: `${TYPE_PREFIX}chain_id_mismatch`,
            title: 'Chain id mismatch',
            action: 'fix_request'
          }),
          LOCAL
        )
      ).to.include({ nodeMessage: 'Chain id mismatch' });
      expect(
        classifySubmitResponse(
          parsedError(400, {
            error_code: 'x',
            message: '',
            title: 'Bad request'
          }),
          LOCAL
        )
      ).to.include({ nodeMessage: 'Bad request' });
      expect(
        classifySubmitResponse(
          parsedError(400, { error_code: 'x', message: '' }),
          LOCAL
        )
      ).to.include({
        nodeMessage: 'Request failed with status code 400'
      });
      expect(
        classifySubmitResponse(
          parsedError(403, '<html>Forbidden</html>'),
          LOCAL
        )
      ).to.include({
        nodeMessage: 'Request failed with status code 403'
      });
    });
  });

  describe('safety invariant (property test)', function () {
    // Released-node reasons of each class, and look-alikes.
    const legacyMessage = fc.oneof(
      fc.string(),
      fc.constantFrom(
        'already inflight; please retry later',
        'already inflight; please retry later!',
        'nonce already used; state advanced',
        'Zero sender',
        'Invalid chain id: expected 1, actual 2',
        'Input size is too large: 40000',
        'batch payments are disabled'
      ).map(reason => `Transaction processing failed: ${reason}`)
    );
    const action = fc.oneof(
      fc.constantFrom(...CLIENT_ACTIONS),
      fc.string(),
      fc.constant(null),
      fc.integer()
    );
    const body = fc.record(
      {
        action,
        error_code: fc.constantFrom(
          'business_transaction_failed',
          'business_token_operation_failed',
          'validation_invalid_signature'
        ),
        hash: fc.oneof(
          fc.constant(LOCAL),
          fc.string(),
          fc.integer()
        ),
        tx_hash: fc.oneof(
          fc.constant(LOCAL),
          fc.constant(LOCAL.toUpperCase()),
          fc.constant(OTHER),
          fc.integer(),
          fc.constant(null)
        ),
        status: fc.integer({ min: 100, max: 599 }),
        code: fc.constantFrom(401, '401', 400),
        message: legacyMessage,
        // A bare body never has ParsedError's `name`, so a
        // `data` member must not hide its own `action`.
        data: fc.anything()
      },
      { requiredKeys: [] }
    );
    const parsed = fc.record({
      status: fc.integer({ min: 100, max: 599 }),
      data: fc.oneof(
        body,
        fc.constant(undefined),
        fc.anything()
      ),
      message: fc.string()
    });

    function own(value: unknown, key: string) {
      return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.prototype.hasOwnProperty.call(
          value,
          key
        )
      );
    }

    function member(value: unknown, key: string) {
      return own(value, key)
        ? (value as Record<string, unknown>)[key]
        : undefined;
    }

    function isNoEffect(value: unknown) {
      return (
        typeof value === 'string' &&
        (NO_EFFECT_ACTIONS as readonly string[]).includes(
          value
        )
      );
    }

    function lockedAllowed(data: unknown) {
      const txHash = member(data, 'tx_hash');
      return (
        member(data, 'action') === 'in_progress' &&
        (!own(data, 'tx_hash') ||
          (typeof txHash === 'string' &&
            txHash.toLowerCase() === LOCAL))
      );
    }

    it('rejects a ParsedError only on a no-effect action, or with no action on a safe 4xx', function () {
      fc.assert(
        fc.property(parsed, p => {
          const response = parsedError(
            p.status,
            p.data,
            p.message
          );
          const outcome = classifySubmitResponse(
            response,
            LOCAL
          );
          const hasAction = own(p.data, 'action');
          const legacy =
            !hasAction &&
            p.status === 422 &&
            member(p.data, 'error_code') ===
              'business_transaction_failed';
          const text = member(p.data, 'message');
          const legacyClass =
            legacy && typeof text === 'string'
              ? matchLegacyReason(text)
              : undefined;
          const expectRejected = hasAction
            ? isNoEffect(member(p.data, 'action'))
            : legacy
            ? legacyClass === 'bytes'
            : p.status >= 400 &&
              p.status < 500 &&
              p.status !== 408 &&
              p.data !== undefined;
          expect(outcome.kind === 'rejected').to.equal(
            expectRejected
          );
          expect(outcome.kind === 'locked').to.equal(
            lockedAllowed(p.data) ||
              legacyClass === 'in_flight'
          );
          if (outcome.kind === 'rejected') {
            expect(outcome.refusal === 'bytes').to.equal(
              legacyClass === 'bytes' ||
                (hasAction &&
                  BYTES_REFUSAL_TYPES.has(
                    member(p.data, 'type') as string
                  ))
            );
          }
          if (!hasAction) {
            if (
              p.status === 408 ||
              (legacy && legacyClass === undefined) ||
              legacyClass === 'nonce_used'
            ) {
              expect(outcome.kind).to.equal('unknown');
            }
          }
        }),
        { numRuns: 2000 }
      );
    });

    it('rejects a bare body only on a no-effect action or the 401 body shape', function () {
      fc.assert(
        fc.property(body, b => {
          const outcome = classifySubmitResponse(
            b,
            LOCAL
          );
          if (typeof b.hash === 'string') {
            expect(outcome.kind).to.equal('accepted');
            return;
          }
          const expectRejected = own(b, 'action')
            ? isNoEffect(b.action)
            : own(b, 'code') && b.code == 401;
          expect(outcome.kind === 'rejected').to.equal(
            expectRejected
          );
          expect(outcome.kind === 'locked').to.equal(
            lockedAllowed(b)
          );
        }),
        { numRuns: 2000 }
      );
    });

    it('never throws, and gives the same outcome for the same input', function () {
      fc.assert(
        fc.property(fc.anything(), value => {
          const first = classifySubmitResponse(
            value,
            LOCAL
          );
          expect(
            classifySubmitResponse(value, LOCAL)
          ).to.deep.equal(first);
          expect([
            'accepted',
            'rejected',
            'locked',
            'unknown'
          ]).to.include(first.kind);
          if (first.kind === 'locked') {
            expect(
              lockedAllowed(
                own(value, 'data') &&
                  typeof member(value, 'name') ===
                    'string' &&
                  typeof member(value, 'status') ===
                    'number'
                  ? member(value, 'data')
                  : value
              )
            ).to.equal(true);
          }
        }),
        { numRuns: 2000 }
      );
    });
  });
});
