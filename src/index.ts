import { api } from './api';
import client from './client';

export { api } from './api';
export { default as client } from './client';
export * from './signing';
export * from './utils';

export type { AxiosStatic } from 'axios';
export type { InitConfig, Options, ParsedError, PromiseWrapper } from './client/core';

export default {
  api,
  client,
};
