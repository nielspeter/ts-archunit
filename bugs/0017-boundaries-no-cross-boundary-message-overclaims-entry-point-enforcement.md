# Bug 0017: `strictBoundaries()`'s no-cross-boundary remedy cannot remediate, and its message overclaims entry-point enforcement

**Reported:** 2026-07-28
**Found in:** v0.19.0 through v0.21.0 (current). Introduced by `6ef8ade` — the commit that
bulk-added remedies to every preset rule; before it, preset rules carried no
`because`/`suggestion` at all. The defect was introduced _by_ the ADR-008 remedy fix:
remedies were added without checking each against its condition.
**Severity:** High — the sanctioned `Fix:` line, applied exactly, reproduces the identical
violation. An agent obeying it loops: edit → re-check → same failure → same fix, and its only
exits are unsanctioned (baseline, exclude, disable). This is the class
[bug 0021](./fixed/0021-a-config-finding-prints-the-rule-authors-unrelated-remedy.md) rated
High, on an error-severity finding in a preset — the one place the user cannot supply the
remedy themselves. Draft 1 filed this Medium on the premise "the rule itself is not broken; the
text merely overclaims"; measurement disproved the mitigating premise.

## Description

`strictBoundaries()`'s `no-cross-boundary` rule (`src/presets/boundaries.ts:169-194` at
v0.21.0; the strings at `:183-188`) restricts each boundary's imports to itself plus `shared`:

```ts
const boundaryPattern = `${dir}/**`
const allowedGlobs = [boundaryPattern, ...sharedGlobs]
modules(p)
  .that()
  .resideInFolder(boundaryPattern)
  .should()
  .onlyImportFrom(...allowedGlobs)
```

So the rule is written from the **importer's** side: any import from another boundary violates,
whichever file it names. Total folder isolation — a _stricter_ policy than the
entry-point-mediated access its metadata describes:

- `because`: "…bypasses the public surface each boundary is supposed to be reached through"
- `suggestion`: "Import from the other boundary's entry point instead of reaching into its internals, or move the shared piece into the shared module."
- `imperative`: "Do NOT import another boundary's internals — go through its entry point"

The message describes a looser policy the rule does not implement. Read in isolation — which is
the point; these strings exist for an agent to act on without reading the source — the
`suggestion`'s first clause instructs a change that cannot ever satisfy the condition.

## Reproduction

Fixture: `src/features/billing/{index.ts, internal.ts}`, `src/features/reporting/consumer.ts`,
boundary glob `**/src/features/*`. Measured at v0.21.0:

```
consumer.ts imports billing/internal.ts   ->  1 violation  (no-cross-boundary, error)
consumer.ts imports billing/index.ts      ->  1 violation  (identical rule, identical message)
```

Both **fail identically** — the rule makes no entry-point distinction, in the failing
direction. Then the remedy loop, measured:

1. Violation fires on `billing/internal.ts`. `Fix:` says "Import from the other boundary's
   entry point instead."
2. Apply it: switch the import to `billing/index.ts`.
3. **Identical violation, identical `Fix:` line.** `index.ts` is inside `billing/**`, which is
   not in reporting's allow list; no import of another boundary can ever be.

When `shared` is not configured (a legal configuration, `shared` defaults to `[]`), the second
clause is also unexecutable — there is no shared module in the allow list to move anything
into. In that configuration the entire `Fix:` line is unsatisfiable within the code being
checked.

## The worst surface: committed agent prompts

`explain --format agent` emits **only** the `imperative`, per rule
(`src/cli/commands/explain.ts:87-89`), and `init` instructs users to commit that block into
their agent's system prompt (`src/cli/commands/init.ts:187-193`). So adopters currently carry:

```
- Do NOT import another boundary's internals — go through its entry point
```

as a _standing, proactive_ instruction. An agent writing new code follows it, produces
`import { x } from '../billing/index.js'`, and `check` then fails on exactly the code the
system prompt sanctioned. The guidance surface manufactures the violations the enforcement
surface reports — and upgrading the package changes nothing until the user re-runs `explain`
and replaces the committed block. The release note must say so.

(Adjacent, smaller: the rule is generated once per boundary with identical metadata and
`outputAgent` does not dedupe, so the wrong bullet prints once per boundary.)

## Why no test caught it

Verified: no fixture under `tests/fixtures/presets/boundaries/` contains an `index.ts` at all,
and no fixture file imports _any_ file from another boundary. The only test that fires
`no-cross-boundary` (`tests/presets/boundaries.test.ts:56-60`) does so via the degenerate path
— a boundary importing `shared/` when `shared` is unconfigured — and asserts rule-id
membership only. There is zero coverage of a genuine boundary-to-boundary import, let alone
the entry-point/internal distinction.

## Scope, measured

- **Docs are clean.** `docs/presets.md:129` ("Each boundary imports only from itself +
  shared"), `docs/cli.md:44`, and `docs/what-to-check.md:666-687` (which correctly models
  folder isolation and barrel-only access as separate tools) — none repeat the entry-point
  claim. Swept, not assumed.
- **Preset siblings are clean.** Every `because`/`suggestion`/`imperative` in `src/presets/`
  checked against its condition; `no-cross-boundary` is the only authorial overclaim. The fix
  stays local to three strings.
- **Baseline-free.** `hashViolation` covers `rule::element::message` only;
  `because`/`suggestion` are unhashed and `imperative` never reaches a violation. Measured:
  applying the replacement strings leaves both violation hashes byte-identical and an old-text
  baseline replays with 0 new findings. One correction rides along: the doc comment at
  `src/helpers/baseline.ts:82` claims identity does not survive "rewording `.because()`" —
  false at HEAD, and itself a 0017-shaped overclaim sitting where a compat auditor would look.
- **Two enforcement defects found during this bug's review are filed separately**, because they
  are behaviour, not text: [bug 0022](./0022-forward-import-conditions-are-blind-to-reexports-and-dynamic-imports.md)
  (`onlyImportFrom` is blind to `export … from` and `import()` — both cross this boundary
  unflagged, measured) and [bug 0023](./0023-strictboundaries-shared-globs-are-raw-and-unguarded.md)
  (`shared` globs matched raw and guarded by nothing). The corrected message below is honest
  about static imports; 0022 is what makes it honest about imports generally.

## Suggested fix

**Correct the three strings now.** Behaviour unchanged, baseline-free, patch-sized. The
`suggestion` is computed, not constant — `dir` and `sharedGlobs` are in scope at the
generation site, and the review showed a fixed string cannot be right in both the
shared-configured and shared-empty configurations:

- `because`: "boundaries may only depend on themselves and the shared modules — an import from
  another boundary couples the two, whichever file it names"
- `suggestion`, when `shared` is configured: "Move the code both boundaries need into a shared
  folder (`<sharedGlobs>`), or remove the dependency on the other boundary."
- `suggestion`, when `shared` is empty: "No shared folders are configured — add one to
  `strictBoundaries({ shared })` and move the code both boundaries need there, or remove the
  dependency on the other boundary."
- `imperative`: "Do NOT import a file outside this boundary or its shared modules" _(as draft
  1 proposed — accurate to the condition, unchanged)_

Draft 1's proposed `because`/`suggestion` are withdrawn: "couples … to another boundary's
internal file layout" is false for the `index.ts` case (fires identically, zero layout
coupling), and "that boundary's structure is probably leaking and should be reconsidered" is a
hedge where the agent needs an action — it also deleted the one clause of the current text
that was executable.

**Entry-point privacy, if wanted, is a separate feature — and cheaper than draft 1 claimed.**
It does not require a new mechanism: `onlyImportFrom(dir/**, ...shared,
...otherBoundaries.map(d => `${d}/index.ts`))` expresses static entry-point-mediated access
with existing primitives, since `onlyImportFrom` matches file-level globs against resolved
paths. The honest case for building the `onlyBeImportedVia()`-based preset (proposal 020
Part 1) is per-target enforcement — privacy declared by the owning boundary — and coverage of
re-export/dynamic edges, which is bug 0022's territory. Still held pending demand; this bug
shows the message is wrong, not that the feature is needed.

## Guard this needs

Draft 1's "assert the rule's behavior (pass/fail) is identical for both" is vacuously
satisfiable — measured, two of four sabotages (dead glob; selector narrowed) pass it as
`0 === 0`. The non-vacuous form, in one fixture run:

- Assert the two cross-boundary violations **exist, by identity** (importer → imported file:
  `via-index.ts -> index.ts` and `via-internal.ts -> internal.ts`) — pinning both that the rule
  fires and that entry point and internal are treated identically.
- Assert the discovery finding is **absent** (vacuity anchor), and that within-boundary imports
  (`billing/index.ts -> internal.ts`) produce none.
- **Remedy-remediates:** apply the corrected `suggestion`'s action (move the shared piece into
  a configured shared folder) and assert zero violations. This is the generalizable guard for
  the whole defect class — the current text fails it today, which is this bug stated as a
  test — and it connects to plan 0070's direction.
- The fixture lives in its own root (`tests/fixtures/presets/boundaries-folder-level/`) with
  its own tsconfig: the existing boundaries fixtures are materialized by every test in the
  file, and `duplicateBodies` runs pairwise over them.

The text-tripwire from draft 1 (grep the new strings for "entry point") is kept only if
co-located with the behavioural guard and labelled a tripwire — a synonym passes it, and the
identity guard is the real pin.
