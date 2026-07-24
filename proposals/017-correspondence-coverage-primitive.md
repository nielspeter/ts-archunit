# Proposal 017 — Correspondence / Coverage Primitive (`correspondence`)

**Status:** Draft 2 — revised after architect + product review (2026-07-24)
**Priority:** High — it is the single missing primitive behind the two largest recurring bug classes in the reference project (cmless): route↔permission-matrix drift (~12 bugs) and phantom limits (~12 bugs). It is also the generic form of a check cmless has **hand-built twice** because ts-archunit offers no primitive for it.
**Affects:** one new top-level entry point + builder in the public DSL (`src/builders/correspondence-builder.ts`, `correspondence` in `src/index.ts`). The builder extends `TerminalBuilder` (inherits `.rule`/`.excluding`/`.check`/`.warn`/`.violations`/`.severity` unchanged, ADR-003). Depends on two shared foundations from the product direction: **F1** (a filtered-subject materialization contract on `RuleBuilder` — does not exist today) and **F2** (a shared set-difference + non-vacuity core, which `crossLayer` also re-expresses on). No new engine surface (ADR-007 boundary intact); the `keyFn` escape hatch is the one acknowledged raw-node seam (§keyFn). Adjacent to `crossLayer`, whose _existence_ check collapses into the same F2 core (§Relationship).
**Origin:** The 2026-07-24 cmless coverage audit (`cmless/architecture-docs/ts-archunit-coverage-audit-2026-07.md`). Two independent lines of evidence converged on the same gap: the bug corpus (route↔matrix + phantom-limit clusters, ~24 bugs) and two hand-rolled correspondence tests in cmless (`sdk-coverage.test.ts`, `limits-enforcement-completeness.test.ts`) — one of which certifies coverage with a **cardinality** check, the exact [ADR-008](../adr/008-agent-first-failure-surfaces.md) Rule 5 anti-pattern.

## Changes in draft 2

- **Renamed for the public API (product):** entry `correspond` → `correspondence` (entry points are nouns); the two sides are now **named** — `.side(name, source, keyFn?)` — so failures read _"3 routes have no matrix entry"_, not _"3 from-keys"_; set-language terminals `.beComplete()` / `.haveNoOrphans()` / `.beBijective()` replace `.everyFromHasATo()` / `.everyToHasAFrom()`. Names chosen **family-aware** so the future relation-over-a-set family (`consistency`, `canonicity`) slots in with no breaking rename (§Family-aware naming).
- **Materialization keystone made explicit (architect C1):** dropped the false claim that it "reuses existing selection machinery." It does not — `getElements()` is _pre-filter_ and predicate filtering lives only in a private `evaluate()` that returns violations, not subjects. `.side(selection, keyFn)` requires the new **F1** contract (shared with 014's `.expectNonEmpty()`); added to sequencing.
- **Decoupled from proposal 014 (architect C2):** non-vacuity here is a self-contained `keys.length === 0 → fail` on two arrays. Implemented in-builder; the hard 014 build-order dependency is gone, the ADR-008 non-vacuity property stays.
- **Reconciled with `crossLayer` (architect I3):** `haveMatchingCounterpart` _is_ the file↔file one-directional case and ships a live empty-layer false-green. Draft 2 proposes extracting the shared **F2** core and re-expressing crossLayer's existence check on it (fixing that false-green), keeping crossLayer's pairwise-_content_ conditions separate — the ADR-006 / lego-bricks move, not a YAGNI defer.
- **Fixed the worked examples (architect I4):** all snippets now call the real API — `ArchCall.getMethodName()` / `.getArguments()` (not `.method()` / `.stringArg()`), `type.getProperties().map(p => p.getName())` (not `.propertyNames()`). Decided the `keyFn` engine-boundary story (§keyFn).
- **Defined key-collision semantics (architect M5):** each side is a `key → node[]` multimap with a stated collision rule and a named hazard (over-normalizing masks "two subjects, one counterpart" drift); acceptance fixture added.
- **Added two generic code↔code examples (product):** command↔handler, event↔listener — beyond the cmless AST↔runtime cases. Kept route↔matrix as the flagship cmless example.
- **Added the literal↔literal independence heuristic (product):** the builder warns when _both_ sides are supplied literals (the independence footgun).

> **"Every X has a matching Y" is a first-class architectural relation, and ts-archunit cannot state it.** The whole DSL selects _one_ set and asserts a property of its members. But the drift that actually ships is relational: a route with no permission-matrix entry, a declared limit no code enforces, an API route with no SDK method. Each is a set-membership gap between **two independently-derived sets** — which is not incidentally, but _exactly_, the shape ADR-008 Rule 5 demands ("a derivation is unguarded until a differently-derived value disagrees with it"). Correspondence is Rule 5 turned into a primitive.

## Problem

Three real, recurring gaps from cmless, all the same shape:

1. **Route ↔ permission-matrix drift (~12 bugs: 0031, 0033, 0034, 0025, 0013, 0028, 0143, 0030, 0029, 0035, 0141, 0142).** cmless has the right structure — a centralized `ROUTE_PERMISSIONS` map + a fail-closed enforcer. But route↔matrix correspondence is hand-maintained, so it drifts: a route ships without a matrix entry (falls through to 403), a param-name mismatch (`:userId` vs `:id`) breaks normalization (0013), a whole surface (`requirePlatformScope`, 72 inline preHandlers) bypasses the matrix (0143). The only existing guard is a **runtime integration test** needing testcontainers — slow, flaky (0106). A static correspondence check catches the same class at compile time.

2. **Phantom limits (~12 bugs: 0322, 0331, 0334, 0327, 0326, 0330, 0335, 0343, 0342, 0091).** A limit exists in a config/tier/plan table (and shows in usage reports and pricing docs) but **no call-site reads it to reject**. `assetStorageBytes` — "stored, seeded, shown in a telemetry gauge, and enforced by no one" (0331). `maxGraphQLRequestSizeBytes`, `maxResponseSizeBytes` — "read nowhere" (0326). This is a coverage gap: the set of _declared_ limits is not covered by the set of _enforced_ limits.

3. **API route ↔ SDK method coverage.** `sdk-coverage.test.ts` (341 lines) asserts every content route has an SDK method — via a **hand-typed** `route → method` map, and its third assertion is `mapCount === permCount` (cardinality, not identity: it passes when one route is dropped and another added). `limits-enforcement-completeness.test.ts` is a second hand-rolled instance, this one carefully ADR-008-aware (injected-phantom red-proof, shrink-only ratchet) — a sophisticated author reinventing the primitive by hand.

### Why the current DSL can't express it

Every entry point (`modules`, `classes`, `functions`, `types`, `calls`, `slices`, `jsxElements`) selects **one** set and runs a per-element condition. `notExist()` asserts a set is empty; there is no way to assert **set A is covered by set B** when A and B are _differently derived_. `crossLayer` is the closest, but it does **pairwise content conditions** on already-matched glob layers (does the matched route's shape agree with the matched schema's shape) — not **existence/coverage** (does a match exist at all), and it is glob-path-oriented, so it cannot relate an AST set to a runtime object's keys or a type's fields (§Relationship).

## The insight: correspondence is ADR-008 Rule 5 as a primitive

ADR-008 Rule 5: _"a derivation is unguarded until a differently-derived value disagrees with it."_ A correspondence check is precisely two derivations plus a disagreement test:

- side **routes** = routes discovered by walking the AST (`calls().onObject('app')…`)
- side **matrix** = `Object.keys(ROUTE_PERMISSIONS)` read from the real runtime config
- the assertion fires when a key on one side has no match on the other.

The two sides fail in different ways (AST vs runtime object), so a drift on either is caught by the other — the independence Rule 5 requires. This is why correspondence is worth a primitive and not just sugar: it is the _canonical_ Rule-5 guard, and packaging it makes the two mandatory anti-false-green properties (identity-not-cardinality, non-vacuity) impossible to get wrong, instead of hand-rolled and gotten wrong (the `mapCount === permCount` bug).

## Proposed design

A new top-level entry. **Two named sides**, each a **key set**; assert the relation between the key sets by **identity**.

```ts
import { correspondence, calls } from '@nielspeter/ts-archunit'
import { ROUTE_PERMISSIONS } from '../src/config/route-permissions.js'

correspondence(p)
  .side(
    'routes', // side A — the name shows up verbatim in failures
    calls(p)
      .that()
      .onObject('app')
      .and()
      .withMethod(/^(get|post|put|patch|delete)$/),
    (c) => {
      const verb = c.getMethodName()?.toUpperCase()
      const pathArg = c
        .getArguments()[0]
        ?.getText()
        .replace(/^['"`]|['"`]$/g, '')
      return `${verb} ${normalizePath(pathArg ?? '')}`
    },
  )
  .side(
    'matrix', // side B — an already-derived key set (runtime-derived)
    Object.keys(ROUTE_PERMISSIONS),
  )
  .should()
  .beComplete() // every side-A key (route) is present in side B → else FAIL, listing the routes
  .andShould()
  .haveNoOrphans() // every side-B key (matrix entry) maps to a real route → else FAIL, listing stale keys
  .rule({
    id: 'auth/route-matrix-correspondence',
    because:
      'A route with no permission-matrix entry falls through to a 403; a stale entry hides a deleted route.',
    suggestion:
      'Add the route to ROUTE_PERMISSIONS (or remove the stale entry). Param names must match: use :userId, not :id.',
  })
  .check()
```

### The pieces

- **`.side(name, source, keyFn?)`** — declares one side. `name` is the author's own word for it (`'routes'`, `'matrix'`) and is what failure messages print, so output reads in domain terms. `source` is either
  - a ts-archunit **selection** (any `RuleBuilder`, e.g. `calls(p).that()…`), with `keyFn` mapping each _filtered_ subject to a `string` key (or `readonly string[]` for subjects that contribute several keys — a type's property names), or
  - an already-derived **`readonly string[]` / `ReadonlySet<string>`**, with `keyFn` an optional normalizer (default identity).
    The first `.side()` declared is **side A**; the second is **side B**. Exactly two sides.
- **`.should()` / `.andShould()`** — readability markers (return `this`), same as the rest of the DSL. Optional.
- **Set-language terminals** (configure the direction(s); `.check()` executes):
  - `.beComplete()` — coverage: every **side-A** key is present in **side-B** (A ⊆ B). Failure lists the uncovered side-A keys (anchored to their AST node's file:line where side A is a selection).
  - `.haveNoOrphans()` — every **side-B** key maps back to a **side-A** key (B ⊆ A). Failure lists the orphan side-B keys by name.
  - `.beBijective()` — both, and the **recommended default** when both sides are independently derived (a one-directional check silently tolerates drift on the unchecked side).
- **Composable** with `.rule({ id, because, suggestion })`, `.excluding()`, `.warn()`/`.check()`/`.violations()` — inherited from `TerminalBuilder` (ADR-003), identical to every other builder.

### Family-aware naming

The names are chosen so the eventual **relation-over-a-set family** (correspondence / consistency / canonicity — see §Alternatives) adds members _without a breaking rename_: the noun entry (`correspondence`, later `consistency`, `canonicity`), the `.side(name, source, keyFn?)` vocabulary, and the set-language terminals are all family-general. `correspondence` is the member with ~24 bugs of evidence; the family is named, not built.

### `keyFn` and the engine boundary (ADR-007)

**Decision: `keyFn` is a deliberate, documented raw-element escape hatch.** Key extraction is inherently project-specific — normalizing a route path, reading `register(XCommand)`'s first argument, listing a type's fields — and cannot be enumerated in core. `keyFn` hands the author the subject (an `ArchCall`, or a raw ts-morph node for the other entry points) and asks for a `string | readonly string[]`. This is the one place correspondence pierces the ADR-007 boundary, and it does so knowingly.

To keep the common path _off_ raw nodes, ship a tiny **stable key vocabulary** for the frequent cases so most rules never write a `keyFn`:

- `byName()` — the declaration's name (classes, functions, types).
- `byArg(i)` — a call's _i_-th string-literal argument, via `ArchCall.getName({ withArgument: i })` (already degrades gracefully on non-literals).
- `byPropertyName()` — each of a type's property names (a `readonly string[]` extractor; ties into the multimap below).

The vocabulary covers the examples below except the two that genuinely need normalization (route path, command arg); those use `keyFn` explicitly, which is the point of the escape hatch.

### Key-collision semantics

A `keyFn` may return the same key for two subjects (a `readonly string[]` extractor, or a normalizer that collapses `:userId`/`:id`). Each side is therefore materialized as a **`key → node[]` multimap**, not a set:

- **Stated rule:** the correspondence relation is computed over each side's **key domain** (the multimap's keys). Two subjects under one key are _retained_ — failure messages list every subject at a colliding key (with file:line on the AST side), so a miss is never anonymized.
- **The hazard:** over-normalizing can _mask_ a genuine "two subjects, one counterpart" drift — two routes that normalize to one matrix key look like one route, hiding exactly the class 0013 is about. So normalization is dangerous, but it is also _sometimes the intent_ (param normalization is the whole point of the 0013 fix), which is why collision cannot fail by default.
- **The opt-in guard:** `.distinctKeysOn('routes')` fails when side `routes` maps two distinct subjects to one key — for authors who know their side should be injective. Off by default.

### Baked-in ADR-008 properties (the reason it's a primitive, not a recipe)

1. **Identity, never cardinality.** The assertion compares key **sets** and reports the specific missing/orphan keys. There is no count comparison in the API surface — the `mapCount === permCount` mistake is _unwritable_. (ADR-008 Rule 5 corollary: "compare identities, not integers.")
2. **Non-vacuity by default (self-contained, in-builder).** If either side's key domain is **empty**, the check **fails** with a distinct message ("side `routes` produced 0 keys — correspondence over an empty side certifies nothing"). This is a two-line `keys.length === 0 → fail` on each side's materialized domain — it shares the _principle_ with [proposal 014](./014-empty-selector-safety.md) but nothing load-bearing, so 017 does not build-order behind 014. Opt out with `.allowEmpty('routes')` only where a side is legitimately sometimes-empty, stating why. `∅ ⊆ anything` must never green silently.
3. **Agent-first failure.** The message names _which_ keys are uncovered/orphan, in the side's own name, and carries the sanctioned remedy via `.rule({ suggestion })` (ADR-008 Rule 2). Per-key file:line comes from the AST side; the plain-key side prints the key verbatim (honest limitation, below).
4. **Independence is stated, and cheaply heuristic-checked.** The primitive is only a guard if the two sides are _differently derived_; it cannot mechanically prove that. So the docs state the rule bluntly — **derive each side from a different source** — _and_ the builder adds a cheap tripwire: **when both sides are supplied literals** (neither is a `RuleBuilder` selection), it **warns** that the check derives nothing independently and is almost certainly a non-guard (two literals get edited together). It is a warn, not a fail — the heuristic can flag the obvious footgun, not prove independence. §Acceptance encodes the Rule-5 question "what would this do if the guarded thing were fully broken?"

### Worked examples

**Generic — command ↔ handler (both sides AST-derived):**

```ts
import { correspondence, classes, calls } from '@nielspeter/ts-archunit'

correspondence(p)
  .side(
    'commands',
    classes(p)
      .that()
      .haveNameMatching(/Command$/),
    (c) => c.getName() ?? '',
  )
  .side(
    'handlers',
    calls(p).that().onObject('bus').and().withMethod('register'),
    (c) => c.getArguments()[0]?.getText() ?? '', // bus.register(FooCommand, …)
  )
  .should()
  .beComplete() // every Command class is registered on the bus
  .rule({
    id: 'cqrs/every-command-has-a-handler',
    because:
      'A command with no registered handler throws at dispatch, not at build — green until runtime.',
    suggestion: 'Register it: bus.register(XCommand, handler).',
  })
  .check()
```

**Generic — event ↔ listener (both sides AST-derived, differently derived from `emit` vs `on`):**

```ts
correspondence(p)
  .side(
    'emitted',
    calls(p).that().withMethod('emit'),
    (c) =>
      c
        .getArguments()[0]
        ?.getText()
        .replace(/^['"`]|['"`]$/g, '') ?? '',
  )
  .side(
    'subscribed',
    calls(p).that().withMethod('on'),
    (c) =>
      c
        .getArguments()[0]
        ?.getText()
        .replace(/^['"`]|['"`]$/g, '') ?? '',
  )
  .should()
  .beComplete() // every emitted event has at least one listener
  .rule({
    id: 'events/no-unheard-events',
    because: 'An event emitted with no listener is a silent no-op — the feature is dead but green.',
    suggestion: 'Add a listener (emitter.on(...)) or remove the emit.',
  })
  .check()
```

**cmless — phantom limits (0331, 0326, …)** — declared limit fields must each be read somewhere:

```ts
import { correspondence, types } from '@nielspeter/ts-archunit'

correspondence(p)
  .side(
    'declared',
    types(p)
      .that()
      .haveNameMatching(/^CapacityTierLimits$/),
    (t) => t.getProperties().map((p) => p.getName()), // AST: the declared limit fields (readonly string[])
  )
  .side(
    'enforced',
    referencedLimitFields(p), // independently derived: identifiers referenced as `.limits.<field>` across src → readonly string[]
  )
  .should()
  .beComplete()
  .rule({
    id: 'limits/no-phantom-limits',
    because:
      'A declared limit that no call-site reads is advertised but unenforced (bugs 0331, 0326).',
    suggestion:
      'Add an enforcement call-site that reads the limit and rejects when exceeded, or remove the field.',
  })
  .check()
```

_Honest scope:_ v1 asserts the field is **referenced**; it does not prove the reference **flows into a reject** (value-flow). That catches the pure phantom (a field nothing reads — the majority of the cluster) but not "read then ignored." "Flows into a throw/reject" is a v2 body-analysis extension, flagged, not silently omitted.

**cmless — SDK coverage (the 341-line hand map):** derive side A from `Object.keys(ROUTE_PERMISSIONS).filter(isContentRoute)` via a `routeToSdkKey` convention, side B from the SDK methods discovered in the AST, and assert `.beBijective()`. Where the route→method mapping is genuinely non-mechanical the author still supplies `routeToSdkKey` — but the primitive then guarantees the map's **domain = the real route set** and **range ⊆ the real method set**, both by identity, replacing the hand-count. It cannot eliminate an irreducible mapping (see limits), only make its completeness and non-staleness a derived, identity check.

## What it deliberately does NOT do (honest limits)

- **It does not manufacture independence.** Two hand-typed arrays compared to each other is not a guard; the primitive can only _warn_ on the both-sides-literal case (above), not detect subtler shared derivation. Stated in docs, encoded in the acceptance red-proof.
- **It does not prove enforcement flow.** v1 = "referenced"; "flows into a reject" is v2.
- **It does not eliminate an irreducible mapping function** (route→SDK-method). It bounds and de-rots the map; it can't derive what isn't derivable.
- **It does not un-mask over-normalization by default.** A `keyFn` that collapses distinct subjects to one key hides "two subjects, one counterpart" drift unless `.distinctKeysOn(side)` is set — because normalization is often the intent.
- **The plain-key side has no source location.** Failures on a `readonly string[]` side print the key, not a file:line — unavoidable when the side is a runtime object's keys.

## Relationship to `crossLayer`

`crossLayer`'s `haveMatchingCounterpart` (`src/conditions/cross-layer.ts:15`) **is** the file↔file, one-directional instance of correspondence — with two problems the reviews surfaced: an O(n²) Cartesian pairing, and a **live empty-layer false-green** (`cross-layer.ts:15,38–52`: an empty left layer iterates nothing → zero violations → green — the exact ADR-008 sin the tool sells against).

Draft 2's move (F2, per the product direction and ADR-006 / lego-bricks): **extract a shared set-difference + non-vacuity core**, have `correspondence` sit on it, and **re-express `crossLayer`'s existence check on the same core** — which fixes the shipped false-green as a side effect. `crossLayer`'s pairwise-**content** conditions (`haveConsistentExports`, `satisfyPairCondition` — `cross-layer.ts:66,107`) stay exactly where they are; only the _existence_ check collapses in. This is the correct lego-bricks factoring, not a YAGNI defer.

The two then divide cleanly and compose:

- **`correspondence`** answers _does a match exist?_ (set membership / coverage) across two arbitrary key sets, including runtime objects and type fields.
- **`crossLayer`** answers _do the matched things agree?_ (pairwise content conditions) across two glob-defined layers of source files.

`correspondence` establishes the pairing exists; `crossLayer` asserts the paired shapes agree.

## Why not…

- **…extend `crossLayer` in place.** It is glob-layer + pairwise-content by construction; correspondence needs arbitrary key sets (runtime object keys, type fields) and existence semantics. The correct sharing is _below_ both — the F2 core — not bolting two grammars onto one builder.
- **…leave it as a plain vitest `Object.keys()` diff (status quo).** That is what cmless did — twice — and one instance shipped the cardinality false-green. The value of a primitive is that identity-not-cardinality and non-vacuity become unwritable-wrong, and the failure is agent-first with file:line. A recipe re-derives those guarantees each time and, per the evidence, gets them wrong.
- **…a warning (for the assertion itself).** The remedy (add the matrix entry / enforce the limit) is non-optional; per ADR-008 Rule 1 an actionable finding fails. Default `.check()`. (The both-sides-literal _independence heuristic_ warns, because it can't prove the problem — a different thing from the assertion.)

## Acceptance test (ADR-008)

A "does not throw" test is a check that cannot fail. The primitive's own tests must red on injected drift, by identity, both directions, guarded against vacuity — and must pass the Rule-5 question _"what would this do if the guarded thing were fully broken?"_:

- **Missing coverage reds, naming the key:** a fixture where side A has a key absent from side B → `.beComplete()` fails and the finding **set** contains that exact key (not "a violation occurred", not a count).
- **Stale orphan reds, naming the key:** a side-B key absent from side A → `.haveNoOrphans()` fails naming it.
- **Non-vacuity (in-builder):** an empty side A (selector matches nothing) **fails** with the empty-side message unless `.allowEmpty('A')` is set — asserted directly. `∅ ⊆ B` must never green silently.
- **Identity over cardinality:** a fixture where side A drops one key and gains another (count unchanged) → the check still fails. The regression guard for the exact `sdk-coverage` cardinality bug.
- **Key collision (M5):** a fixture where a `keyFn` collapses two distinct subjects to one key → by default the coverage check still passes (documented behavior) **and** `.distinctKeysOn(side)` reds naming both colliding subjects. Proves the mask is a _choice_, not an accident.
- **Independence heuristic:** wire both sides to supplied literals → the builder **warns** (not fails) that the check is likely a non-guard; assert the warning fires. Wire one side to a selection → no warning.
- **Vacuity guard on the guard:** assert the fixture is non-degenerate first (both sides non-empty in the positive case) so a passing test isn't `∅ = ∅`.

## Prior art / relationship

- **cmless hand-rolled instances:** `apps/api/tests/unit/architecture/sdk-coverage.test.ts`, `.../limits-enforcement-completeness.test.ts`. This primitive is their generic, identity-correct form.
- **ADR-008 Rule 5** — the governing decision; correspondence is Rule 5 as a primitive. **ADR-008 Rules 1 & 2** — fail + carry-the-remedy, baked in.
- **F1 — filtered-subject materialization on `RuleBuilder`** (product direction). Today `getElements()` (`src/core/rule-builder.ts:277`) is _pre-filter_; predicate filtering happens only inside private `evaluate()` (`rule-builder.ts:340–350` — filters at :345, discards the count at :350, returns `ArchViolation[]`). **No method yields the filtered subject set**, so `.side(selection, keyFn)` cannot be built until F1 lands. F1 is **shared** with proposal 014's `.expectNonEmpty()` — design it once as a general contract.
- **F2 — shared set-difference + non-vacuity core** (product direction). Powers correspondence; `crossLayer`'s existence check re-expresses on it, fixing the empty-layer false-green (§Relationship).
- **[Proposal 014](./014-empty-selector-safety.md)** — shares the _non-vacuity principle_ only. 017's empty-side rule is a self-contained in-builder check; **no build-order dependency** (decoupled in draft 2).
- **`crossLayer`** — its existence check is the file↔file case of this primitive; folds into F2 (§Relationship).
- **[ADR-006](../adr/006-framework-rules-architecture.md)** — `correspondence` is a generic primitive; the CMS-specific rules (route↔matrix, limit↔enforcement) are _arguments_. Framework-specific correspondence rules (e.g. `@ts-archunit/fastify`: every route ↔ schema) are tier-3 packages built on it.

## Honest sizing

- **Prerequisites (not free):** **F1** (filtered-subject materialization on `RuleBuilder`) and **F2** (set-difference + non-vacuity core). F1 is the keystone — without it a `.side(selection, keyFn)` cannot see the post-`.that()` subjects. Both are shared foundations (F1 with 014, F2 with `crossLayer`), so the cost is amortized, not 017-only.
- **Core (small, once F1/F2 exist):** a `TerminalBuilder` subclass holding two named `{ name, keyFn, source }` sides; `collectViolations()` materializes each side's `key → node[]` multimap (F1 for selections), runs the F2 set-difference in the requested direction(s), and emits `ArchViolation[]`. The set math is trivial; the value is the baked-in identity / non-vacuity / agent-first / collision properties.
- **The real work:** the AST-side key extractors — the `byName`/`byArg`/`byPropertyName` vocabulary plus the `referencedLimitFields` / `sdkMethodKeys` style helpers the examples imply (small body/selection scans). The phantom-limit "flows-into-reject" variant is deferred to v2.
- **Resolved in draft 2:** terminal names (`.beComplete()` / `.haveNoOrphans()` / `.beBijective()`), side naming (`.side(name, …)`), and the `keyFn` boundary decision — no longer open bikesheds.

## Alternatives considered

- **Ship only the two cmless rules (route↔matrix, phantom-limit) as standard rules, not a primitive.** Rejected: they are CMS-specific _arguments_ to a generic relation; baking them into core violates ADR-006, and the next project needs a third and a fourth. The primitive is the lego brick; the rules are compositions.
- **A `coverage()` smell detector instead of a builder.** Rejected: smells default to `.warn()` and have their own (no `.that()`) grammar; correspondence is an assertion with a non-optional remedy and wants the standard `.rule()`/`.check()` terminals.
- **Fold into a generalized "relation-over-a-set" family now** (consistency + correspondence + canonicity as one builder). Attractive and probably the eventual shape, but YAGNI for one proposal — correspondence is the piece with ~24 bugs of evidence. Draft 2 names the family and picks family-aware surface (§Family-aware naming) so the members slot in without a breaking rename; it builds only the evidenced member.
