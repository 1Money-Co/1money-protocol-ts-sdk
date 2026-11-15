import { LOCAL_API_URL } from '../../../constants';
import { axiosStatic } from '../../../../client';
import {
  OPERATION_REGISTRY,
  prepareTransactionV2
} from '@/signing/v2';

import type {
  OperationName,
  OperationUnsignedMap
} from '@/signing/v2';
import type { Signature } from '@/utils';

type Adapter = typeof axiosStatic.defaults.adapter;

export const PROBLEM = 'https://developer.1moneynetwork.com/problem/';

export interface Answer {
  status: number;
  body: unknown;
}

export interface Post {
  path: string;
  operation: OperationName;
  body: Record<string, unknown>;
}

/** A GET answers with a fixed value, or one per call (the last repeats). */
export type GetRoute = Answer | Answer[];

/** A POST answers `accept` (200 with the hash the node computes) or an answer. */
export type PostAnswer = 'accept' | Answer;

export function ok(body: unknown): Answer {
  return { status: 200, body };
}

export function notFound(): Answer {
  return {
    status: 404,
    body: {
      type: `${PROBLEM}transaction_not_found`,
      action: 'check_status'
    }
  };
}

export function refusal(
  id: string,
  members: Record<string, unknown> = {},
  action = 'retry_later'
): Answer {
  return {
    status: 422,
    body: {
      type: `${PROBLEM}${id}`,
      title: id,
      status: 422,
      action,
      error_code: 'business_transaction_failed',
      message: id,
      ...members
    }
  };
}

function operationOf(path: string): OperationName {
  const entry = Object.entries(OPERATION_REGISTRY).find(
    ([, spec]) => spec.pathV2 === path
  );
  if (!entry) throw new Error(`mock node: no route ${path}`);
  return entry[0] as OperationName;
}

// The hash the node computes from the posted body: the unsigned
// fields, the memo and the single signature.
function hashOf(
  operation: OperationName,
  body: Record<string, unknown>
): string {
  const { memo, authorization, ...unsigned } = body as {
    memo: { type: string; format: string; data: string };
    authorization: { signature: Signature };
  };
  return prepareTransactionV2(
    operation,
    unsigned as unknown as OperationUnsignedMap[OperationName],
    { memo }
  ).authorize(authorization.signature).transactionHash;
}

function respond(config: unknown, answer: Answer) {
  if (answer.status < 400) {
    return Promise.resolve({
      data: answer.body,
      status: answer.status,
      statusText: 'OK',
      headers: {},
      config
    });
  }
  return Promise.reject({
    message: `Request failed with status code ${answer.status}`,
    name: 'AxiosError',
    config,
    response: {
      status: answer.status,
      statusText: 'Error',
      headers: {},
      config,
      data: answer.body
    }
  });
}

/**
 * A node behind the axios adapter. GET routes match on the path
 * before `?`; an unknown GET answers 404. POSTs answer in order.
 */
export class MockNode {
  readonly posts: Post[] = [];
  readonly gets: string[] = [];
  private readonly getCalls = new Map<string, number>();
  private originalAdapter: Adapter;
  private originalBaseURL?: string;

  constructor(
    public getRoutes: Record<string, GetRoute> = {},
    public postAnswers: PostAnswer[] = []
  ) {}

  install(): this {
    this.originalAdapter = axiosStatic.defaults.adapter;
    this.originalBaseURL = axiosStatic.defaults.baseURL;
    axiosStatic.defaults.baseURL = LOCAL_API_URL;
    axiosStatic.defaults.adapter = (config => {
      const url = String(config.url);
      if (config.method === 'post') {
        return this.post(config, url);
      }
      return this.get(config, url);
    }) as Adapter;
    return this;
  }

  uninstall(): void {
    axiosStatic.defaults.adapter = this.originalAdapter;
    axiosStatic.defaults.baseURL = this.originalBaseURL;
  }

  private get(config: unknown, url: string) {
    this.gets.push(url);
    const path = url.split('?')[0];
    const route = this.getRoutes[path];
    if (!route) return respond(config, notFound());
    if (!Array.isArray(route)) return respond(config, route);
    const call = this.getCalls.get(path) ?? 0;
    this.getCalls.set(path, call + 1);
    return respond(
      config,
      route[Math.min(call, route.length - 1)]
    );
  }

  private post(config: { data?: unknown }, url: string) {
    const body = JSON.parse(String(config.data));
    const operation = operationOf(url);
    this.posts.push({ path: url, operation, body });
    const answer =
      this.postAnswers[this.posts.length - 1] ?? 'accept';
    if (answer === 'accept') {
      return respond(
        config,
        ok({ hash: hashOf(operation, body) })
      );
    }
    return respond(config, answer);
  }
}
