import { _typeof } from '@/utils';
import axios from 'axios';

import type { AxiosError, AxiosRequestConfig, AxiosRequestHeaders, AxiosResponse, AxiosResponseHeaders, AxiosStatic, RawAxiosRequestHeaders, RawAxiosResponseHeaders } from 'axios';

export type ParsedError<T extends string = string> = {
  name: T;
  message: string;
  stack: string;
  status: number;
  data?: any;
};

export type ResponseData<T = null> = {
  code: number | `${number}` | string;
  data: T;
  msg: null | string;
}

export type CustomResponseData<T, U, Y = T> = T extends 'custom'
  ? CheckAny<T> extends false
  ? unknown extends U
  ? CheckAny<U> extends false
  ? ResponseData<Y>
  : U
  : U
  : ResponseData<Y>
  : ResponseData<Y>;

export type CheckNever<T> = T extends never ? true : false;

export type CheckAny<T> = CheckNever<T> extends false ? false : true;

export type WithFailureData<T = undefined> = T extends null ? null | undefined : T | null | undefined;

export interface ChainName {
  // eslint-disable-next-line max-len
  all: ChainName['success'] | ChainName['failure'] | ChainName['error'] | ChainName['login'] | ChainName['timeout'];
  // one
  success: 'success';
  failure: 'failure';
  error: 'error';
  login: 'login';
  timeout: 'timeout';
  // n - 1
  withoutS: Exclude<ChainName['all'], 'success'>;
  withoutF: Exclude<ChainName['all'], 'failure'>;
  withoutE: Exclude<ChainName['all'], 'error'>;
  withoutL: Exclude<ChainName['all'], 'login'>;
  withoutT: Exclude<ChainName['all'], 'timeout'>;
  // n - 2
  withoutSF: Exclude<ChainName['all'], 'success' | 'failure'>;
  withoutSE: Exclude<ChainName['all'], 'success' | 'error'>;
  withoutSL: Exclude<ChainName['all'], 'success' | 'login'>;
  withoutST: Exclude<ChainName['all'], 'success' | 'timeout'>;
  withoutFE: Exclude<ChainName['all'], 'failure' | 'error'>;
  withoutFL: Exclude<ChainName['all'], 'failure' | 'login'>;
  withoutFT: Exclude<ChainName['all'], 'failure' | 'timeout'>;
  withoutEL: Exclude<ChainName['all'], 'error' | 'login'>;
  withoutET: Exclude<ChainName['all'], 'error' | 'timeout'>;
  withoutLT: Exclude<ChainName['all'], 'login' | 'timeout'>;
  // two
  withSF: ChainName['success'] | ChainName['failure'];
  withSE: ChainName['success'] | ChainName['error'];
  withSL: ChainName['success'] | ChainName['login'];
  withST: ChainName['success'] | ChainName['timeout'];
  withFE: ChainName['failure'] | ChainName['error'];
  withFL: ChainName['failure'] | ChainName['login'];
  withFT: ChainName['failure'] | ChainName['timeout'];
  withEL: ChainName['error'] | ChainName['login'];
  withET: ChainName['error'] | ChainName['timeout'];
  withLT: ChainName['login'] | ChainName['timeout'];
}

export interface ChainReturn<T, U> {
  success: CustomResponseData<T, U>;
  failure: CustomResponseData<T, U, WithFailureData>;
  error: ParsedError;
  login: CustomResponseData<T, U, WithFailureData> | ParsedError;
  timeout: ParsedError<'timeout'>;
  successOrFailure: CustomResponseData<T, U, WithFailureData<T>>;
  all: CustomResponseData<T, U, WithFailureData<T>> | ParsedError | ParsedError<'timeout'>;
}

export type AxiosReqHeaders = RawAxiosRequestHeaders | AxiosRequestHeaders;
export type AxiosResHeaders = RawAxiosResponseHeaders | AxiosResponseHeaders;

export interface InitConfig<T = any, U = unknown> {
  onSuccess?: (res: ChainReturn<T, U>['success'], headers: AxiosResHeaders) => any;
  onFailure?: (res: ChainReturn<T, U>['failure'], headers: AxiosResHeaders) => any;
  onLogin?: (res: ChainReturn<T, U>['login'], headers: AxiosResHeaders) => any;
  onError?: (res: ChainReturn<T, U>['error'], headers: AxiosReqHeaders | AxiosResHeaders) => any;
  onTimeout?: (e: ChainReturn<T, U>['timeout'], headers: AxiosReqHeaders) => any;
  isSuccess?: (res: ResponseData<WithFailureData<T>>, status: number, headers: AxiosResHeaders) => boolean;
  isLogin?: (res: ResponseData<WithFailureData<T>>, status: number, headers: AxiosResHeaders) => boolean;
  timeout?: number;
  baseURL?: string;
}

export interface Options<T, U = unknown> extends InitConfig<T, U>, AxiosRequestConfig { }

export type FactoryType = 'success' | 'failure' | 'error' | 'login';

export type ErrorParams = {
  status: number;
  netWorkError: boolean;
  data: Record<string, any>;
};

export interface ErrorData extends Record<string, any> {
  status: number;
}

export type ErrorRes = {
  message: string;
  data: ErrorData;
};

export type RestScopeName = ChainName['all'];

export type RestScope = Readonly<[RestScopeName, RestScopeName?, RestScopeName?, RestScopeName?, RestScopeName?]>;

type Tuple2Record<T extends readonly any[]> = {
  [Value in T[number]]: Value
};

export interface PromiseWrapper<
  T,
  U,
  TSuc = ChainReturn<T, U>['success'],
  TFail = ChainReturn<T, U>['failure'],
  TErr = ChainReturn<T, U>['error'],
  TLogin = ChainReturn<T, U>['login'],
  TTime = ChainReturn<T, U>['timeout'],
  HadCall extends string = ''
> {
  success<TRes = TSuc, Delete extends string = HadCall | 'success'>(
    onSuccess?: (res: ChainReturn<T, U>['success'], headers: AxiosResHeaders) => TRes,
  ): Omit<
    PromiseWrapper<T, U, TRes, TFail, TErr, TLogin, TTime, Delete>,
    ChainName['withoutS'] extends HadCall ? Delete | 'rest' : Delete
  > &
    Promise<TRes | TFail | TErr | TLogin | TTime>;
  failure<TRes = TFail, Delete extends string = HadCall | 'failure'>(
    onFailure?: (res: ChainReturn<T, U>['failure'], headers: AxiosResHeaders) => TRes,
  ): Omit<
    PromiseWrapper<T, U, TSuc, TRes, TErr, TLogin, TTime, Delete>,
    ChainName['withoutF'] extends HadCall ? Delete | 'rest' : Delete
  > &
    Promise<TSuc | TRes | TErr | TLogin | TTime>;
  error<TRes = TErr, Delete extends string = HadCall | 'error'>(
    onError?: (err: ChainReturn<T, U>['error'], headers: AxiosReqHeaders | AxiosResHeaders) => TRes,
  ): Omit<
    PromiseWrapper<T, U, TSuc, TFail, TRes, TLogin, TTime, Delete>,
    ChainName['withoutE'] extends HadCall ? Delete | 'rest' : Delete
  > &
    Promise<TSuc | TFail | TRes | TLogin | TTime>;
  login<TRes = TLogin, Delete extends string = HadCall | 'login'>(
    onLogin?: (res: ChainReturn<T, U>['login'], headers: AxiosResHeaders) => TRes,
  ): Omit<
    PromiseWrapper<T, U, TSuc, TFail, TErr, TRes, TTime, Delete>,
    ChainName['withoutL'] extends HadCall ? Delete | 'rest' : Delete
  > &
    Promise<TSuc | TFail | TErr | TRes | TTime>;
  timeout<TRes = TTime, Delete extends string = HadCall | 'timeout'>(
    onTimeout?: (err: ChainReturn<T, U>['timeout'], headers: AxiosReqHeaders) => TRes,
  ): Omit<
    PromiseWrapper<T, U, TSuc, TFail, TErr, TLogin, TRes, Delete>,
    ChainName['withoutT'] extends HadCall ? Delete | 'rest' : Delete
  > &
    Promise<TSuc | TFail | TErr | TLogin | TRes>;
  rest<
    TRes = TSuc | TFail | TErr | TLogin | TTime,
    TRestScope extends RestScope = ['success', 'failure', 'login', 'error', 'timeout'],
    TRestScopeName extends RestScopeName = Exclude<keyof Tuple2Record<TRestScope>, undefined>,
    THadCallWithNotInScope extends string = HadCall | Exclude<RestScopeName, TRestScopeName>,
    Delete extends string = HadCall | TRestScopeName | 'rest'
  >(
    onRest?: (
      val: ChainName['all'] extends THadCallWithNotInScope
        ? unknown
        : ChainName['withoutS'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['success']
        : ChainName['withoutF'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['failure']
        : ChainName['withoutE'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['error']
        : ChainName['withoutL'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['login']
        : ChainName['withoutT'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['timeout']
        : ChainName['withoutSF'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['successOrFailure']
        : ChainName['withoutSE'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['success' | 'error']
        : ChainName['withoutSL'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['success' | 'login']
        : ChainName['withoutST'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['success' | 'timeout']
        : ChainName['withoutFE'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['failure' | 'error']
        : ChainName['withoutFL'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['failure' | 'login']
        : ChainName['withoutFT'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['failure' | 'timeout']
        : ChainName['withoutEL'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['error' | 'login']
        : ChainName['withoutET'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['error' | 'timeout']
        : ChainName['withoutLT'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['login' | 'timeout']
        : ChainName['withSF'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['error' | 'login' | 'timeout']
        : ChainName['withSE'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['failure' | 'login' | 'timeout']
        : ChainName['withSL'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['failure' | 'error' | 'timeout']
        : ChainName['withST'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['failure' | 'error' | 'login']
        : ChainName['withFE'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['success' | 'login' | 'timeout']
        : ChainName['withFL'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['success' | 'error' | 'timeout']
        : ChainName['withFT'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['success' | 'error' | 'login']
        : ChainName['withEL'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['successOrFailure' | 'timeout']
        : ChainName['withET'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['successOrFailure' | 'login']
        : ChainName['withLT'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['successOrFailure' | 'error']
        : ChainName['success'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['failure' | 'error' | 'login' | 'timeout']
        : ChainName['failure'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['success' | 'error' | 'login' | 'timeout']
        : ChainName['error'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['successOrFailure' | 'login' | 'timeout']
        : ChainName['login'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['successOrFailure' | 'error' | 'timeout']
        : ChainName['timeout'] extends THadCallWithNotInScope
        ? ChainReturn<T, U>['successOrFailure' | 'error' | 'login']
        : ChainReturn<T, U>['all'],
      headers: AxiosReqHeaders | AxiosResHeaders
    ) => TRes,
    scope?: TRestScope,
  ): Omit<PromiseWrapper<T, U, TSuc, TFail, TErr, TLogin, TTime, Delete>, Delete> &
    Promise<
      ChainName['all'] extends THadCallWithNotInScope
      ? TSuc | TFail | TErr | TLogin | TTime
      : ChainName['withoutS'] extends THadCallWithNotInScope
      ? TRes | TFail | TErr | TLogin | TTime
      : ChainName['withoutF'] extends THadCallWithNotInScope
      ? TSuc | TRes | TErr | TLogin | TTime
      : ChainName['withoutE'] extends THadCallWithNotInScope
      ? TSuc | TFail | TRes | TLogin | TTime
      : ChainName['withoutL'] extends THadCallWithNotInScope
      ? TSuc | TFail | TErr | TRes | TTime
      : ChainName['withoutT'] extends THadCallWithNotInScope
      ? TSuc | TFail | TErr | TLogin | TRes
      : ChainName['withoutSF'] extends THadCallWithNotInScope
      ? TRes | TErr | TLogin | TTime
      : ChainName['withoutSE'] extends THadCallWithNotInScope
      ? TRes | TFail | TLogin | TTime
      : ChainName['withoutSL'] extends THadCallWithNotInScope
      ? TRes | TFail | TErr | TTime
      : ChainName['withoutST'] extends THadCallWithNotInScope
      ? TRes | TFail | TErr | TLogin
      : ChainName['withoutFE'] extends THadCallWithNotInScope
      ? TSuc | TRes | TLogin | TTime
      : ChainName['withoutFL'] extends THadCallWithNotInScope
      ? TSuc | TRes | TErr | TTime
      : ChainName['withoutFT'] extends THadCallWithNotInScope
      ? TSuc | TRes | TErr | TLogin
      : ChainName['withoutEL'] extends THadCallWithNotInScope
      ? TSuc | TFail | TRes | TTime
      : ChainName['withoutET'] extends THadCallWithNotInScope
      ? TSuc | TFail | TRes | TLogin
      : ChainName['withoutLT'] extends THadCallWithNotInScope
      ? TSuc | TFail | TErr | TRes
      : ChainName['withSF'] extends THadCallWithNotInScope
      ? TSuc | TFail | TRes
      : ChainName['withSE'] extends THadCallWithNotInScope
      ? TSuc | TErr | TRes
      : ChainName['withSL'] extends THadCallWithNotInScope
      ? TSuc | TLogin | TRes
      : ChainName['withST'] extends THadCallWithNotInScope
      ? TSuc | TTime | TRes
      : ChainName['withFE'] extends THadCallWithNotInScope
      ? TFail | TErr | TRes
      : ChainName['withFL'] extends THadCallWithNotInScope
      ? TFail | TLogin | TRes
      : ChainName['withFT'] extends THadCallWithNotInScope
      ? TFail | TTime | TRes
      : ChainName['withEL'] extends THadCallWithNotInScope
      ? TErr | TLogin | TRes
      : ChainName['withET'] extends THadCallWithNotInScope
      ? TErr | TTime | TRes
      : ChainName['withLT'] extends THadCallWithNotInScope
      ? TLogin | TTime | TRes
      : ChainName['success'] extends THadCallWithNotInScope
      ? TSuc | TRes
      : ChainName['failure'] extends THadCallWithNotInScope
      ? TFail | TRes
      : ChainName['error'] extends THadCallWithNotInScope
      ? TErr | TRes
      : ChainName['login'] extends THadCallWithNotInScope
      ? TLogin | TRes
      : ChainName['timeout'] extends THadCallWithNotInScope
      ? TTime | TRes
      : TRes
    >;
}

class ResponsePromise<T, U> {
  public _success: Parameters<PromiseWrapper<T, U>['success']>[0];

  public _failure: Parameters<PromiseWrapper<T, U>['failure']>[0];

  public _error: Parameters<PromiseWrapper<T, U>['error']>[0];

  public _login: Parameters<PromiseWrapper<T, U>['login']>[0];

  public _timeout: Parameters<PromiseWrapper<T, U>['timeout']>[0];

  public _rest?: Parameters<PromiseWrapper<T, U>['rest']>[0];

  public _resolve?: ((value: any) => void);

  public _reject?: ((reason?: any) => void);

  public promiseWrapper: PromiseWrapper<T, U> & Promise<CustomResponseData<T, U, WithFailureData<T>>>;

  public _restScope: RestScope;

  public constructor() {
    this.promiseWrapper = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    }) as any;

    this._restScope = ['success', 'failure', 'error', 'login', 'timeout'];

    for (let i = 0; i < this._restScope.length; i++) {
      const method = this._restScope[i];
      if (!method) continue;
      this.promiseWrapper[method] = _callback => {
        // @ts-ignore
        if (typeof _callback === 'function') this[`_${method}`] = _callback;
        const wrapper = this.promiseWrapper as any;
        delete wrapper[method];
        const methods = this._restScope.slice();
        methods.splice(methods.indexOf(method), 1);
        if (methods.every(_m => !!_m && !wrapper[_m])) delete wrapper.rest;
        return wrapper;
      };
    }

    this.promiseWrapper.rest = (onRest, scope) => {
      // @ts-ignore
      if (typeof onRest === 'function') this._rest = onRest;
      const wrapper = this.promiseWrapper as any;
      delete wrapper.rest;
      this._restScope = scope || this._restScope;
      // @ts-ignore
      if (this._restScope.length === 0) {
        console.warn('[1Money client]: The ".rest(cb, scope)" scope is empty and will never be triggered!');
      } else {
        let deletedCounter = 0;
        this._restScope.forEach(method => {
          if (!method) return;
          if (wrapper[method]) {
            delete wrapper[method];
          } else {
            deletedCounter++;
          }
        });
        if (deletedCounter === this._restScope.length) {
          console.warn(
            `[1Money client]: The "${this._restScope.join(
              ', ',
            )}" had been called and the "rest" will never be triggered!`,
          );
        }
      }
      return wrapper;
    };
  }
}

export class Request {
  private _config: InitConfig;

  public axios: AxiosStatic;

  public constructor(config?: InitConfig) {
    this._config = config || {};

    this.axios = axios;
    this.parseError = this.parseError.bind(this);
    this.setting = this.setting.bind(this);
    this.request = this.request.bind(this);
  }

  private parseError(err: any): ParsedError {
    if (typeof err === 'string') err = new Error(err);

    // Ensure we have a valid error object
    if (!err || (_typeof(err) !== 'object' && _typeof(err) !== 'error')) {
      err = new Error('Unknown error occurred');
    }

    const name: string = err?.name ?? 'Error';
    const message: string = err?.message ?? err?.toString?.() ?? 'Unknown error';
    const stack: string = err?.stack ?? '';
    const status = err?.response?.status ?? 500;
    const data = err?.response?.data ?? undefined;

    // Validate status code
    if (typeof status !== 'number' || status < 100 || status > 599) {
      return {
        name: 'InvalidStatusError',
        message: 'Invalid HTTP status code',
        stack,
        status: 500,
        data
      };
    }

    return {
      name,
      message,
      stack,
      status,
      data
    };
  }

  public setting(config: InitConfig) {
    if (!config) return console.warn('[1Money client]: setting method required correct parameters!');
    this._config = { ...this._config, ...config };
  }

  public request<T, U = unknown>(options: Options<T, U>): PromiseWrapper<T, U> & Promise<CustomResponseData<T, U, WithFailureData<T>>> {
    // Set default security headers
    options.withCredentials = typeof options.withCredentials === 'boolean' ? options.withCredentials : true;
    options.headers = {
      ...this.axios.defaults.headers.common,
      ...(options.method ? (this.axios.defaults.headers[options.method] as RawAxiosRequestHeaders) : {}),
      ...options.headers,
    };
    options.headers['Accept'] = options.headers['Accept'] || '*/*';
    options.headers['X-Requested-With'] = options.headers['X-Requested-With'] || 'XMLHttpRequest';
    options.headers['X-Content-Type-Options'] = options.headers['X-Content-Type-Options'] || 'nosniff';

    const {
      onSuccess: initOnSuccess,
      onFailure: initOnFailure,
      onLogin: initOnLogin,
      onError: initOnError,
      onTimeout: initOnTimeout,
      isSuccess: initIsSuccess,
      isLogin: initIsLogin,
      timeout: initTimeout,
    } = this._config as InitConfig<T, U>;
    const {
      onSuccess,
      onFailure,
      onLogin,
      onError,
      onTimeout,
      isSuccess,
      isLogin,
      timeout,
    } = options;
    const rules = {
      success: isSuccess ?? initIsSuccess,
      login: isLogin ?? initIsLogin,
    };

    const ResPromise = new ResponsePromise<T, U>();

    Promise.resolve().then(() => {
      const callbacks = {
        success:
          ResPromise._success ??
          (~ResPromise._restScope.indexOf('success') ? ResPromise._rest : undefined) ??
          onSuccess ??
          initOnSuccess ??
          ((r: ChainReturn<T, U>['success'], h: AxiosResHeaders) => r),
        failure:
          ResPromise._failure ??
          (~ResPromise._restScope.indexOf('failure') ? ResPromise._rest : undefined) ??
          onFailure ??
          initOnFailure ??
          ((v: ChainReturn<T, U>['failure'], h: AxiosResHeaders) => v),
        error:
          ResPromise._error ??
          (~ResPromise._restScope.indexOf('error') ? ResPromise._rest : undefined) ??
          onError ??
          initOnError ??
          ((v: ChainReturn<T, U>['error'], h: AxiosResHeaders) => v),
        login:
          ResPromise._login ??
          (~ResPromise._restScope.indexOf('login') ? ResPromise._rest : undefined) ??
          onLogin ??
          initOnLogin ??
          ((v: ChainReturn<T, U>['login'], h: AxiosResHeaders) => v),
        timeout:
          ResPromise._timeout ??
          (~ResPromise._restScope.indexOf('timeout') ? ResPromise._rest : undefined) ??
          onTimeout ??
          initOnTimeout ??
          ((v: ChainReturn<T, U>['timeout'], h: AxiosReqHeaders) => v),
      };

      const existedHandler = {
        success: !!(
          ResPromise._success ||
          (ResPromise._rest && ~ResPromise._restScope.indexOf('success')) ||
          onSuccess ||
          initOnSuccess
        ),
        failure: !!(
          ResPromise._failure ||
          (ResPromise._rest && ~ResPromise._restScope.indexOf('failure')) ||
          onFailure ||
          initOnFailure
        ),
        login: !!(
          ResPromise._login ||
          (ResPromise._rest && ~ResPromise._restScope.indexOf('login')) ||
          onLogin ||
          initOnLogin
        ),
        error: !!(
          ResPromise._error ||
          (ResPromise._rest && ~ResPromise._restScope.indexOf('error')) ||
          onError ||
          initOnError
        ),
        timeout: !!(
          ResPromise._timeout ||
          (ResPromise._rest && ~ResPromise._restScope.indexOf('timeout')) ||
          onTimeout ||
          initOnTimeout
        ),
      };

      const existedChainHandler = {
        success: !!(
          ResPromise._success ||
          (ResPromise._rest && ~ResPromise._restScope.indexOf('success'))
        ),
        failure: !!(
          ResPromise._failure ||
          (ResPromise._rest && ~ResPromise._restScope.indexOf('failure'))
        ),
        login: !!(
          ResPromise._login ||
          (ResPromise._rest && ~ResPromise._restScope.indexOf('login'))
        ),
        error: !!(
          ResPromise._error ||
          (ResPromise._rest && ~ResPromise._restScope.indexOf('error'))
        ),
        timeout: !!(
          ResPromise._timeout ||
          (ResPromise._rest && ~ResPromise._restScope.indexOf('timeout'))
        ),
      };

      const errorHandler = async (e: any, headers: AxiosReqHeaders | AxiosResHeaders) => {
        try {
          let err = this.parseError(e);
          const result = await Promise.resolve(callbacks.error(err, headers));
          if (existedChainHandler.error) err = result;
          existedHandler.error ? ResPromise._resolve!(err) : ResPromise._reject!(err);
        } catch (_e) {
          ResPromise._reject!(this.parseError(_e));
        }
      };

      let timer: any = null;
      let isTimeout = false;
      const _timeout = timeout ?? initTimeout;

      // Cleanup function for timeout
      const cleanup = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      };

      if (_timeout) {
        timer = setTimeout(async () => {
          try {
            isTimeout = true;
            cleanup();
            let err = this.parseError('timeout') as ParsedError<'timeout'>;
            // @ts-ignore
            const res = await Promise.resolve(callbacks.timeout(err, options.headers ?? {}));
            if (existedChainHandler.timeout) err = res;
            existedHandler.timeout ? ResPromise._resolve!(err) : ResPromise._reject!(err);
          } catch (e) {
            errorHandler(e, options.headers ?? {});
          }
        }, _timeout);
      }

      this.axios<any, AxiosResponse<ResponseData<WithFailureData<T>>, any>, any>(options).then(async response => {
        if (isTimeout) return;
        cleanup();

        const { status, data, headers } = response;
        try {
          const doSuccess = rules.success?.(data, status, headers);
          const doLogin = rules.login?.(data, status, headers);

          let res = data;
          if (doLogin) {
            const result = await Promise.resolve(callbacks.login(data as ChainReturn<T, U>['login'], headers));
            if (existedChainHandler.login) res = result;
          } else if (doSuccess) {
            const result = await Promise.resolve(callbacks.success(data as ChainReturn<T, U>['success'], headers));
            if (existedChainHandler.success) res = result;
          } else {
            const result = await Promise.resolve(callbacks.failure(data as ChainReturn<T, U>['failure'], headers));
            if (existedChainHandler.failure) res = result;
          }
          ResPromise._resolve!(res);
        } catch (e) {
          errorHandler(e, headers);
        }
      }).catch(async (err: AxiosError<any>) => {
        if (isTimeout) return;
        cleanup();

        const data = err.response?.data ?? {};
        console.error(`[1Money client]: Error(${err.status ?? 500}, ${err.code ?? 'UNKNOWN'}), Message: ${err.message}, Config: ${err.config?.method}, ${err.config?.baseURL ?? ''}, ${err.config?.url ?? ''}, ${JSON.stringify(err.config?.headers ?? {})}, Request: ${JSON.stringify(err.config?.data ?? {})}, Response: ${JSON.stringify(data)};`);

        const status = err.response?.status ?? 500;
        const headers = err.response?.headers ?? {};

        try {
          let res = data;
          const doLogin = rules.login?.(data, status, headers);
          if (doLogin) {
            res = await Promise.resolve(callbacks.login(res, headers));
            ResPromise._resolve!(res);
          } else {
            errorHandler(err, headers);
          }
        } catch (e) {
          errorHandler(e, headers);
        }
      });
    });

    return ResPromise.promiseWrapper;
  }
}

export default Request;
