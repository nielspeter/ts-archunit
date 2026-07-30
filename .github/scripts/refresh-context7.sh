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

LIBRARY="${CONTEXT7_LIBRARY:-/nielspeter/ts-archunit}"
SEARCH="https://context7.com/api/v1/search?query=$(basename "$LIBRARY")"
POLL_ATTEMPTS="${CONTEXT7_POLL_ATTEMPTS:-6}"
POLL_SECONDS="${CONTEXT7_POLL_SECONDS:-30}"

fail() {
  echo "::error title=Context7 refresh failed::$1"
  exit 1
}

if [ -z "${CONTEXT7_API_KEY:-}" ]; then
  fail "CONTEXT7_API_KEY is not set. Context7 moved to an authenticated API: POST /api/v1/refresh answers 401 without a key, and the old unauthenticated POST /api/v1/add answers 405. Create a key at https://context7.com (sign in, then Account -> API keys) and add it as the repository secret CONTEXT7_API_KEY. Until then the docs index cannot be refreshed and this job will keep failing, which is the honest state — do NOT swap in rennf93/upsert-context7's 'refresh' operation to make it green: that endpoint returns an HTML page with status 200 and the action reports success for it."
fi

# The index's own timestamp BEFORE the refresh, so the check below compares two
# independently produced values rather than trusting the refresh's self-report.
current_update_date() {
  curl -sS --max-time 60 "$SEARCH" \
    | python3 -c "
import json,sys
library = sys.argv[1]
try:
    results = json.load(sys.stdin).get('results', [])
except Exception:
    print(''); raise SystemExit(0)
for entry in results:
    if entry.get('id') == library:
        print(entry.get('lastUpdateDate', '')); raise SystemExit(0)
print('')
" "$LIBRARY"
}

before="$(current_update_date)"
echo "Library:            $LIBRARY"
echo "Indexed update at:  ${before:-<not indexed>}"

echo "Requesting a refresh…"
status_and_type="$(
  curl -sS --max-time 900 -o /tmp/context7-response \
    -w '%{http_code} %{content_type}' \
    -X POST 'https://context7.com/api/v1/refresh' \
    -H "Authorization: Bearer ${CONTEXT7_API_KEY}" \
    -H 'Content-Type: application/json' \
    -d "{\"requestedLibrary\":\"${LIBRARY}\"}"
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
[ "$code" = "200" ] || fail "HTTP $code from POST /api/v1/refresh. 401 means the API key is missing or expired; 405 means the endpoint moved again."

# Guard 2: the index has to actually move.
echo "Waiting for the index to update (up to $((POLL_ATTEMPTS * POLL_SECONDS))s)…"
for attempt in $(seq 1 "$POLL_ATTEMPTS"); do
  sleep "$POLL_SECONDS"
  after="$(current_update_date)"
  if [ -n "$after" ] && [ "$after" != "$before" ]; then
    echo "::notice title=Context7 refreshed::$LIBRARY updated at $after (was ${before:-<not indexed>})"
    exit 0
  fi
  echo "  attempt $attempt/$POLL_ATTEMPTS: still ${after:-<not indexed>}"
done

fail "The refresh was accepted (HTTP 200) but the index still reports ${before:-<not indexed>} after $((POLL_ATTEMPTS * POLL_SECONDS))s. The request was received and the index did not move, so nothing downstream should treat these docs as current."
