# Proposal 017 — Correspondence / Coverage Primitive (`correspond`)

**Status:** Draft (draft 1) — awaiting architect + product review
**Priority:** High — it is the single missing primitive behind the two largest recurring bug classes in the reference project (cmless): route↔permission-matrix drift (~12 bugs) and phantom limits (~12 bugs). It is also the generic form of a check cmless has **hand-built twice** because ts-archunit offers no primitive for it.
**Affects:** one new top-level entry point + builder in the public DSL (`src/builders/correspondence-builder.ts`, `correspond` in `src/index.ts`); reuses existing selection machinery and `ArchViolation`. No engine change beyond what selections already do (ADR-007 boundary untouched). Adjacent to, not a replacement for, `crossLayer` (§Relationship).
**Origin:** The 2026-07-24 cmless coverage audit (`cmless/architecture-docs/ts-archunit-coverage-audit-2026-07.md`). Two independent lines of evidence converged on the same gap: the bug corpus (route↔matrix + phantom-limit clusters, ~24 bugs) and two hand-rolled correspondence tests in cmless (`sdk-coverage.test.ts`, `limits-enforcement-completeness.test.ts`) — one of which certifies coverage with a **cardinality** check, the exact [ADR-008](../adr/008-agent-first-failure-surfaces.md) Rule 5 anti-pattern.

> **"Every X has a matching Y" is a first-class architectural relation, and ts-archunit cannot state it.** The whole DSL selects *one* set and asserts a property of its members. But the drift that actually ships is relational: a route with no permission-matrix entry, a declared limit no code enforces, an API route with no SDK method. Each is a set-membership gap between **two independently-derived sets** — which is not incidentally, but *exactly*, the shape ADR-008 Rule 5 demands ("a derivation is unguarded until a differently-derived value disagrees with it"). Correspondence is Rule 5 turned into a primitive.

## Problem

Three real, recurring gaps from cmless, all the same shape:

1. **Route ↔ permission-matrix drift (~12 bugs: 0031, 0033, 0034, 0025, 0013, 0028, 0143, 0030, 0029, 0035, 0141, 0142).** cmless has the right structure — a centralized `ROUTE_PERMISSIONS` map + a fail-closed enforcer. But route↔matrix correspondence is hand-maintained, so it drifts: a route ships without a matrix entry (falls through to 403), a param-name mismatch (`:userId` vs `:id`) breaks normalization (0013), a whole surface (`requirePlatformScope`, 72 inline preHandlers) bypasses the matrix (0143). The only existing guard is a **runtime integration test** needing testcontainers — slow, flaky (0106). A static correspondence check catches the same class at compile time.

2. **Phantom limits (~12 bugs: 0322, 0331, 0334, 0327, 0326, 0330, 0335, 0343, 0342, 0091).** A limit exists in a config/tier/plan table (and shows in usage reports and pricing docs) but **no call-site reads it to reject**. `assetStorageBytes` — "stored, seeded, shown in a telemetry gauge, and enforced by no one" (0331). `maxGraphQLRequestSizeBytes`, `maxResponseSizeBytes` — "read nowhere" (0326). This is a coverage gap: the set of *declared* limits is not covered by the set of *enforced* limits.

3. **API route ↔ SDK method coverage.** `sdk-coverage.test.ts` (341 lines) asserts every content route has an SDK method — via a **hand-typed** `route → method` map, and its third assertion is `mapCount === permCount` (cardinality, not identity: it passes when one route is dropped and another added). `limits-enforcement-completeness.test.ts` is a second hand-rolled instance, this one carefully ADR-008-aware (injected-phantom red-proof, shrink-only ratchet) — a sophisticated author reinventing the primitive by hand.

### Why the current DSL can't express it

Every entry point (`modules`, `classes`, `functions`, `types`, `calls`, `slices`, `jsxElements`) selects **one** set and runs a per-element condition. `notExist()` asserts a set is empty; there is no way to assert **set A is covered by set B** when A and B are *differently derived*. `crossLayer` is the closest, but it does **pairwise content conditions** on already-matched glob layers (does the matched route's shape agree with the matched schema's shape) — not **existence/coverage** (does a match exist at all), and it is glob-path-oriented, so it cannot relate an AST set to a runtime object's keys or a type's fields (§Relationship).

## The insight: correspondence is ADR-008 Rule 5 as a primitive

ADR-008 Rule 5: *"a derivation is unguarded until a differently-derived value disagrees with it."* A correspondence check is precisely two derivations plus a disagreement test:

- **from** = routes discovered by walking the AST (`calls().onObject('app')…`)
- **to** = `Object.keys(ROUTE_PERMISSIONS)` read from the real runtime config
- the assertion fires when a key on one side has no match on the other.

The two sides fail in different ways (AST vs runtime object), so a drift on either is caught by the other — the independence Rule 5 requires. This is why correspondence is worth a primitive and not just sugar: it is the *canonical* Rule-5 guard, and packaging it makes the two mandatory anti-false-green properties (identity-not-cardinality, non-vacuity) impossible to get wrong, instead of hand-rolled and gotten wrong (the `mapCount === permCount` bug).

## Proposed design

A new top-level entry, sibling to `crossLayer`. Two sides, each a **key set**; assert the relation between the key sets by **identity**.

```ts
import { correspond, calls } from '@nielspeter/ts-archunit'
import { ROUTE_PERMISSIONS } from '../src/config/route-permissions.js'

correspond(p)
  .from(
    // side A: a selection + a key extractor (AST-derived)
    calls(p).that().onObject('app').and().withMethod(/^(get|post|put|patch|delete)$/),
    (c) => `${c.method().toUpperCase()} ${normalizePath(c.stringArg(0))}`,
  )
  .to(
    // side B: an already-derived key set (runtime-derived) + optional normalizer
    Object.keys(ROUTE_PERMISSIONS),
  )
  .should()
  .everyFromHasATo() // every registered route resolves to a matrix key → else FAIL, listing the routes
  .andShould()
  .everyToHasAFrom() // every matrix key maps to a real route → else FAIL, listing the stale keys
  .rule({
    id: 'auth/route-matrix-correspondence',
    because: 'A route with no permission-matrix entry falls through to a 403; a stale entry hides a deleted route.',
    suggestion: 'Add the route to ROUTE_PERMISSIONS (or remove the stale entry). Param names must match: use :userId, not :id.',
  })
  .check()
```

### The pieces

- **`.from(source, keyFn?)` / `.to(source, keyFn?)`** — each side's `source` is either
  - a ts-archunit **selection** (any `RuleBuilder`), with `keyFn` mapping each element to a `string` key (or `readonly string[]` for elements that contribute several keys), or
  - an already-derived **`readonly string[]` / `ReadonlySet<string>`**, with `keyFn` an optional normalizer (default identity).
  The naming is neutral: `from`/`to` do not imply direction beyond which assertion reads which side.
- **`.should()` terminals** (bikeshed — names are the only open question):
  - `.everyFromHasATo()` — coverage: `from` ⊆ `to`. Failure lists the uncovered `from` keys (anchored to their AST node's file:line where the side is a selection).
  - `.everyToHasAFrom()` — no orphans: `to` ⊆ `from`. Failure lists the orphan `to` keys.
  - `.beBijective()` — both, and the **recommended default** when both sides are independently derived (a one-directional check silently tolerates drift on the unchecked side).
- **Composable** with `.rule({ id, because, suggestion })`, `.excluding()`, `.warn()`/`.check()`/`.violations()` — same terminals as every other builder (ADR-003).

### Baked-in ADR-008 properties (the reason it's a primitive, not a recipe)

1. **Identity, never cardinality.** The assertion compares key **sets** and reports the specific missing/orphan keys. There is no count comparison in the API surface — the `mapCount === permCount` mistake is *unwritable*. (ADR-008 Rule 5 corollary: "compare identities, not integers.")
2. **Non-vacuity by default.** If either side derives **0 keys**, the check **fails** with a distinct message ("`from` selector matched 0 subjects — correspondence over an empty side certifies nothing"). This is [proposal 014](./014-empty-selector-safety.md) applied to the relation: an empty side is the misconfiguration that makes `∅ ⊆ anything` a green. Opt out with `.allowEmpty('from' | 'to')` only where a side is legitimately sometimes-empty, stating why.
3. **Agent-first failure.** The message names *which* keys are uncovered/orphan and carries the sanctioned remedy via `.rule({ suggestion })` (ADR-008 Rule 2). Per-key file:line comes from the AST side; the plain-key side prints the key verbatim (honest limitation, below).
4. **Independence is stated, not claimed.** The primitive is only a guard if `from` and `to` are *differently derived*. It cannot mechanically verify that (two hand-typed arrays would pass and guard nothing). So the docs state the rule bluntly — **derive each side from a different source** (AST vs runtime object; type fields vs call-sites) — the same honesty ADR-008 requires of its own guards. §Acceptance encodes the check "what would this do if the guarded thing were fully broken?"

### Worked examples

**Phantom limits (0331, 0326, …)** — declared limit fields must each be read somewhere:

```ts
correspond(p)
  .from(
    types(p).that().haveNameMatching(/^CapacityTierLimits$/),
    (t) => t.propertyNames(), // AST: the declared limit fields
  )
  .to(
    // independently derived: identifiers actually referenced as `.limits.<field>` across src
    referencedLimitFields(p), // a small selection/body-scan helper → readonly string[]
  )
  .should()
  .everyFromHasATo()
  .rule({
    id: 'limits/no-phantom-limits',
    because: 'A declared limit that no call-site reads is advertised but unenforced (bugs 0331, 0326).',
    suggestion: 'Add an enforcement call-site that reads the limit and rejects when exceeded, or remove the field.',
  })
  .check()
```

*Honest scope:* v1 asserts the field is **referenced**; it does not prove the reference **flows into a reject** (value-flow). That catches the pure phantom (a field nothing reads — the majority of the cluster) but not "read then ignored." "Flows into a throw/reject" is a v2 body-analysis extension, flagged, not silently omitted.

**SDK coverage — replacing the 341-line hand map:**

```ts
correspond(p)
  .from(Object.keys(ROUTE_PERMISSIONS).filter(isContentRoute), routeToSdkKey) // derive the mapping by convention
  .to(sdkMethodKeys(p)) // methods discovered from the SDK AST
  .should()
  .beBijective()
  .check()
```

Where the route→method mapping is genuinely non-mechanical (naming differs irreducibly), the user still supplies `routeToSdkKey` — but the primitive then guarantees the map's **domain = the real route set** and **range ⊆ the real method set**, both by identity, replacing the hand-count. It cannot eliminate an irreducible mapping (see limits), only make its completeness and non-staleness a derived, identity check.

## What it deliberately does NOT do (honest limits)

- **It does not manufacture independence.** Two hand-typed arrays compared to each other is not a guard; the primitive can't detect that. Stated in docs, encoded in the acceptance red-proof.
- **It does not prove enforcement flow.** v1 = "referenced"; "flows into a reject" is v2.
- **It does not eliminate an irreducible mapping function** (route→SDK-method). It bounds and de-rots the map; it can't derive what isn't derivable.
- **The plain-key side has no source location.** Failures on a `readonly string[]` side print the key, not a file:line — unavoidable when the side is a runtime object's keys.

## Relationship to `crossLayer`

Complementary, different jobs:
- **`correspond`** answers *does a match exist?* (set membership / coverage) across two arbitrary key sets, including runtime objects and type fields.
- **`crossLayer`** answers *do the matched things agree?* (pairwise content conditions) across two glob-defined layers of source files.

They compose: `correspond` establishes the pairing exists; `crossLayer` asserts the paired shapes agree. `crossLayer` could plausibly be re-expressed atop `correspond` later, but this proposal does not touch it (YAGNI; `crossLayer` ships and works).

## Why not…

- **…extend `crossLayer`.** It is glob-layer + pairwise-content by construction; correspondence needs arbitrary key sets (runtime object keys, type fields) and existence semantics. Bolting both onto one builder muddies two distinct grammars.
- **…leave it as a plain vitest `Object.keys()` diff (status quo).** That is what cmless did — twice — and one instance shipped the cardinality false-green. The value of a primitive is that identity-not-cardinality and non-vacuity become unwritable-wrong, and the failure is agent-first with file:line. A recipe re-derives those guarantees each time and, per the evidence, gets them wrong.
- **…a warning.** The remedy (add the matrix entry / enforce the limit) is non-optional; per ADR-008 Rule 1 an actionable finding fails. Default `.check()`.

## Acceptance test (ADR-008)

A "does not throw" test is a check that cannot fail. The primitive's own tests must red on injected drift, by identity, both directions, guarded against vacuity — and must pass the Rule-5 question *"what would this do if the guarded thing were fully broken?"*:

- **Missing coverage reds, naming the key:** a fixture where `from` has a key absent from `to` → `everyFromHasATo()` fails and the finding **set** contains that exact key (not "a violation occurred", not a count).
- **Stale orphan reds, naming the key:** a `to` key absent from `from` → `everyToHasAFrom()` fails naming it.
- **Non-vacuity:** an empty `from` (selector matches nothing) **fails** with the empty-side message unless `.allowEmpty('from')` is set — asserted directly (proposal 014 tie-in). `∅ ⊆ B` must never green silently.
- **Independence red-proof:** wire `from` and `to` to the **same** derivation and assert the test suite flags it as non-independent in review (this one is advisory — the primitive can't detect it; the acceptance is that the docs example and the review question exist). 
- **Identity over cardinality:** a fixture where `from` drops one key and gains another (count unchanged) → the check still fails. This is the regression guard for the exact `sdk-coverage` cardinality bug.
- **Vacuity guard on the guard:** assert the fixture is non-degenerate first (both sides non-empty in the positive case) so a passing test isn't `∅ = ∅`.

## Prior art / relationship

- **cmless hand-rolled instances:** `apps/api/tests/unit/architecture/sdk-coverage.test.ts`, `.../limits-enforcement-completeness.test.ts`. This primitive is their generic, identity-correct form.
- **ADR-008 Rule 5** — the governing decision; correspondence is Rule 5 as a primitive. **ADR-008 Rules 1 & 2** — fail + carry-the-remedy, baked in.
- **[Proposal 014](./014-empty-selector-safety.md)** — non-vacuity; the empty-side rule here is 014 applied to a relation. Build order: 014's empty-selector machinery is the substrate; land it first or share the zero-match detection.
- **`crossLayer`** — adjacent (pairwise content vs existence); see §Relationship.
- **[ADR-006](../adr/006-framework-rules-architecture.md)** — `correspond` is a generic primitive; the CMS-specific rules (route↔matrix, limit↔enforcement) are *arguments*. Framework-specific correspondence rules (e.g. `@ts-archunit/fastify`: every route ↔ schema) are tier-3 packages built on it.

## Honest sizing

- **Core (small):** a builder holding two `{ keys, keyFn }` sides + a set-difference assertion returning `ArchViolation[]`. The set math is trivial; the value is the baked-in identity/non-vacuity/agent-first properties. Reuses existing selection + `ArchViolation` + terminal machinery.
- **The real work:** the key extractors for AST sides (map an element → key), and the `referencedLimitFields` / `sdkMethodKeys` style helpers the examples imply — these are small body/selection scans, and the phantom-limit "flows-into-reject" variant is deferred to v2.
- **Open question:** the terminal names (`everyFromHasATo` / `everyToHasAFrom` / `beBijective`) — the only bikeshed. Everything else follows existing patterns.

## Alternatives considered

- **Ship only the two cmless rules (route↔matrix, phantom-limit) as standard rules, not a primitive.** Rejected: they are CMS-specific *arguments* to a generic relation; baking them into core violates ADR-006, and the next project needs a third and a fourth. The primitive is the lego brick; the rules are compositions.
- **A `coverage()` smell detector instead of a builder.** Rejected: smells default to `.warn()` and have their own (no `.that()`) grammar; correspondence is an assertion with a non-optional remedy and wants the standard `.rule()`/`.check()` terminals.
- **Fold into a generalized "relation-over-a-set" family now** (consistency + correspondence + canonicity as one builder). Attractive and probably the eventual shape, but YAGNI for one proposal — correspondence is the piece with ~24 bugs of evidence. Note the family in the roadmap; build the evidenced member.
