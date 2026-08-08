#!/usr/bin/env bash
#
# Refuse a PATCH release that carries feature-level changes.
#
# Pre-1.0, `^0.58.0` resolves anywhere inside `0.58.x`. So publishing a change
# that adds, changes or removes surface as `0.58.1` reaches every consumer on
# their NEXT INSTALL with an unchanged lockfile — and if that change makes a
# check report something it previously ignored, their pipeline goes red for a
# version they never chose to upgrade to. A minor bump leaves `^0.58.0` where it
# is and lets them opt in.
#
# This exists because the constraint had no gate. `publish.yml` verified only
# that the tag matched `package.json` and that a changelog section existed —
# both of which pass for `v0.58.1`. Worse, the release-notes extractor would
# have lifted the CHANGELOG's own "This release is 0.59.0, not a patch"
# blockquote straight into the GitHub release body, printed AFTER `npm publish`,
# which is immutable.
#
# ADR-008 rule 6: this is a gate on an irreversible effect, so it fails closed —
# including when it cannot determine what is currently published.
#
# Usage: assert-version-bump-is-safe.sh <version> <latest-published> <notes-file>
set -euo pipefail

VERSION="${1:?usage: assert-version-bump-is-safe.sh <version> <latest> <notes-file>}"
# `?` not `:?` — an EMPTY latest is the `npm view` failure this gate must diagnose
# in its own words, not an argv mistake.
LATEST="${2?usage: assert-version-bump-is-safe.sh <version> <latest> <notes-file>}"
NOTES_FILE="${3:?usage: assert-version-bump-is-safe.sh <version> <latest> <notes-file>}"

if [ ! -f "$NOTES_FILE" ]; then
  echo "Error: release-notes file '$NOTES_FILE' does not exist." >&2
  exit 1
fi

# Fail closed on an unknown baseline. An empty LATEST means `npm view` failed or
# the package is unpublished; guessing "probably fine" here is exactly the
# silent success this gate exists to remove.
if [ -z "${LATEST//[[:space:]]/}" ]; then
  echo "Error: could not determine the currently published version." >&2
  echo "This gate fails closed: npm publish is immutable, so an unknown baseline is not a pass." >&2
  exit 1
fi

# Refuse what this gate does not model, rather than waving it through.
#
# `${VERSION%.*}` strips at the LAST dot, so `0.58.1-rc.1` becomes `0.58.1-rc`,
# which never equals `0.58` — a prerelease walked straight past the patch test.
# Worse, `publish.yml` passes no `--tag`, so it would publish to `latest`, and
# `npm view … version` then returns the prerelease as the baseline: measured,
# `0.58.2` over a published `0.58.1-rc.1` was also waved through. One prerelease
# disabled the gate for the release after it.
case "$VERSION$LATEST" in
  *-*)
    echo "Error: this gate does not model prereleases ($VERSION over $LATEST)." >&2
    echo "Publishing a prerelease with no --tag would also move 'latest'. Teach the gate first." >&2
    exit 1
    ;;
esac

# Ordering first. `${VERSION%.*} != ${LATEST%.*}` tests INEQUALITY, never order,
# so it waved through a downgrade: measured, `0.57.0` over a published `0.58.0`
# printed "is a minor or major bump" and exited 0. On a gate over an irreversible
# effect that must be a comparison, not an assumption — republishing a lower
# version moves the `latest` dist-tag backwards for every consumer.
version_gt() { # $1 > $2 ?
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1)" = "$1" ]
}
if ! version_gt "$VERSION" "$LATEST"; then
  echo "Error: $VERSION is not greater than the published $LATEST." >&2
  echo "Publishing it would move the 'latest' dist-tag backwards. Bump past $LATEST." >&2
  exit 1
fi

# Same major.minor => this is a patch bump over what is already published.
if [ "${VERSION%.*}" != "${LATEST%.*}" ]; then
  echo "OK: $VERSION is a minor or major bump over $LATEST."
  exit 0
fi

# INVERTED: refuse unless every heading is known patch-safe.
#
# The first cut listed the forbidden headings (`Added|Changed|Removed`), which
# fails OPEN on anything nobody anticipated. Measured against this repo's own
# history: `### Deprecated` (a Keep a Changelog heading, and feature-level),
# `### Breaking` (shipped here in 0.10.0) and a section with bare bullets and no
# `###` heading at all were all waved through. A section whose heading the gate
# does not recognise is exactly when it should stop.
PATCH_SAFE='^### (Fixed|Security|Internal|Docs|Documentation|Documented|Notes|Known|Upgrad)'
HEADINGS=$(grep -cE '^### ' "$NOTES_FILE" || true)
OFFENDING=$(grep -E '^### ' "$NOTES_FILE" | grep -vE "$PATCH_SAFE" || true)

if [ "$HEADINGS" -eq 0 ] || [ -n "$OFFENDING" ]; then
  if [ "$HEADINGS" -eq 0 ]; then
    echo "Error: $VERSION is a patch over $LATEST, but its changelog section has no '### ' heading." >&2
    echo "This gate classifies a patch by its headings; an unclassified section is not a pass." >&2
  else
    echo "Error: $VERSION is a patch over $LATEST, and these headings are not patch-safe:" >&2
    echo "$OFFENDING" >&2
  fi
  echo "" >&2
  echo "Pre-1.0, ^${LATEST} resolves inside ${LATEST%.*}.x — a patch reaches every consumer" >&2
  echo "with an unchanged lockfile, so a behaviour change lands in pipelines nobody upgraded." >&2
  LATEST_MAJOR="${LATEST%%.*}"
  LATEST_REST="${LATEST#*.}"
  LATEST_MINOR="${LATEST_REST%%.*}"
  echo "" >&2
  # The tag already exists — this gate fires from a tag push. Re-tagging without
  # deleting silently does nothing, so an agent that skips this step retries into
  # the identical failure. Replaying the heading test over this repo's history,
  # 8 of 26 real patch releases would have landed here, so this IS the common path.
  echo "To recover:" >&2
  echo "  1. git push --delete origin v${VERSION} && git tag -d v${VERSION}" >&2
  echo "  2. set package.json to ${LATEST_MAJOR}.$((LATEST_MINOR + 1)).0 (or later) and rename the" >&2
  echo "     CHANGELOG heading to match" >&2
  echo "  3. commit, then tag and push the new version" >&2
  exit 1
fi

echo "OK: $VERSION is a patch over $LATEST and every heading is patch-safe."
