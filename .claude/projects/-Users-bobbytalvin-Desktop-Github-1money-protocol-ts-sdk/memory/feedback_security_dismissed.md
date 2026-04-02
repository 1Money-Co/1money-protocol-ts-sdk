---
name: dismissed-security-findings
description: Security issues intentionally kept as-is in the SDK client — do not re-flag in future reviews
type: feedback
---

## Loose equality (`==`) in default client predicates is intentional

`res.code == 0` and `res.code == 401` in `src/client/index.ts` must use loose equality (`==`), not strict (`===`).

**Why:** `ResponseData.code` is typed `number | ${number} | string`. The API may return `"0"` or `"401"` as strings. Strict equality would silently misclassify those responses, breaking every consumer using the default predicates.

**How to apply:** Do not flag this as a type-coercion bug in security or code reviews.

## `withCredentials: true` default in core client is intentional

The default in `src/client/core.ts` is `withCredentials: true`.

**Why:** The generic client (`get`/`post`/`Request.request()`) is used by consumers against session- or CSRF-protected endpoints in browsers. Flipping to `false` silently stops sending cookies, causing 401/403 failures. The high-level protocol API modules already explicitly set `withCredentials: false` where appropriate, so the core default doesn't affect them.

**How to apply:** Do not flag the `withCredentials: true` default as a security issue. The protocol API layer handles this correctly.
