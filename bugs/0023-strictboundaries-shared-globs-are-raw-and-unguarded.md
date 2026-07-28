# Bug 0023: `strictBoundaries` `shared` globs are matched raw and guarded by nothing

**Reported:** 2026-07-28
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
