# Bug 0028: two findings in one file can share a baseline identity

**Reported:** 2026-07-29
**Fixed:** 2026-07-30, released in **v0.29.0**. Baseline-invalidating; see below.
**Found in:** all versions through v0.26.0
**Severity:** Medium — a baseline entry can accept a violation that is not the one it recorded. Not a false green today (the surviving finding is still a real violation), but it makes a baseline's contents untrustworthy as a record, and it silently defeats "accept this one, fix that one".

## Description

`hashViolation` is `sha256(rule::element::message)` (`src/helpers/baseline.ts`). For a
dependency finding the message carries the **element basename and the resolved target** and
nothing else — no line, no imported names, no edge kind. So two findings that differ only in
those unrecorded fields are **the same violation** as far as the baseline is concerned.

The commonest shape is a file that imports the same module twice: once for types, once for
values.

## Reproduction

Measured at v0.26.0, `modules(p).that().resideInFolder('**/src/conditions/**').should().notImportFrom('**/src/core/**')`
over this repository:

```
findings = 47   distinct hashes = 39   colliding pairs = 8   (17%)

fc482df6e2317e87  <- body-analysis.ts:3, body-analysis.ts:4
c8c7ce926ac1c795  <- class.ts:3,         class.ts:5
ed336b481d1248d6  <- dependency.ts:5,    dependency.ts:9
26334d1282505abe  <- helpers.ts:3,       helpers.ts:4
c34b1d6ab23aa0d8  <- jsx.ts:2,           jsx.ts:3
4835fff25da4d288  <- members.ts:9,       members.ts:10
f5895f80d0ded005  <- structural.ts:4,    structural.ts:5
afd4bcbe3b6e7611  <- type-level.ts:2,    type-level.ts:3
```

Every pair is the same shape:

```ts
// src/conditions/dependency.ts
import { isTypeOnlyImport } from '../core/import-options.js' // line 5
import type { ImportOptions } from '../core/import-options.js' // line 9
```

Both produce `dependency.ts imports "…/import-options.ts" which matches forbidden […]`. Byte
identical, so one hash.

## Consequences

1. **You cannot accept one and not the other.** `.excluding()` matches on element, file or
   message — all shared — so there is no way to baseline the type-only import and keep failing
   on the runtime one.
2. **A stale entry keeps matching.** Fix the runtime import and the type-only one still hashes
   to the recorded value, so the baseline goes on accepting a violation that is not the one it
   recorded. The reader has no way to notice: `filterNew` reports nothing, which is its success
   path.
3. **It defeats delta triage.** Any process that says "everything the baseline does not match is
   new" is wrong by however many collisions a codebase has — 17% in the sample above.

## Why no test caught it

No test asserts that distinct violations have distinct identities. `hashViolation`'s tests
(`tests/helpers/baseline-compat.test.ts`, `baseline-description-change.test.ts`) pin _stability_
— that the same violation keeps its hash across versions and roots — which is the opposite
property. Stability and distinctness are both required and only one is guarded.

## Suggested fix

The information needed is already on the violation and simply not in the message. Options, in
order of preference:

1. **Add the imported names to the message.** `dependency.ts imports { isTypeOnlyImport } from
"…"` distinguishes the pair, reads better, and gives the reader something actionable. It
   changes every existing dependency message, so it is a baseline-invalidating change and needs
   the treatment plan 0071's Migration section describes.
2. **Add `identity` to the violation.** `ArchViolation.identity` already exists for exactly this
   — "a producer that sets `identity` has declared its own canonical form, which supersedes both
   element and message". A producer-set identity of `element::specifier::line` would make these
   distinct **without changing any printed text**, so no message-stability constraint applies.
   This looks like the right answer.
3. Include the line in the identity. Rejected: `baseline.ts` deliberately excludes it so an
   accepted violation survives code moving, and that reasoning is sound.

Option 2 is preferable precisely because it separates the two properties: the message stays
stable for readers and baselines, while identity becomes distinct.

## Relationship to plan 0071

**Out of scope for 0071, and 0071 must not claim to fix it.** An early draft of that plan cited
this collision as motivation for giving each new edge kind its own message verb. That is wrong:
every colliding pair measured is **import/import**, so per-kind verbs leave them colliding.
0071's per-kind verbs address a different fault — a _new_ kind's finding sharing a message with
the `import` finding for the same module, which would let it be absorbed by an existing baseline
entry and never reported as new.

Fix this one first if the message route (option 1) is chosen, because it changes existing
messages and 0071's release constraint forbids that. Option 2 has no such interaction and can
land in either order.

## Guard this needs

- Distinctness, as the property nobody asserts: over a fixture where one file imports the same
  module for both a type and a value, the two findings have **different** `hashViolation` values.
  Asserted as a set size against the finding count, with a `count > 1` vacuity anchor.
- The pair is separately baselineable: accept one, assert the other still fails.
- **The stability property must be re-asserted in the same change**, since option 1 or 2 could
  trivially satisfy distinctness by making identity unstable — the existing
  `baseline-compat` corpus test is the counterweight and must keep passing.
- The stale-entry case, which is the one with teeth: baseline the pair, remove one of the two
  imports, and assert the survivor is **not** silently accepted.

## How it was fixed, and one claim in this file was wrong

`identity` is set on every edge finding: `element::kind::primary-candidate::names`.
Measured on this repo's barrel, which v0.28.0 had just made dependency-bearing:

```
before   src/index.ts: 114 findings, 87 identities, 26 colliding groups (46.5%)
after    src/index.ts: 114 findings, 114 identities, 0 colliding
```

**`names` is the discriminator, and the line is not.** Both resolve the 26 groups; the
line is rejected for the reason `baseline.ts` already excludes it — an accepted violation
has to survive its code moving. A sample colliding pair shows why names work: same file,
same target, same kind, `[project, workspace, resetProjectCache]` against `[ArchProject]`.

This gives `ModuleEdge.names` its first production consumer. A review had noted the field
had none and that its only guard was the runtime independence test, which was fair.

### Option 2 was not migration-free, and this file said it was

The Suggested fix above says option 2 "changes no printed text, so no message-stability
constraint applies. This looks like the right answer." The first half is true and the
conclusion does not follow. `hashViolation` is
`violation.identity ?? \`element::message\``, so setting `identity` replaces the whole
subject and **changes the hash of every dependency finding, not only the colliding ones**.
No text moves, which makes it an _invisible_ baseline invalidation — arguably worse than a
visible one.

`HASH_VERSION` is therefore bumped 2 → 3. That satisfies the constant's own rule — "bump
this only when `hashViolation` changes" — where v0.23.0's attempted bump did not, because
there the formula was unchanged and only one of its inputs had moved.

Measured consequence, now pinned by `tests/helpers/module-edge-migration.test.ts`: a
v0.27.0 baseline matches **nothing**, and the run says so — `filterNew` adds one
diagnostic when a non-empty baseline matches nothing at all, which is the difference
between a silent invalidation and a stated one.

### A residual, stated

For `kind === 'import'`, `names` is the **inward** name, so `import { X } from 'm'` and
`import { X as Y } from 'm'` in one file both carry `['X']` and still share an identity.
Separating them needs the local binding, which `ModuleEdge` deliberately does not carry —
the same reason `notHaveAliasedImports` was never routed through the edge walk. That shape
is legal and unusual. The shape this fixes is the barrel, where re-exports use the
**outward** name so aliases differ.

### Release note

**This must not ship as a patch.** It invalidates every dependency baseline, and v0.28.0
shipped hours earlier telling adopters to refresh — so releasing it immediately would ask
them to refresh twice. It belongs in a minor, bundled with other work, with
`docs/upgrading.md` carrying the row.
