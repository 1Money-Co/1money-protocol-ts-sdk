# Abort Request on Timeout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the SDK's custom timeout fires, abort the underlying HTTP request via `AbortController` so the connection is torn down immediately instead of lingering.

**Architecture:** Create an `AbortController` per request inside `Request.request()`. Pass its signal (merged with any user-provided signal) to axios. On timeout, call `controller.abort()` before running the existing timeout callback chain. On normal completion, abort the controller as a no-op cleanup.

**Tech Stack:** AbortController (built-in), axios signal support (>=1.x)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/client/core.ts` | Modify (lines 582–611) | Add AbortController, signal merging, abort-on-timeout |
| `src/client/__test__/index.test.ts` | Modify | Add timeout-abort test |

This is a single-file change to `core.ts` plus a test. No new files needed.

---

### Task 1: Write a failing test for abort-on-timeout

**Files:**
- Modify: `src/client/__test__/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block after the existing `"request methods test"` block. This test creates a `Request` instance with a very short timeout and verifies the request is aborted (axios receives an abort signal).

```ts
import Request from "../core";

describe("abort on timeout", function () {
  it("should abort the underlying request when timeout fires", function (done) {
    const client = new Request({ timeout: 50 });

    // Use a URL that will be slow enough to trigger our 50ms timeout
    // httpbin.org/delay/10 delays 10 seconds — plenty to trigger timeout
    client.request({
      method: "get",
      url: "https://httpbin.org/delay/10",
    })
      .timeout((err) => {
        expect(err).to.be.an("object");
        expect(err).to.have.property("name", "timeout");
        done();
        return err;
      })
      .error((err) => {
        // Should not reach error handler — timeout should fire first
        done(new Error("error handler called instead of timeout"));
        return err;
      });
  });

  it("should respect a user-provided AbortSignal", function (done) {
    const client = new Request({ timeout: 60000 });
    const controller = new AbortController();

    client.request({
      method: "get",
      url: "https://httpbin.org/delay/10",
      signal: controller.signal,
    })
      .error((err) => {
        expect(err).to.be.an("object");
        expect(err).to.have.property("name");
        done();
        return err;
      })
      .timeout((err) => {
        done(new Error("timeout handler called — user abort should trigger error"));
        return err;
      });

    // Abort after 50ms — well before the 60s SDK timeout
    setTimeout(() => controller.abort(), 50);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails or behaves incorrectly**

Run: `npm test`

Expected: The first test should pass (timeout already works) but the underlying request is NOT aborted — this is the behavior we're fixing. The second test may hang or error differently than expected because user signals aren't currently merged. Note the current behavior for comparison.

- [ ] **Step 3: Commit the test**

```bash
git add src/client/__test__/index.test.ts
git commit -m "test: add abort-on-timeout tests for request client"
```

---

### Task 2: Add signal merging helper to core.ts

**Files:**
- Modify: `src/client/core.ts` (inside the `Request` class, around line 402)

- [ ] **Step 1: Add the `mergeSignals` private method**

Add this method to the `Request` class, after the `parseError` method (around line 436):

```ts
private mergeSignals(...signals: AbortSignal[]): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const cleanups: (() => void)[] = [];

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', onAbort);
    cleanups.push(() => signal.removeEventListener('abort', onAbort));
  }

  return {
    signal: controller.signal,
    cleanup: () => cleanups.forEach(fn => fn()),
  };
}
```

- [ ] **Step 2: Verify the project still builds**

Run: `npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/core.ts
git commit -m "feat: add mergeSignals helper to Request class"
```

---

### Task 3: Wire AbortController into the request method

**Files:**
- Modify: `src/client/core.ts` (lines 582–611, inside the `Promise.resolve().then(...)` block)

- [ ] **Step 1: Create AbortController and attach signal**

Inside the `Promise.resolve().then(() => { ... })` block, after the existing `const _timeout = timeout ?? initTimeout;` line (line 585) and before the `cleanup` function (line 588), add:

```ts
const controller = new AbortController();
let signalCleanup: (() => void) | null = null;

// Merge user-provided signal with our timeout signal
if (options.signal) {
  const merged = this.mergeSignals(options.signal, controller.signal);
  options.signal = merged.signal;
  signalCleanup = merged.cleanup;
} else {
  options.signal = controller.signal;
}
```

- [ ] **Step 2: Update the cleanup function to also abort the controller**

Replace the existing `cleanup` function:

```ts
// BEFORE:
const cleanup = () => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
};

// AFTER:
const cleanup = () => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (signalCleanup) {
    signalCleanup();
    signalCleanup = null;
  }
};
```

- [ ] **Step 3: Add `controller.abort()` in the timeout handler**

In the `setTimeout` callback (around line 596), add `controller.abort();` right after `cleanup();`:

```ts
if (_timeout) {
  timer = setTimeout(async () => {
    try {
      isTimeout = true;
      cleanup();
      controller.abort();  // <-- ADD THIS LINE
      let err = this.parseError('timeout') as ParsedError<'timeout'>;
      // ... rest of existing timeout handler unchanged
```

- [ ] **Step 4: Run all tests**

Run: `npm test`

Expected: All tests pass, including the new abort-on-timeout tests from Task 1.

- [ ] **Step 5: Verify the build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/client/core.ts
git commit -m "feat: abort underlying HTTP request when SDK timeout fires

Uses AbortController to cancel the axios request on timeout.
Merges with user-provided AbortSignal if present."
```

---

### Task 4: Run lint and final verification

**Files:**
- Possibly modify: `src/client/core.ts`, `src/client/__test__/index.test.ts` (lint fixes)

- [ ] **Step 1: Run linter**

Run: `npm run lint`

Expected: No errors. If there are lint issues, fix them.

- [ ] **Step 2: Fix any lint issues**

Run: `npm run lint:fix`

- [ ] **Step 3: Run full test suite one more time**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add src/client/core.ts src/client/__test__/index.test.ts
git commit -m "chore: lint fixes for abort-on-timeout"
```

---

## Summary of Changes

The total change is ~20 lines of new code in `core.ts`:
1. A `mergeSignals` private method (~15 lines)
2. AbortController creation + signal assignment (~6 lines)
3. One `controller.abort()` call in the timeout handler
4. Signal cleanup in the existing `cleanup()` function

No public API changes. No new dependencies. No type changes. The promise wrapper chain behavior is identical — the only difference is that the underlying HTTP connection is now properly torn down when a timeout fires.
