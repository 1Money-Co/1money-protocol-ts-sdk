import { api } from './api';
import client from './client';

export { api } from './api';
export { default as client } from './client';
export * from './signing';
export * from './utils';
export * from './api/errors';
export type { ClientAction } from './api/problem';
export { settle, submitAndSettle } from './api/settle';
export type {
  SettledTransaction,
  SettleObservation,
  SettleOptions
} from './api/settle';

export type { AxiosStatic } from 'axios';
export type { InitConfig, Options, ParsedError, PromiseWrapper } from './client/core';

export default {
  api,
  client,
};
