#!/usr/bin/env bash
#
# Semgrep CE security scan — same ruleset locally and in CI.
#
#   ./scripts/security-scan.sh              # scan the repo
#   ./scripts/security-scan.sh --canary     # prove the ruleset still detects
#   ./scripts/security-scan.sh --sarif out.sarif
#
# Rules come from semgrep/semgrep-rules at a PINNED commit, fetched into a
# gitignored cache. Pinned rather than floating so a scan is reproducible: an
# upstream rule change can't silently alter what this gate enforces, and bumping
# RULES_SHA is a reviewable one-line diff.
#
# We fetch rather than vendor deliberately. Semgrep Rules License v1.0 permits
# use "for your own internal business purposes" but not redistribution; fetching
# at scan time is plainly use, and copying the rules into a company repo raises a
# question we don't need to answer.
set -euo pipefail

cd "$(dirname "$0")/.."

RULES_SHA="40b8c63f75dc7c22c8a77482d73bfb864b146f7e"
RULES_REPO="https://github.com/semgrep/semgrep-rules.git"
# Semgrep derives rule IDs from the config path, so this directory name becomes
# part of every rule ID (e.g. semgrep-rules.javascript.lang.security...).
# `nosemgrep:` suppressions reference those full IDs — renaming this directory
# invalidates every suppression in the codebase. Not overridable for that reason.
# (It fails safe: suppressions stop matching, findings reappear, the build goes
# red — but it would be a baffling failure to debug.)
CACHE_DIR=".semgrep-rules"
# Scan the whole repo, not an allowlist of directories. `src/` alone would skip
# rollup.config.js, omni.config.js, babel.config.js, mocha.tsx.js and examples/ —
# build orchestration and the code we hand to integrators as copy-paste starting
# points. Scanning the root also means a new top-level directory is covered the
# day it's added, rather than whenever someone remembers to update this list.
# Semgrep limits itself to git-tracked files, so lib/, es/, umd/ and the rule
# cache are skipped; the excludes below are belt-and-braces.
TARGETS=(.)
SARIF_OUT=""
CANARY=0

# Rules the canary MUST trip, at production severity. Asserting a per-rule set
# rather than a total count: the planted document.write line alone matches two
# rules, so a "count >= 2" check stayed green even if every other rule vanished.
REQUIRED_RULES=(dom-based-xss insecure-document-method insecure-innerhtml)

while [ $# -gt 0 ]; do
  case "$1" in
    --canary) CANARY=1; shift ;;
    --sarif)  SARIF_OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if ! command -v semgrep >/dev/null 2>&1; then
  echo "semgrep not found. Install with: python3 -m pip install --user semgrep" >&2
  exit 127
fi

# --- fetch pinned rules -----------------------------------------------------
if [ ! -d "$CACHE_DIR/.git" ]; then
  echo "==> fetching semgrep-rules @ ${RULES_SHA:0:12}"
  rm -rf "$CACHE_DIR"
  git init -q "$CACHE_DIR"
  git -C "$CACHE_DIR" remote add origin "$RULES_REPO"
fi
if [ "$(git -C "$CACHE_DIR" rev-parse HEAD 2>/dev/null || echo none)" != "$RULES_SHA" ]; then
  git -C "$CACHE_DIR" fetch -q --depth 1 origin "$RULES_SHA"
  git -C "$CACHE_DIR" checkout -q FETCH_HEAD
fi

# --- build the ruleset ------------------------------------------------------
# EVERY security/ subdir under javascript/ and typescript/ — not a hand-picked
# list. Rules are filed by the framework they were written for, but taint
# patterns generalize, and this SDK is consumed from both Node and the browser:
# the browser rules matter for bundle consumers, the node/express rules for the
# HTTP client and signing code. Picking "the ones that look relevant" silently
# drops real coverage.
CONFIGS=()
while IFS= read -r d; do CONFIGS+=(--config "$d"); done < <(
  find "$CACHE_DIR/javascript" "$CACHE_DIR/typescript" -type d -name security | sort
)
if [ ${#CONFIGS[@]} -eq 0 ]; then
  echo "ERROR: no rule directories resolved — refusing to run an empty scan" >&2
  exit 1
fi
echo "==> $((${#CONFIGS[@]} / 2)) rule directories"   # 2 array elements per dir: --config <path>

# --- canary: prove the ruleset still detects --------------------------------
# A misconfigured ruleset reports zero findings and looks identical to clean
# code. This is not hypothetical: the Semgrep registry rulesets network-ui first
# tried found 0 of 4 planted vulnerabilities. Fail loudly instead.
if [ "$CANARY" = "1" ]; then
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  # Each planted line must trip a DIFFERENT rule. Note eval() is deliberately not
  # asserted: eval-detected is WARNING severity, so --severity ERROR filters it
  # out and it cannot prove anything about the production gate.
  cat > "$TMP/canary.ts" <<'CANARY'
export function a() { document.write(location.hash); }
export function b(el: HTMLElement) { el.innerHTML = location.hash; }
CANARY
  echo "==> canary check (severity ERROR, matching the real scan)"
  found=$(semgrep scan "$TMP" "${CONFIGS[@]}" --severity ERROR --json --metrics off \
            --no-git-ignore 2>/dev/null \
          | python3 -c 'import json,sys; print(" ".join(sorted({r["check_id"].split(".")[-1] for r in json.load(sys.stdin)["results"]})))')
  missing=()
  for want in "${REQUIRED_RULES[@]}"; do
    case " $found " in *" $want "*) ;; *) missing+=("$want") ;; esac
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "CANARY FAILED — rules not firing: ${missing[*]}" >&2
    echo "  expected: ${REQUIRED_RULES[*]}" >&2
    echo "  got:      ${found:-<none>}" >&2
    echo "The ruleset is not detecting planted vulnerabilities. Refusing to report a clean scan." >&2
    exit 1
  fi
  echo "canary OK — all ${#REQUIRED_RULES[@]} required rules fired: $found"
  exit 0
fi

# --- scan -------------------------------------------------------------------
ARGS=(
  scan "${TARGETS[@]}" "${CONFIGS[@]}"
  --severity ERROR
  --exclude node_modules --exclude lib --exclude es --exclude umd --exclude dist
  --exclude coverage --exclude .nyc_output --exclude public --exclude "$CACHE_DIR"
  --exclude '__test__' --exclude '__integration__' --exclude '*.test.ts'
  --metrics off --error
)
[ -n "$SARIF_OUT" ] && ARGS+=(--sarif --output "$SARIF_OUT")

echo "==> scanning ${TARGETS[*]} (blocking on ERROR)"
exec semgrep "${ARGS[@]}"
