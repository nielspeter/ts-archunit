#!/usr/bin/env bash
#
# Refresh this library's Context7 documentation index.
#
# ## Why this is a script and not `rennf93/upsert-context7`
#
# That action was correct when it was adopted and both of its operations are now
# wrong. Measured 2026-07-30 against the live service:
#
#   POST https://context7.com/api/v1/add        -> 405   (operation: add)
#   POST https://context7.com/refresh-library   -> 200 text/html  (operation: refresh)
#   POST https://context7.com/api/v1/refresh    -> 401 application/json
#
# `add` fails honestly: its endpoint is gone. **`refresh` is the dangerous one.**
# `/refresh-library` is a Next.js *page* route, so a POST returns the HTML page
# with status 200; the action checks `status_code == 200`, tries `response.json()`,
# lands in its `except` branch and reports "Documentation refresh started
# successfully". A green run that refreshed nothing — which is the exact failure
# ADR-008 exists to prevent, and the reason switching `add` to `refresh` is NOT
# the fix it looks like.
#
# `/api/v1/refresh` is the real endpoint. It answers 401 with
# `{"error":"unauthorized","message":"… provide a valid API key"}` and Clerk auth
# headers, so Context7 now requires authentication that the action never sent.
#
# ## The body contract, measured with a live key on 2026-07-30
#
#   {"libraryName":"/nielspeter/ts-archunit"}  -> 200 {"message":"Refresh started successfully"}
#   {"libraryName":"nielspeter/ts-archunit"}   -> 404 library_not_found  (leading slash required)
#   {"libraryName":"ts-archunit"}              -> 404 library_not_found
#   {"requestedLibrary":"…"}                   -> 400 validation_error
#
# The field is `libraryName` and the value is the full id including the leading
# slash. This script's first version sent `requestedLibrary` and every unauthed
# probe answered 401 before validation ran, so the wrong field name was invisible
# until a real key existed — the 401 masked a 400. The field name was recovered by
# sending a NUMBER and watching the error change from "received undefined" to
# "received number", which is the only way this API names its schema.
#
# ## The two honesty guards
#
# 1. **Content type, not just status.** A 200 that is not JSON is the page route,
#    not the API. Checking the status alone is precisely how the upstream action
#    manufactures its false success.
# 2. **Read the index back.** The refresh call's own report is one derivation;
#    `lastUpdateDate` from the search API is a different one (ADR-008 rule 5). An
#    accepted request that never updates the index is a failure, and only the
#    second derivation can see it.
set -euo pipefail

# Derived from `context7.json` — the file Context7's own crawler reads — so a repo
# rename updates one place rather than two. Falls back to the literal only if that
# file is unreadable, and says which it used.
LIBRARY="${CONTEXT7_LIBRARY:-}"
if [ -z "$LIBRARY" ] && [ -r context7.json ]; then
  LIBRARY="$(python3 -c "
import json,sys
try:
    url = json.load(open('context7.json')).get('url','')
except Exception:
    sys.exit(0)
if url.startswith('https://github.com/'):
    print('/' + url.removeprefix('https://github.com/').rstrip('/'))
" 2>/dev/null || true)"
fi
LIBRARY="${LIBRARY:-/nielspeter/ts-archunit}"
SEARCH="https://context7.com/api/v1/search?query=${LIBRARY}"
POLL_ATTEMPTS="${CONTEXT7_POLL_ATTEMPTS:-6}"
POLL_SECONDS="${CONTEXT7_POLL_SECONDS:-30}"

fail() {
  echo "::error title=Context7 refresh failed::$1"
  # Restored from the step this script replaced. It is release-specific, so it is
  # opt-in via env rather than always printed — `context7.yml` has no publish to
  # protect and the sentence would be false there.
  if [ -n "${CONTEXT7_RELEASE_CONTEXT:-}" ]; then
    echo "::error title=The package published fine::This job is the DOCS INDEX only. The npm publish and the GitHub release already succeeded and are immutable. Fix: run the 'Update Context7 Docs' workflow once this is resolved. Do NOT re-run this run's publish job — npm rejects a version that already exists."
  fi
  exit 1
}

# A mis-pasted key (trailing newline, truncated copy) currently surfaces only as a
# bare `HTTP 401`, which reads like an expiry rather than a paste. The API's own 401
# body names `ctx7sk` as the expected prefix, so the shape is checkable.
if [ -n "${CONTEXT7_API_KEY:-}" ] && [ "${CONTEXT7_API_KEY#ctx7sk}" = "${CONTEXT7_API_KEY}" ]; then
  fail "CONTEXT7_API_KEY does not start with 'ctx7sk'. Context7's own 401 body names that prefix, so this is a wrong or mis-pasted value rather than an expired one — check for a truncated copy or a trailing newline in the secret."
fi

if [ -z "${CONTEXT7_API_KEY:-}" ]; then
  fail "CONTEXT7_API_KEY is not set. Context7 moved to an authenticated API: POST /api/v1/refresh answers 401 without a key, and the old unauthenticated POST /api/v1/add answers 405. Create a key at https://context7.com (sign in, then Account -> API keys) and add it as the repository secret CONTEXT7_API_KEY. Until then the docs index cannot be refreshed and this job will keep failing, which is the honest state — do NOT swap in rennf93/upsert-context7's 'refresh' operation to make it green: that endpoint returns an HTML page with status 200 and the action reports success for it."
fi

# The index's own timestamp BEFORE the refresh, so the check below compares two
# independently produced values rather than trusting the refresh's self-report.
# Read the index once. Prints `<lastUpdateDate>|<state>`, or the sentinel
# `UNREADABLE` when the request or the parse failed.
#
# Never fails the script: `set -e` plus `$(…)` means a DNS blip or a 5xx would hard
# exit — including AFTER a successful refresh, reding a release run that already did
# its job, with no remedy text. And an empty answer is NOT the same as an unreadable
# one: "the library is not in the results" and "we could not ask" lead to different
# verdicts, and the first version of this reported both as "the index did not move".
read_index() {
  curl -sS --max-time 30 "$SEARCH" 2>/dev/null \
    | python3 -c "
import json,sys
library = sys.argv[1]
try:
    results = json.load(sys.stdin).get('results', [])
except Exception:
    print('UNREADABLE'); raise SystemExit(0)
for entry in results:
    if entry.get('id') == library:
        print(f\"{entry.get('lastUpdateDate','')}|{entry.get('state','')}\"); raise SystemExit(0)
print('|')
" "$LIBRARY" 2>/dev/null || echo 'UNREADABLE'
}

current_update_date() {
  local raw; raw="$(read_index)"
  if [ "$raw" = 'UNREADABLE' ]; then echo 'UNREADABLE'; else echo "${raw%%|*}"; fi
}

# `state` separates "still indexing" from "nothing happened" — a materially
# different verdict, and free in the same response.
current_state() {
  local raw; raw="$(read_index)"
  if [ "$raw" = 'UNREADABLE' ]; then echo 'unknown'; else echo "${raw##*|}"; fi
}

before="$(current_update_date)"
echo "Library:            $LIBRARY"
echo "Indexed update at:  ${before:-<not indexed>}"

echo "Requesting a refresh…"
status_and_type="$(
  curl -sS --max-time 60 -o /tmp/context7-response \
    -w '%{http_code} %{content_type}' \
    -X POST 'https://context7.com/api/v1/refresh' \
    -H "Authorization: Bearer ${CONTEXT7_API_KEY}" \
    -H 'Content-Type: application/json' \
    -d "{\"libraryName\":\"${LIBRARY}\"}"
)"
code="${status_and_type%% *}"
content_type="${status_and_type#* }"
echo "HTTP $code ($content_type)"
head -c 500 /tmp/context7-response || true
echo

# Guard 1: a 200 that is not JSON is the page route, not the API.
case "$content_type" in
  application/json*) ;;
  *) fail "HTTP $code but the response is '$content_type', not JSON. A non-JSON 200 means the request reached a page route rather than the API — that is what makes the upstream action report success while refreshing nothing." ;;
esac
[ "$code" = "200" ] || fail "HTTP $code from POST /api/v1/refresh. 400 = the request body no longer matches the schema (the field is \`libraryName\`, and a wrong name here is how this script shipped broken once already); 401 = the API key is missing, malformed or expired; 404 = \`$LIBRARY\` is not indexed at all, so add it at https://context7.com/add-library rather than refreshing it; 405 = the endpoint moved again."

# Guard 2: the index has to actually move.
echo "Waiting for the index to update (up to $((POLL_ATTEMPTS * POLL_SECONDS))s)…"
unreadable=0
for attempt in $(seq 1 "$POLL_ATTEMPTS"); do
  after="$(current_update_date)"
  if [ "$after" = 'UNREADABLE' ]; then
    unreadable=$((unreadable + 1))
    echo "  attempt $attempt/$POLL_ATTEMPTS: could not read the index (retrying)"
  elif [ -n "$after" ] && [ "$after" != "$before" ]; then
    echo "::notice title=Context7 refreshed::$LIBRARY updated at $after (was ${before:-<not indexed>})"
    exit 0
  else
    echo "  attempt $attempt/$POLL_ATTEMPTS: state=$(current_state), still ${after:-<not indexed>}"
  fi
  [ "$attempt" -lt "$POLL_ATTEMPTS" ] && sleep "$POLL_SECONDS"
done

# Three different verdicts, which one message used to conflate.
if [ "$unreadable" -eq "$POLL_ATTEMPTS" ]; then
  fail "The refresh was accepted (HTTP 200) but the index could not be read back even once in $((POLL_ATTEMPTS * POLL_SECONDS))s. That is a failure to VERIFY, not a failure to refresh — the docs may well be current. Re-run this job before assuming anything."
fi
if [ "$(current_state)" != 'finalized' ]; then
  fail "The refresh was accepted and the library reports state='$(current_state)', i.e. still indexing after $((POLL_ATTEMPTS * POLL_SECONDS))s. Nothing is wrong; the poll budget is too short. Raise CONTEXT7_POLL_ATTEMPTS and re-run — do NOT re-run the publish job."
fi
fail "The refresh was accepted (HTTP 200), the library reports state='finalized', and \`lastUpdateDate\` is unchanged at ${before:-<not indexed>} after $((POLL_ATTEMPTS * POLL_SECONDS))s. Either the request did nothing, or this release changed nothing Context7 indexes (a src/-only release with no docs/ or *.md edits legitimately leaves the timestamp alone). Check the diff before treating this as broken."
