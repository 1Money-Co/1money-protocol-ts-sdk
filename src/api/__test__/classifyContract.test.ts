import { expect } from 'chai';
import fc from 'fast-check';
import 'mocha';

import { classifySubmitResponse, isNonceUsed } from '../classify';
import { readResult } from '../settle';

import type { SubmitOutcome } from '../classify';

// Ported from the Rust SDK, the canonical behavior:
// l1client crates/om-sdk/src/submit/tests/classify.rs at
// dc5cffa0b. Only the node's statement selects an outcome:
// an `action` member of a body whose `type` is in the node's
// namespace or is `about:blank`.

const LOCAL = `0x${'11'.repeat(32)}`;
const OTHER = `0x${'22'.repeat(32)}`;
const TYPE_PREFIX =
  'https://developer.1moneynetwork.com/problem/';
const NEWER_NODE_TYPE = `${TYPE_PREFIX}future_kind`;
const IN_FLIGHT_TYPE = `${TYPE_PREFIX}submission_already_in_flight`;
const NONCE_TOO_LOW_TYPE = `${TYPE_PREFIX}nonce_too_low`;
const CLIENT_ACTIONS = [
  'fix_request',
  'retry_later',
  'use_other_node',
  'in_progress',
  'check_status'
];
const NO_EFFECT = ['fix_request', 'retry_later', 'use_other_node'];

// The body as axios gives it: parsed JSON, else the text.
function received(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The value post() gives for an HTTP answer: the body for a
// 2xx, else the ParsedError of src/client/core.ts.
function http(status: number, text: string): unknown {
  const data = received(text);
  return status >= 200 && status < 300
    ? data
    : {
        name: 'AxiosError',
        message: `Request failed with status code ${status}`,
        stack: '',
        status,
        data
      };
}

// A network error or a timeout: status 500, no body.
const TRANSPORT = {
  name: 'AxiosError',
  message: 'Network Error',
  stack: '',
  status: 500,
  data: undefined
};

function classifyAnswer(answer: unknown): SubmitOutcome {
  return classifySubmitResponse(answer, LOCAL);
}

function kind(status: number, body: unknown): string {
  return classifyAnswer(http(status, JSON.stringify(body))).kind;
}

function kindOfText(status: number, text: string): string {
  return classifyAnswer(http(status, text)).kind;
}

function legacyBody(message: string) {
  return {
    error_code: 'business_transaction_failed',
    message
  };
}

function pinned(reason: string): string {
  return `Transaction processing failed: ${reason}`;
}

describe('submit classification (the Rust SDK contract)', function () {
  it('rule 1: a 2xx with a string hash is accepted with the server hash', function () {
    for (const status of [200, 201, 299]) {
      const outcome = classifyAnswer(
        http(status, JSON.stringify({ hash: OTHER }))
      );
      expect(outcome).to.deep.include({
        kind: 'accepted',
        serverHash: OTHER
      });
    }
  });

  it('rule 1 wins over every action', function () {
    for (const action of CLIENT_ACTIONS) {
      for (const status of [200, 201, 299]) {
        const body = {
          hash: LOCAL,
          type: NEWER_NODE_TYPE,
          action,
          tx_hash: OTHER
        };
        expect(kind(status, body), `${action} at ${status}`).to.equal(
          'accepted'
        );
      }
    }
  });

  it('a 2xx without a string hash is unknown', function () {
    expect(kind(200, {})).to.equal('unknown');
    expect(kind(200, { hash: 42 })).to.equal('unknown');
    expect(kind(200, { hash: null })).to.equal('unknown');
    expect(kind(200, [{ hash: LOCAL }])).to.equal('unknown');
    expect(kindOfText(200, '')).to.equal('unknown');
    expect(kindOfText(200, 'ok')).to.equal('unknown');
  });

  it('a hash outside a 2xx does not accept', function () {
    expect(kind(199, { hash: LOCAL })).to.equal('unknown');
    expect(kind(300, { hash: LOCAL })).to.equal('unknown');
    expect(kind(400, { hash: LOCAL, error_code: 'x' })).to.equal(
      'unknown'
    );
    expect(kind(500, { hash: LOCAL })).to.equal('unknown');
  });

  it('rule 2: a no-effect action is rejected at any status', function () {
    for (const action of NO_EFFECT) {
      for (const status of [200, 400, 408, 422, 429, 500, 503]) {
        const body = {
          type: NEWER_NODE_TYPE,
          action,
          error_code: 'business_transaction_failed'
        };
        expect(kind(status, body), `${action} at ${status}`).to.equal(
          'rejected'
        );
      }
    }
  });

  it('rule 2: node_syncing and submit_queue_full are rejected', function () {
    expect(
      kind(503, {
        type: `${TYPE_PREFIX}node_syncing`,
        action: 'retry_later'
      })
    ).to.equal('rejected');
    expect(
      kind(500, {
        type: `${TYPE_PREFIX}submit_queue_full`,
        action: 'retry_later'
      })
    ).to.equal('rejected');
  });

  it('rule 3: in_progress for this transaction is locked', function () {
    const inProgress = { type: IN_FLIGHT_TYPE, action: 'in_progress' };
    expect(kind(422, inProgress)).to.equal('locked');
    expect(kind(422, { ...inProgress, tx_hash: LOCAL })).to.equal(
      'locked'
    );
    expect(
      kind(422, {
        ...inProgress,
        tx_hash: `0x${LOCAL.slice(2).toUpperCase()}`
      })
    ).to.equal('locked');
    expect(kind(500, inProgress)).to.equal('locked');
  });

  it('rule 4: in_progress for another or an unreadable hash is unknown', function () {
    for (const txHash of [
      OTHER,
      42,
      null,
      '0xnothex',
      '',
      [LOCAL]
    ]) {
      const body = {
        type: IN_FLIGHT_TYPE,
        action: 'in_progress',
        tx_hash: txHash
      };
      expect(kind(422, body), JSON.stringify(txHash)).to.equal(
        'unknown'
      );
    }
  });

  it('rule 4: any other action is unknown and keeps the raw action', function () {
    for (const action of [
      'check_status',
      'IN_PROGRESS',
      'Fix_Request',
      'later',
      null,
      7
    ]) {
      const outcome = classifyAnswer(
        http(
          400,
          JSON.stringify({
            type: 'about:blank',
            title: 't',
            action,
            error_code: 'validation_x'
          })
        )
      );
      expect(outcome.kind, String(action)).to.equal('unknown');
      expect(outcome).to.have.property('action', action);
    }
  });

  it('rule 5: a legacy 422 business_transaction_failed is unknown for any message', function () {
    const body = legacyBody('already inflight; please retry later');
    expect(kind(422, body)).to.equal('unknown');
    expect(
      kind(
        422,
        legacyBody(
          pinned('Insufficient balance: required 10, available 1')
        )
      )
    ).to.equal('unknown');
    expect(
      kind(422, {
        error_code: 'business_insufficient_funds',
        message: 'm'
      })
    ).to.equal('unknown');
    expect(kind(400, body)).to.equal('unknown');
  });

  it('rule 5a: the legacy in-flight reason is unknown', function () {
    const body = legacyBody(
      pinned('already inflight; please retry later')
    );
    expect(kind(422, body)).to.equal('unknown');
    expect(kind(400, body)).to.equal('unknown');
  });

  it('rule 5b: a legacy bytes reason is unknown', function () {
    for (const reason of [
      'Failed to recover REST envelope: invalid signature bytes',
      'Invalid chain id: expected 1212101, actual 1',
      'Invalid transaction memo: too long'
    ]) {
      expect(kind(422, legacyBody(pinned(reason))), reason).to.equal(
        'unknown'
      );
    }
  });

  it('rule 5c: a legacy nonce reason does not mark the nonce used', function () {
    for (const reason of [
      'nonce already used; state advanced',
      'Execution admission denied: nonce too low to execute: expected 4, got 3 of tx 0xab'
    ]) {
      const outcome = classifyAnswer(
        http(422, JSON.stringify(legacyBody(pinned(reason))))
      );
      expect(outcome.kind, reason).to.equal('unknown');
      expect(isNonceUsed(outcome), reason).to.equal(false);
    }
  });

  it('a pinned reason never overrides an action', function () {
    expect(
      kind(422, {
        type: 'about:blank',
        action: 'check_status',
        error_code: 'business_transaction_failed',
        message: pinned('already inflight; please retry later')
      })
    ).to.equal('unknown');
  });

  it('the nonce_too_low type marks the nonce used', function () {
    const typed = (type: string) =>
      JSON.stringify({
        type,
        title: 'Nonce too low',
        action: 'check_status',
        error_code: 'business_transaction_failed'
      });
    expect(
      isNonceUsed(classifyAnswer(http(422, typed(NONCE_TOO_LOW_TYPE))))
    ).to.equal(true);
    expect(
      isNonceUsed(
        classifyAnswer(http(422, typed(`${NONCE_TOO_LOW_TYPE}x`)))
      )
    ).to.equal(false);
    expect(
      isNonceUsed(classifyAnswer(http(500, typed(NONCE_TOO_LOW_TYPE))))
    ).to.equal(true);
  });

  it('only an unknown outcome marks the nonce used', function () {
    for (const action of ['fix_request', 'in_progress']) {
      const outcome = classifyAnswer(
        http(
          422,
          JSON.stringify({ type: NONCE_TOO_LOW_TYPE, action })
        )
      );
      expect(outcome.kind, action).to.not.equal('unknown');
      expect(isNonceUsed(outcome), action).to.equal(false);
    }
  });

  it('only the bytes refusal kinds refuse the bytes', function () {
    const refusal = (status: number, body: unknown) => {
      const outcome = classifyAnswer(
        http(status, JSON.stringify(body))
      );
      expect(outcome.kind).to.equal('rejected');
      return (outcome as { refusal: string }).refusal;
    };
    for (const id of [
      'envelope_signature_invalid',
      'signature_pairing_invalid',
      'chain_id_mismatch',
      'sender_not_allowed',
      'memo_invalid'
    ]) {
      const body = {
        type: `${TYPE_PREFIX}${id}`,
        title: 't',
        action: 'fix_request'
      };
      expect(refusal(422, body), id).to.equal('bytes');
    }
    for (const id of [
      'transaction_too_large',
      'batch_payment_invalid',
      'bridge_sender_mismatch',
      'provenance_not_admissible',
      'compliance_blocked',
      'withdrawal_exceeds_allowance'
    ]) {
      const body = {
        type: `${TYPE_PREFIX}${id}`,
        title: 't',
        action: 'fix_request'
      };
      expect(refusal(422, body), id).to.equal('request');
    }
    expect(
      refusal(400, {
        type: 'about:blank',
        action: 'fix_request',
        error_code: 'x',
        message: 'm'
      })
    ).to.equal('request');
  });

  it('rule 6: a 408 is unknown', function () {
    expect(
      kind(408, { error_code: 'request_timeout', message: 'm' })
    ).to.equal('unknown');
    expect(kindOfText(408, 'Request Timeout')).to.equal('unknown');
  });

  it('a 4xx without an action is unknown', function () {
    for (const status of [
      400, 401, 403, 404, 405, 407, 409, 410, 413, 421, 423, 429,
      499
    ]) {
      expect(
        kind(status, { error_code: 'c', message: 'm' }),
        String(status)
      ).to.equal('unknown');
    }
    expect(
      kindOfText(403, '<html><body>403 Forbidden</body></html>')
    ).to.equal('unknown');
    expect(kindOfText(429, 'Too Many Requests')).to.equal('unknown');
  });

  it('the bare 401 body that the login rule resolves with is unknown', function () {
    expect(
      classifyAnswer({ code: 401, msg: 'unauthorized' }).kind
    ).to.equal('unknown');
  });

  it('a JSON body that is not an object has no fields', function () {
    for (const text of [
      '[{"action":"in_progress"}]',
      'null',
      '"in_progress"',
      '1'
    ]) {
      expect(kindOfText(422, text), text).to.equal('unknown');
      expect(kindOfText(200, text), text).to.equal('unknown');
    }
  });

  it('a tx_hash without 0x still names the local hash', function () {
    expect(
      kind(422, {
        type: IN_FLIGHT_TYPE,
        action: 'in_progress',
        tx_hash: LOCAL.slice(2)
      })
    ).to.equal('locked');
  });

  it('a 4xx body that looks like an object but has no node statement is unknown', function () {
    const deep = `{"action":"in_progress","x":${'['.repeat(200)}${']'.repeat(200)}}`;
    const truncated = '{"action":"in_progress","tx_hash":"0x11';
    for (const text of [
      deep,
      truncated,
      '{"n":1e400}',
      '{"m":"\\ud800"}',
      '  {'
    ]) {
      expect(kindOfText(422, text), text).to.equal('unknown');
    }
  });

  it('a 4xx with an empty body is unknown', function () {
    expect(kindOfText(400, '')).to.equal('unknown');
    expect(kindOfText(429, ' \n\t')).to.equal('unknown');
  });

  it('rule 8: a 5xx, other statuses and a transport failure are unknown', function () {
    for (const status of [
      100, 199, 204, 300, 302, 399, 500, 502, 503, 504, 599
    ]) {
      expect(
        kind(status, { error_code: 'system_x', message: 'm' }),
        String(status)
      ).to.equal('unknown');
    }
    expect(classifyAnswer(TRANSPORT).kind).to.equal('unknown');
  });

  it('a 3xx is unknown, even with the node action: the node never redirects a submit', function () {
    for (const status of [301, 302, 303, 307, 308]) {
      for (const action of ['fix_request', 'in_progress']) {
        expect(
          kind(status, { type: NEWER_NODE_TYPE, action }),
          `${status} ${action}`
        ).to.equal('unknown');
      }
    }
  });

  it('an answer after a followed redirect is unknown, whatever it says', function () {
    for (const [status, data] of [
      [200, { hash: LOCAL }],
      [422, { type: NEWER_NODE_TYPE, action: 'fix_request' }],
      [422, { type: IN_FLIGHT_TYPE, action: 'in_progress' }]
    ] as const) {
      const answer = {
        ...(http(422, JSON.stringify(data)) as object),
        status,
        redirected: true
      };
      expect(classifyAnswer(answer).kind, String(status)).to.equal(
        'unknown'
      );
    }
  });

  it('a 2xx hash without 0x is the server hash as sent', function () {
    const outcome = classifyAnswer(
      http(200, JSON.stringify({ hash: LOCAL.slice(2) }))
    );
    expect(outcome).to.deep.include({
      kind: 'accepted',
      serverHash: LOCAL.slice(2)
    });
  });
});

describe('settle read results (the Rust SDK contract)', function () {
  it('maps not found, throttled and failed by the HTTP status and the node action', function () {
    const notFound = JSON.stringify({
      error_code: 'resource_transaction_not_found',
      message: 'm'
    });
    const retryLater = JSON.stringify({
      type: NEWER_NODE_TYPE,
      action: 'retry_later'
    });
    expect(readResult(http(404, notFound))).to.equal('not_found');
    expect(readResult(http(429, ''))).to.equal('throttled');
    expect(readResult(http(503, retryLater))).to.equal('throttled');
    expect(readResult(http(404, retryLater))).to.equal('throttled');
    expect(readResult(http(502, 'bad gateway'))).to.equal('failed');
    expect(readResult(http(400, notFound))).to.equal('failed');
    expect(readResult(TRANSPORT)).to.equal('failed');
  });

  it('reads no status from a 2xx body', function () {
    for (const status of [404, 429]) {
      expect(
        readResult(http(200, JSON.stringify({ status })))
      ).to.equal('failed');
    }
  });
});

// --- Properties ---

const ANY_STATUS = fc.oneof(
  fc.constantFrom(
    100, 199, 200, 299, 300, 399, 400, 407, 408, 409, 421, 422,
    423, 499, 500, 599
  ),
  fc.integer({ min: 100, max: 599 })
);

const ANY_ACTION = fc.option(
  fc.oneof(
    fc.constantFrom(
      ...CLIENT_ACTIONS,
      'IN_PROGRESS',
      ''
    ),
    fc.string(),
    fc.constant(null),
    fc.integer()
  ),
  { nil: undefined }
);

const ANY_TX_HASH = fc.option(
  fc.oneof(
    fc.constantFrom(
      LOCAL,
      `0x${LOCAL.slice(2).toUpperCase()}`,
      `0X${LOCAL.slice(2)}`,
      LOCAL.slice(2),
      OTHER,
      null
    ),
    fc.nat(),
    fc.string()
  ),
  { nil: undefined }
);

const ANY_ERROR_CODE = fc.option(
  fc.oneof(
    fc.constant('business_transaction_failed'),
    fc.string(),
    fc.constant(422)
  ),
  { nil: undefined }
);

const ANY_HASH = fc.option(fc.constantFrom(LOCAL, 1), {
  nil: undefined
});

// Types that the node never sends, or a `type` member that is
// not a string.
const TYPE_NOT_THE_NODES = fc.option(
  fc.oneof(
    fc.constantFrom(
      null,
      7,
      'https://httpproblems.com/http-status/429',
      'urn:future',
      'https://developer.1moneynetwork.com/problem',
      'https://developer.1moneynetwork.com/problems/nonce_too_low',
      'HTTPS://DEVELOPER.1MONEYNETWORK.COM/problem/nonce_too_low',
      'about:blank#x',
      ''
    ),
    fc
      .string()
      .filter(
        type =>
          !type.startsWith(TYPE_PREFIX) && type !== 'about:blank'
      )
  ),
  { nil: undefined }
);

const ANY_TYPE = fc.oneof(
  fc.constantFrom(NEWER_NODE_TYPE, IN_FLIGHT_TYPE, 'about:blank'),
  TYPE_NOT_THE_NODES
);

const BYTES_REASONS = [
  'Failed to recover REST envelope: invalid signature bytes',
  'Zero sender',
  'Transaction signature is malformed: Other error: batch payment operations must not be empty',
  'Internal error: batch payment total amount overflow'
];
const LEGACY_REASONS = [
  ...BYTES_REASONS,
  'already inflight; please retry later',
  'nonce already used; state advanced'
];
const ANY_MESSAGE = fc.oneof(
  fc.string(),
  fc.constantFrom(...LEGACY_REASONS).map(pinned),
  fc.constantFrom(...LEGACY_REASONS)
);

interface Body {
  hash?: unknown;
  type?: unknown;
  action?: unknown;
  tx_hash?: unknown;
  error_code?: unknown;
  message: string;
}

const ANY_BODY: fc.Arbitrary<Body> = fc.record({
  hash: ANY_HASH,
  type: ANY_TYPE,
  action: ANY_ACTION,
  tx_hash: ANY_TX_HASH,
  error_code: ANY_ERROR_CODE,
  message: ANY_MESSAGE
});

// JSON.stringify leaves out a member whose value is undefined.
function render(body: Body): string {
  return JSON.stringify(body);
}

// A lowercase "0x" prefix or none, hex digits in any case.
function namesLocalHash(txHash: string): boolean {
  const digits = txHash.startsWith('0x') ? txHash.slice(2) : txHash;
  return digits.toLowerCase() === LOCAL.slice(2).toLowerCase();
}

// The safety property, stated as conditions, not as ordered
// rules.
function expectedKind(status: number, body: Body): string {
  const is2xx = status >= 200 && status <= 299;
  const typeOfTheNode =
    typeof body.type === 'string' &&
    (body.type.startsWith(TYPE_PREFIX) ||
      body.type === 'about:blank');
  const action =
    typeOfTheNode && typeof body.action === 'string'
      ? body.action
      : undefined;
  const inProgressHere =
    action === 'in_progress' &&
    (body.tx_hash === undefined ||
      (typeof body.tx_hash === 'string' &&
        namesLocalHash(body.tx_hash)));
  if (is2xx && typeof body.hash === 'string') return 'accepted';
  // One intended difference from the Rust SDK: the node never
  // redirects a submit, so any 3xx is unknown, even with an action.
  if (status >= 300 && status <= 399) return 'unknown';
  if (action !== undefined && NO_EFFECT.includes(action)) {
    return 'rejected';
  }
  if (inProgressHere) return 'locked';
  return 'unknown';
}

function submitShape(answer: unknown): [string, boolean] {
  const outcome = classifyAnswer(answer);
  return [outcome.kind, isNonceUsed(outcome)];
}

describe('submit classification properties (the Rust SDK contract)', function () {
  it('a missing or unusable action cannot prove rejection', function () {
    const unusable = fc.option(
      fc
        .jsonValue({ maxDepth: 3 })
        .filter(
          value =>
            typeof value !== 'string' ||
            !CLIENT_ACTIONS.includes(value)
        ),
      { nil: undefined }
    );
    const anyJson = fc.option(fc.jsonValue({ maxDepth: 3 }), {
      nil: undefined
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 599 }),
        unusable,
        anyJson,
        anyJson,
        anyJson,
        anyJson,
        (status, action, code, message, type, txHash) => {
          const text = JSON.stringify({
            action,
            error_code: code,
            message,
            type,
            tx_hash: txHash
          });
          expect(kindOfText(status, text)).to.equal('unknown');
        }
      )
    );
  });

  it('JSON bodies follow the safety property', function () {
    fc.assert(
      fc.property(ANY_STATUS, ANY_BODY, (status, body) => {
        const text = render(body);
        const first = kindOfText(status, text);
        const second = kindOfText(status, text);
        expect(first).to.equal(second);
        expect(first).to.equal(expectedKind(status, body));
      })
    );
  });

  it('message text never changes the outcome', function () {
    fc.assert(
      fc.property(
        ANY_STATUS,
        ANY_BODY,
        fc.string(),
        (status, body, message) => {
          expect(
            submitShape(http(status, render({ ...body, message })))
          ).to.deep.equal(submitShape(http(status, render(body))));
        }
      )
    );
  });

  it('any text body without an object is unknown', function () {
    fc.assert(
      fc.property(ANY_STATUS, fc.string(), (status, text) => {
        const parsed = received(text);
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          expect(kindOfText(status, text)).to.equal('unknown');
        }
      })
    );
  });

  it('answers without the node statement classify as an empty body', function () {
    fc.assert(
      fc.property(
        ANY_STATUS,
        TYPE_NOT_THE_NODES,
        ANY_ACTION,
        ANY_TX_HASH,
        ANY_ERROR_CODE,
        ANY_MESSAGE,
        (status, type, action, txHash, errorCode, message) => {
          const answer = http(
            status,
            JSON.stringify({
              type,
              action,
              tx_hash: txHash,
              error_code: errorCode,
              message
            })
          );
          const empty = http(status, '');
          expect(submitShape(answer)).to.deep.equal(
            submitShape(empty)
          );
          expect(readResult(answer)).to.equal(readResult(empty));
        }
      )
    );
  });
});
