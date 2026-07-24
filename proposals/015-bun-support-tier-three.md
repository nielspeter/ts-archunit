# Proposal 015 — Bun Support Is a Tier-3 Package, Not a Core Preset

**Status:** Draft 2 — revised after architect + product review (2026-07-24). Both reviewers approve the decision; the recommendation is unchanged (no core Bun preset; tier-3 gated; 016 first).
**Priority:** Low — decision/scoping, no core work. The question keeps recurring; this settles where the answer lives.
**Affects:** Nothing in core. Defines the shape and the entry bar for a possible separate package.
**Origin:** Repeated "do we need a Bun preset?" during the bun-petclinic session (2026-07-23), where ts-archunit was applied to a real Bun/vertical-slice app. This proposal records the ADR-006 reasoning so the question stops being re-litigated from scratch.

> **"Bun preset" is not a core-preset question.** [ADR-006](../adr/006-framework-rules-architecture.md) puts runtime/framework-specific rules in **separate npm packages** and requires real-project validation first. Bun is a runtime, not a language feature — so the only coherent form of the question is: _should there be a tier-3 `@ts-archunit/bun`, and what would justify it?_

## Changes in draft 2

The decision holds; the reviews sharpened the evidence under it and removed two things that were false-green in their own right.

- **Fixed the decomposition table's false-green.** Row 1 conflated an _import_ (`bun:sqlite`) with a _global_ (`Bun.serve`/`Bun.SQL`). `restrictedPackages` is import-based (`layered.ts:93` → `notImportFrom`) and **cannot see global-namespace access** — a rule confining `bun:sqlite` passes green while `Bun.SQL` is used freely. Split into two rows; stated the false-green. "4/5 already shipped" is really **~3.5/5**.
- **Noted `restrictedPackages` is `layeredArchitecture`-only.** It does not exist on `strictBoundaries` (`onlyImportFrom`, `boundaries.ts:139`) — and the triggering app is a vertical-slice/`strictBoundaries` app. The "already shipped" story was optimistic _for the actual app_; added the real vertical-slice confinement path.
- **Reconciled "cannot express" with 016's PROBE2.** Negative-content handler rules ("no `new Error`", "no inline DB access") **are** expressible today at **module** granularity — `searchModuleBody` descends into nested arrow bodies. Narrowed the gap to **positive per-handler** assertions + precise handler isolation. Sharper, and it strengthens the tier-3 case.
- **Made the recipe discoverable and handed over the today-workaround.** A recipe only helps if found: committed to a search-friendly title/tags, a Recipes/Runtimes index entry, and a one-line FAQ. Added a "handler rules: now vs pending" note giving users the `modules().notContain(...)` workaround today.
- **Filed the follow-ups.** `runtimeIsolation` promoted from conditional to a **filed** follow-up (the vertical-slice trigger already fired); footgun #2 (`onlyImportFrom` whitelisting ergonomics) homed as a docs item; `functions.md:19` overclaim cross-referenced (ships now regardless of 015/016); the `isRouteHandler()` name-collision with `@ts-archunit/fastify` noted.
- **"second real app" → "second, _independently-designed_ app"** for the tier-3 gate (a second app by the same team validates the conventions twice, not generality — ADR-008 independence), plus the intermediate `definePredicate`-in-project step.

## The category error

ADR-006's tiers:

| Tier                | Where                     | Example                                        |
| ------------------- | ------------------------- | ---------------------------------------------- |
| Core primitives     | `ts-archunit`             | `call()`, `newExpr()`, `notImportFrom()`       |
| Standard rules      | `ts-archunit/rules/*`     | `noAnyProperties()`, `noEval()`                |
| **Framework rules** | **separate npm packages** | `@ts-archunit/fastify`, `@ts-archunit/drizzle` |

Proposal 010 (JSX) is the exact precedent for the boundary. JSX went into **core** on one stated ground: _"JSX is a TypeScript language feature (not React-specific) — Preact, Solid, and custom JSX runtimes all use the same syntax. The entry point is `jsxElements`, not `reactComponents`."_ And it sent the runtime-specific remainder away: _"If React-specific rules emerge later (hooks, context, suspense), those go in a separate package per ADR-006."_

Apply that test to Bun. `Bun.serve`, `bun:sqlite`, `Bun.SQL`, `bun:test` are **runtime APIs**, not language syntax. They are on the Fastify/Drizzle side of proposal 010's line, not the JSX side. **A Bun preset in core is the shape ADR-006 and proposal 010 both reject.** My earlier "no preset" answer was right in substance and wrong in framing: the objection isn't "no such preset should exist," it's "core is the wrong tier."

## What a "Bun preset" would actually bundle — and where each piece belongs

Decomposing everything we reached for on the real app. Note the split that draft 1 missed: **an import specifier and a global namespace are not the same subject**, and only one of them is reachable by the confinement primitive.

| Concern                                                                                                              | Bun-specific?                                                                    | Correct home                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Confine `bun:sqlite` (an **import**) to a layer                                                                      | **No** — same as confining `pg`, `@aws-sdk/*`, `prisma`                          | Generic import primitive. `restrictedPackages` on `layeredArchitecture` (→ `notImportFrom`, `layered.ts:93`) **or** a direct `modules().that().resideInFolder(...).should().notImportFrom('bun:sqlite')`. Bun names are _arguments_. |
| Confine `Bun.*` (a **global**, e.g. `Bun.serve`, `Bun.SQL`) to a layer                                               | **No**                                                                           | Generic **content** matcher — `modules().that()…​.should().notContain(call('Bun.serve'))` / `notContain(access('Bun'))` (`matchers.ts`). **Not** `restrictedPackages` — there is no import to see (see false-green below).           |
| Repositories throw typed errors                                                                                      | **No**                                                                           | `rules/errors` `noGenericErrors()` — used verbatim on the Bun app                                                                                                                                                                    |
| No `as` / `!` / `any`                                                                                                | **No** (a project standard — [ADR-005](../adr/005-no-any-no-type-assertions.md)) | `rules/typescript` — used verbatim                                                                                                                                                                                                   |
| Vertical-slice isolation                                                                                             | **No**                                                                           | `strictBoundaries` — used verbatim                                                                                                                                                                                                   |
| **"Every `Bun.serve` route handler validates input / is async / holds no inline DB access" (positive, per-handler)** | **Yes**                                                                          | Needs a Bun-shape-aware selector — see below                                                                                                                                                                                         |

### The false-green this split exposes (ADR-008)

`restrictedPackages` is **import-based**. If a user reaches for it to confine a _global_ —

```ts
layeredArchitecture(p, { /* … */ restrictedPackages: { 'src/db/**': ['bun:sqlite'] } })
```

— that rule confines the `bun:sqlite` **import** correctly, but says **nothing** about `Bun.SQL` / `Bun.serve`, which carry no import statement. A handler in the web layer can open `new Bun.SQL(...)` and the rule stays **green**. That is a textbook ADR-008 false-green — _"what would this test do if the thing it guards were completely broken?"_ → it passes. Global-namespace confinement is therefore **not shipped** by any confinement primitive; it is only expressible through the generic content matchers above, and the docs recipe must say so out loud so nobody mistakes `restrictedPackages` for a Bun-global guard.

### …and it is `layeredArchitecture`-only

`restrictedPackages` exists **only** on `layeredArchitecture` (`layered.ts:21`), **not** on `strictBoundaries` (which uses `onlyImportFrom`, `boundaries.ts:139`). The bun-petclinic app is a **vertical-slice/`strictBoundaries`** app — it has neither a layer order nor a no-cycles-across-layers shape. So the "already shipped, via `restrictedPackages`" story is optimistic _for the app that triggered this proposal_: reaching `restrictedPackages` would force `layeredArchitecture`'s `layer-order` + `no-cycles` rules onto an app that has neither. The confinement path a vertical-slice app actually uses today is the **direct** rule —

```ts
modules(p).that().resideInFolder('src/features/**').should().notImportFrom('bun:sqlite') // + notContain(access('Bun.SQL')) for the global half
```

— which is exactly the extraction the `runtimeIsolation` follow-up would package (below).

**Tally.** Of the six rows, the four runtime-agnostic non-handler rows ship verbatim, but row 1 splits: the **import** half ships (via `restrictedPackages` on layered, or a direct rule anywhere), the **global** half ships only as generic content-matching and **false-greens** through the confinement primitive one would naturally reach for. Call it **~3.5/5 already shipped** — not the tidy 4/5 draft 1 claimed. A `bunPreset()` bundling the shipped rows buys one thing: not typing the package names. That is an alias, and it costs the maintenance of tracking Bun's API surface plus the "then where's the Node/Deno/Workers preset" matrix ADR-006's tiering exists to avoid.

The **final row is the only genuinely Bun-specific concern** — and, narrowed by 016's probe (next), it is _narrower_ than draft 1 said.

## The one thing that would justify a package: positive, per-handler rules on `Bun.serve({ routes })` handlers

On the real app, `noGenericErrors()` worked because it targeted repository **classes** (`classes().that().resideInFile('**/repo.ts')`). But a Bun app's HTTP handlers are **arrow functions inside an object literal**:

```ts
Bun.serve({
  routes: {
    '/owners/:id': {
      GET: (req) => {
        /* … */
      },
    },
  },
})
```

Draft 1 lumped every handler rule into "a generic rule cannot express this." **[Proposal 016](./016-selectable-object-literal-arrows.md)'s PROBE2 corrects that.** `modules().notContain(...)` reaches nested arrow bodies — `searchModuleBody` (`body-traversal.ts`) walks all descendants by default and **reds at the `/oups` handler's `new Error(...)`**. So the split is:

| Handler rule shape                                                                                                                                                                                                             | Expressible today?      | Via                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Negative content** — "handlers throw no `new Error`", "no inline `bun:sqlite`/`Bun.SQL` in a handler"                                                                                                                        | **Yes** (module-scoped) | `modules().that().resideInFile('**/*routes*.ts').should().notContain(newExpr('Error'))` — reaches the nested arrow bodies |
| **Positive, per-handler** — "every handler validates input (`mustCall(/parse/)`)", "every handler is async (`beAsync`)", "no handler exceeds N params", "handler return type is `Response`", plus _which_ handler by name+line | **No**                  | needs the handler as a selectable `ArchFunction` — which `functions()` does not provide                                   |

This **narrows** the gap and **strengthens** the case: the inexpressible set is not "handler rules" but specifically **positive per-subject assertions and precise handler isolation**. That is the higher-value class (where `mustCall`, `beAsync`, param/return rules live) — the negative-content half already has a workaround, so the package's load-bearing content is exactly the positive-assertion half.

**Settled — probed 2026-07-23 against the bun-petclinic fixture** (the reachability question that motivates 016). Three `functions(p)` probes:

- **P1** — `functions().resideInFile('**/main.ts').should().notExist()` **passed**: functions() collects **zero** functions in `main.ts`. The handlers there sit directly in the `Bun.serve({ routes: { … } })` literal and are not collected.
- **P2** — the same over `owners/routes.ts` collected **exactly three**: `ownerRoutes` (the exported factory) and the two top-level const-arrows `must` and `fullName`. **None of the `GET`/`POST` handler arrows** — they are property values in the object the factory returns.
- **P3** — `functions().resideInFile('**/main.ts').should().notContain(newExpr('Error'))` **passed green**, while `main.ts:40` holds a live `throw new Error(...)` in the `/oups` handler. It passed _vacuously_ — zero subjects — a [proposal-014](./014-empty-selector-safety.md) false-green caught in the act, on the exact rule shape a Bun handler rule would use. (Contrast PROBE2: the same intent expressed via `modules()` reds correctly.)

So `functions()` collects **top-level function declarations and top-level const-bound arrows only**; it does **not** reach arrow functions nested as object-literal property values — the shape of every `Bun.serve` route handler. **The positive-per-handler reachability gap is real.**

Two layers, worth separating before any package is built:

1. **Generic — now [proposal 016](./016-selectable-object-literal-arrows.md).** `functions()` not collecting object-literal / nested arrows is _not_ Bun-specific — it is a general collection-completeness question. If closed in core (016's opt-in `includeObjectLiteralArrows` flag), handlers become reachable as _functions_ — but indistinguishable from every other object-arrow.
2. **Bun-specific.** Isolating _route handlers_ from all other arrows requires knowing they are values under `routes` passed to `Bun.serve` — the shape awareness that is tier-3 by construction, exactly ADR-006's framework-predicate example.

The gap therefore **does** justify a `@ts-archunit/bun` route-handler predicate — but only the positive-assertion half, and only as a **filter over 016's already-selectable object-arrows**. Layer 1 (016) must land first, since closing it shrinks the package to just the `Bun.serve`-shape selector; mis-scoping it into the package would bury a framework-plural capability behind a runtime name.

## Recommendation

1. **No Bun preset in core.** It is the tier ADR-006 and proposal 010 both reject; ~3.5/5 of its content is runtime-agnostic and already shipped, and the missing half is either a false-greening alias (`Bun.*` confinement) or genuinely tier-3 (positive per-handler rules).

2. **Capture what generalized as a _discoverable_ docs recipe, not a package.** ADR-006's real-project validation has begun (bun-petclinic); what proved general there was runtime-agnostic. A recipe only counts if it is found, so it must ship with:
   - a **search-friendly title and tags** — "Bun", "runtime", "vertical-slice", "Bun.serve", "handlers";
   - an entry in a **Recipes / Runtimes index** (alongside a future Deno/Workers row — the point is one page per runtime, none in core);
   - a one-line **FAQ**: _"Does ts-archunit support Bun?"_ → _"Yes, today, with stock rules — see the Bun recipe. There is no Bun package (yet); here's why and what would earn one."_
   - **Handler rules — now vs pending.** The recipe must hand users the workaround explicitly: negative-content handler rules work **today** via `modules().that().resideInFile('**/*routes*.ts').should().notContain(newExpr('Error') | access('Bun.SQL') | …)` (reaches nested handler arrows); positive per-handler rules (`beAsync`, `mustCall`) **wait on [016](./016-selectable-object-literal-arrows.md)**. Do not let a reader conclude "handlers are unreachable."
   - The recipe also documents the two footguns _mistaken_ for "missing Bun support": the absolute-path glob (→ [proposal 014](./014-empty-selector-safety.md)) and `onlyImportFrom` external-whitelisting ergonomics (**footgun #2**, homed below). Neither is what a Bun preset would fix.

3. **`@ts-archunit/bun` stays gated — the gate is a _second, independently-designed_ app.** The reachability question is answered (the gap is real and narrowed to positive per-handler rules). The remaining gate is ADR-006's "never without real-world validation." One app is not validation of generality: a **second app by the same team with the same conventions** validates the conventions _twice_, not the primitive's generality — the ADR-008 independence point (a derivation is unguarded until a _differently-derived_ value disagrees with it). The gate is a second, **independently-designed** Bun app wanting the same positive per-handler rules. Its load-bearing content is one predicate (a route-handler filter over 016's arrows) plus a thin `recommended`. **Land 016 first** (§Relationship in 016).
   - **Intermediate step before a package:** a project that hits this today can `definePredicate` its own `isRouteHandler` in-project (`src/core/define.ts`, exported) — _once 016 makes object-arrows selectable_. That is the honest bridge: negative-content rules need nothing new (`modules().notContain`), positive per-handler rules are **blocked on 016**, and a package is warranted only when a second independent app re-derives the same in-project predicate.

4. **File the follow-ups** (below) rather than leaving them as conditionals.

## Follow-ups filed by this proposal

- **`runtimeIsolation` primitive — filed (not conditional).** Draft 1 said "file _if_ `restrictedPackages` proves too coupled." The vertical-slice trigger **has already fired**: `restrictedPackages` is reachable only via `layeredArchitecture`, which forces layer-order + no-cycles on an app (bun-petclinic) that has neither. A layer-agnostic confinement primitive is warranted now. **Crucially, `runtimeIsolation` is _not_ a synonym for `restrictPackageToLayer`:** an import-only helper (`restrictPackageToLayer`) inherits the exact false-green above — it cannot confine `Bun`/`Deno`/`process`/`Worker` **globals**, which carry no import. `runtimeIsolation` must confine **both** imports (`notImportFrom`) **and** global-namespace access (`notContain(access('Bun'))` / `call('Bun.serve')`) behind one folder-scoped rule. It serves `bun:sqlite`, `pg`, `@aws-sdk/*`, `prisma`, and the Bun/Deno globals identically — the pattern-not-runtime abstraction a Bun preset only gestures at.
- **Footgun #2 — `onlyImportFrom` external-whitelisting ergonomics — scoped as a docs item.** When a boundary must permit a handful of external packages, `onlyImportFrom` requires whitelisting each, which reads awkwardly. This is generic `onlyImportFrom` ergonomics, not Bun. Scoped as a **docs item in the recipe** for now (show the idiom); promote to its own proposal only if it recurs beyond documentation. (Footgun #1 — the absolute-path glob — is correctly [proposal 014](./014-empty-selector-safety.md).)

## Notes

- **`isRouteHandler()` name collision.** ADR-006's `@ts-archunit/fastify` example already claims `predicates/fastify.ts — isRouteHandler(), isFastifyPlugin()` (adr/006, line 42). A `@ts-archunit/bun` `isRouteHandler()` would collide _conceptually_ — two runtime packages, same predicate name, different route shapes. This hints at a future **generic handler-map primitive** over 016's object-arrows (Böckeler's "object of handlers" idiom — `Bun.serve({ routes })`, Hono/Elysia maps, Express handler objects), with each runtime package contributing only the shape filter. Not for now; noted so the name is chosen deliberately when the package is built.
- **`functions.md:19` overclaim ships now, regardless of 015 or 016.** The docs say `functions()` covers _"every function shape in your codebase"_ — it covers every _named_ function shape (016 §Honest sizing). That correction is independent of both proposals and should ship immediately; cross-referenced here because 015's probe (P1–P3) is the evidence that the sentence is false.

## Why the "it recurs across Bun apps" argument does not move it into core

It is true that a Bun app induces recurring structural decisions (where `bun:sqlite` lives, whether handlers validate). But _"recurring structural decisions induced by an API surface"_ **is the definition of a framework concern** — it is why `@ts-archunit/fastify` exists as a tier-3 package rather than core rules. Recurrence justifies a **package**, not core inclusion. The JSX exception was granted for being language-level and runtime-plural (React/Preact/Solid); Bun is neither.

## Alternatives considered

- **Ship `bunPreset()` in core anyway (convenience).** Rejected: it is an alias for `restrictedPackages` + existing rules with Bun names hardcoded — and, as the false-green above shows, an alias that would _silently mis-guard_ `Bun.*` globals. It also opens the runtime-preset matrix ADR-006 tiering exists to prevent. `recommended` is "deliberately thin"; a runtime preset is the opposite.
- **A generic `runtimeIsolation` primitive.** _Accepted — filed as a follow-up above_ (no longer conditional). This is the genuinely reusable extraction; it serves imports _and_ globals across `bun:sqlite`, `pg`, `@aws-sdk/*`, `prisma`, and the Bun/Deno globals identically.
- **Put Bun handler rules in core (like JSX).** Rejected by proposal 010's own test: JSX earned core by being language-level and framework-plural; `Bun.serve` route-shape awareness is single-runtime API knowledge — ADR-006 tier 3 by construction. (The framework-_plural_ part — selecting object-literal arrows at all — is core, and is [proposal 016](./016-selectable-object-literal-arrows.md).)
