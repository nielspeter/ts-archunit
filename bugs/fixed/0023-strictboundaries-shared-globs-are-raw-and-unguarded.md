# Bug 0023: `strictBoundaries` `shared` globs are matched raw and guarded by nothing

**Reported:** 2026-07-28
**Fixed:** 2026-07-29 (v0.25.0)
**Found in:** all versions through v0.21.0
**Severity:** Medium — a false **red** on the natural spelling, and a silent no-op on a dead
glob. The `folders` option got both treatments in earlier fixes (`atPath` normalization via
bug 0018's family, `assertDiscovered` via plan 0067); `shared` got neither, so the two options
on one preset hold users to two different contracts.

## Description

`strictBoundaries({ shared })` passes the user's `shared` globs **raw** into the allow list of
`no-cross-boundary` (`src/presets/boundaries.ts:173`, `allowedGlobs = [boundaryPattern,
...sharedGlobs]`) and into `onlyImportFrom`, which matches them against **absolute resolved
paths**. A relative spelling — the one bug 0018's fix legitimized elsewhere in the presets —
can therefore never match, and every legitimate import of a shared module becomes a violation.

And unlike `folders` — which `assertDiscovered` fails loudly when it matches nothing
(`src/presets/shared.ts:54`) — a `shared` glob that matches nothing produces **no finding at
all**: the allowance silently doesn't exist, and the user finds out via false reds on code the
preset's own docs tell them to write.

## Reproduction

Fixture: boundaries under `src/features/*`, a legitimate shared module at
`src/shared/util.ts`, `reporting/shared-user.ts` importing it. Measured at v0.21.0:

```
shared: ['**/src/shared/**']   ->  shared import passes        (correct)
shared: ['src/shared/**']      ->  shared import FLAGGED       (false red, same code)
shared: ['**/no-such-dir/**']  ->  0 discovery findings        (dead glob, silent)
folders: '**/no-such-feat/*'   ->  1 discovery finding, error  (the guard shared lacks)
```

The false red's `Fix:` line then compounds it: the violation carries `no-cross-boundary`'s
remedy, telling the user to move into the shared module **they are already importing from**.
(That remedy has its own defect —
[bug 0017](./0017-boundaries-no-cross-boundary-message-overclaims-entry-point-enforcement.md).)

## Why no test caught it

`tests/presets/boundaries.test.ts` exercises `shared` with the absolute spelling only, and
never with a glob that matches nothing. Same shape as bug 0018: the working spelling was the
only spelling tested.

## Suggested fix

Two halves, mirroring what `folders` already has:

1. **Normalize:** run `shared` globs through the same `atPath`-family treatment the other
   preset globs got in bug 0018, so `'src/shared/**'` and `'**/src/shared/**'` agree.
2. **Guard:** a `shared` glob matching zero files is a configuration finding, exactly as a dead
   `folders` glob is — `assertDiscovered` is right there and already has the remedy shape.

Note the adjacent hazard found in the same review, for whoever implements: `boundaryPattern`
feeds both the rule's _selector_ and its _allowance_ (`boundaries.ts:172-181`), and
`assertDiscovered` checks `options.folders`, not the per-rule selector — so a future edit that
narrows the pattern empties the selection silently. Bug 0017's guard fixture pins this with a
positive identity assertion; this bug's guard should reuse that fixture rather than grow a
second one.

## Guard this needs

- Both spellings of the same shared folder produce identical results (the bug-0018 guard
  shape, applied to `shared`).
- A dead `shared` glob produces a configuration finding, error severity, `bypassFilters`.
- A legitimate shared import passes under both spellings — asserted on a fixture where a
  cross-boundary violation also exists, so the passing half is not vacuous.

## How it was fixed

**v0.25.0, and by ONE of the two halves this report proposed, deliberately.**

All four reproduction rows were re-measured on bug 0017's fixture and every one held:

```
shared: ['**/src/shared/**']    shared import passes, 0 config findings   (correct)
shared: ['src/shared/**']       shared import FLAGGED, 0 config findings  (false red, silent)
shared: ['**/no-such-dir/**']   shared import FLAGGED, 0 config findings  (dead glob, silent)
folders: 'src/features/*'       0 rules,               1 config finding   (the guard shared lacked)
```

Note the middle two rows: **indistinguishable from outside.** Same violation count, same silence.
That is what the fix makes visible.

**The guard only. Normalization is NOT the fix, and this report's first half is withdrawn.** The
premise was that `folders` gets `atPath` normalization while `shared` does not, so the two options
hold callers to different contracts. Measured, that premise is wrong twice:

- `atPath` (bug 0018) is about **file-vs-folder** globs, not relative-vs-absolute. It is a
  predicate combinator — `or(resideInFile, resideInFolder)` — and cannot normalize the glob
  _strings_ that `onlyImportFrom` matches against resolved paths.
- `folders` is **not normalized either**. Its discovery guard's own remedy states the contract:
  "Boundary discovery matches absolute file paths… use a `'**/'`-prefixed glob". So the asymmetry
  between the two options was never normalization — it was only the guard.

Rewriting `shared` globs would therefore have made one option on this preset accept a spelling the
other rejects: a worse asymmetry than the one being fixed, and a silent divergence rather than a
loud one.

So `shared` now gets the same treatment `folders` has: a glob matching no file is a configuration
finding (`preset/boundaries/shared-discovery`, error, `bypassFilters`), naming the glob and the
spelling that works.

**Matched against file paths, not `atPath`'s file-or-folder** — a decision worth recording, because
it makes the guard stricter than `shared-isolation`. `shared: ['**/src/shared']` (a folder glob with
no trailing `/**`) selects files for `shared-isolation` via `atPath`, yet creates **no allowance**,
because the allow list matches resolved file paths. It is a genuine fault for the purpose this
guard covers, and guarding on file matches is what makes it visible. Pinned by its own test.

## Guard

Reuses bug 0017's fixture rather than growing a second one, as this report asked — and its
cross-boundary violations are the non-vacuity anchor, so "the shared import passes" can never be
satisfied by a rule that selected nothing.

**7 reverts, all caught after two rounds.** The one that survived the first was subtle and worth
recording: replacing the finding's `glob` field with a placeholder left the real glob visible
anyway, because the remedy embeds it too — so an assertion that "the glob appears somewhere"
passed. The test now pins the discovery clause (`for glob '<the glob>'`), since a finding that
names a different glob than the one at fault is self-contradictory.
