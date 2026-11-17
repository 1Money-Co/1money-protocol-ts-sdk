## Client
The `client` module is a comprehensive wrapper around `axios` for handling HTTP requests in a structured and consistent way. It provides a flexible API for making HTTP requests with built-in support for error handling, logging, and customizable success, failure, and timeout behaviors. This utility simplifies API interactions and helps in maintaining consistent request handling across the application.

### Usage
#### Configuration
```typescript
import { setInitConfig } from '@1money/protocol-ts-sdk';

setInitConfig({
  isSuccess: (res = {}, status) => status === 200 && res?.code == 0,
  timeout: 10000
});
```

#### Basic
```typescript
import { get, post } from '@1money/protocol-ts-sdk';

get('/api/data')
  .success(response => {
    console.log('Data received:', response);
  })
  .timeout(() => {
    console.error('Request timed out');
  })
  .error(error => {
    console.error('An unexpected error occurred:', error);
  });

post('/api/data', { key: 'value' }, {
  headers: {
    'Authorization': 'Bearer token xxxx'
  },
  // Override default timeout for this request
  timeout: 5000
})
  .success(response => {
    console.log('Custom configuration success:', response);
  })
  .error(error => {
    console.error('Custom configuration error:', error);
  });
```

A rejected request writes one `console.error` line before its handlers run.
Pass `quietStatuses` to stop that line for the HTTP statuses that are an
expected answer for the request, such as a 404 while a receipt is not there
yet. Other statuses and a network error still log. Expiry of the request
`timeout` writes no line, with or without the option: it calls the timeout
handler:

```typescript
get(`/v1/transactions/receipt/by_hash?hash=${hash}`, { quietStatuses: [404] });
```

#### Making Other HTTP Requests
The module also supports `PUT`, `PATCH`, and `DELETE` methods in a similar manner:

```typescript
import { put, patch, del } from '@1money/protocol-ts-sdk/utils';

put(url, data, options);

patch(url, data, options);

del(url, data, options);
```

These methods follow the same pattern as get and post, allowing you to handle different outcomes with chained handlers.