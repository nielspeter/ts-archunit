# Plan 0069 — No rule may certify nothing

**Status:** DRAFT 2 — rewritten after `/review-proposal` (architect + product, 2026-07-25). Not yet re-reviewed.
**Priority:** Highest open item. The defect the tool exists to prevent, committed by the tool, measured in every codebase we have pointed it at.
**Effort:** ~3 days across four releases. Only release 3 is breaking.
**Supersedes:** part C of [plan 0067](./0067-empty-selector-safety.md); absorbs [proposal 019](../proposals/019-rules-that-enforce-nothing-must-fail.md); closes [bug 0011](../bugs/0011-dogfood-rules-select-nothing.md).
**Prerequisite:** [bug 0014](../bugs/0014-bare-package-import-globs-match-nothing.md) ships first, alone.

## What changed in draft 2

Draft 1 proposed guarding **the collapse** — fail when a pipeline stage reaches zero. Review falsified that at four points, so the mechanism is now **glob satisfiability**: ask whether a glob can match this project at all, independent of what any rule selected.

| Draft 1                                  | Why it failed review                                                                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guard the empty funnel                   | Cannot see a typo'd glob in a condition (`subjects > 0`, every stage healthy) — draft 1 admitted this and bolted on a phase                                                              |
| Mark predicates with `pathScope`         | `not()`/`and()`/`or()` build fresh `{description, test}` objects and **drop any marker**. One shipped preset (`presets/layered.ts:95`) and our own `excluding()` JSDoc use that spelling |
| "the funnel `census()` already reports"  | **False.** `census.files` is derived from candidates, so `files === 0 ⟺ candidates === 0`. The two headline rows were not computable from anything that exists                           |
| `.allowEmpty(reason)` on the shared root | **Collides** with `CorrespondenceBuilder.allowEmpty(sideName)`. Both `(string) => this`; compiling the pair produces **zero diagnostics**, and they mean opposite things                 |
| Semantic emptiness fails by default      | The plan contradicted itself (funnel table vs composite prose) and silently reversed proposal 014's _"Why not 'empty always fails'"_ section without rebutting it                        |

Three further glob positions were found (`crossLayer().layer()`, `SmellBuilder.inFolder()`, `resolvers()`), plus a hole in the **already-shipped** 0067 guards.

---

## Problem

A rule that cannot match anything passes. Measured:

| Where                 | What                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| This repo             | 13 dogfood rules select nothing outside a checkout named `ts-archunit`; 1 selects nothing everywhere and hides a live violation               |
| This repo's own suite | 8 tests assert on rules that select nothing — one **encodes the false green as expected behaviour** (`tests/smells/smell-builder.test.ts:70`) |
| An adopting codebase  | 7 rule sites, **2 of them security rules** — JWT verification and internal-route auth, both guarding nothing                                  |
| Our shipped JSDoc     | 15 examples use unanchored globs; `cross-layer-builder.ts:56` is a documented example that matches nothing                                    |
| Our shipped presets   | `layeredArchitecture`'s restricted-packages rule is dead twice over — `not(resideInFolder(...))` plus a bare package name                     |

`.expectNonEmpty()` exists for this and is opt-in. The adopting team calls it **eight times**, in the same files as their seven vacuous rules. Opt-in does not work.

---

## Mechanism: satisfiability, not emptiness

> **Can this glob match anything in this project?** — a question about the _project_, answerable without running the rule.

1. **`PathUniverse`**, computed once per `ArchProject` and cached (ADR-007: one batch, not a walk per rule): the set of source-file paths, and separately the set of their directory prefixes. Two derivations, deliberately distinct — that split **is** the folder/file discriminator.
2. **`GlobUse = { glob, kind: 'file' | 'folder' | 'specifier', base: 'absolute' | 'tsconfig-relative', origin: string }`** — emitted at every site that compiles a glob (~20 sites).
3. **`globs(): GlobUse[]`**, abstract on the single root, so the compiler enumerates every builder that must contribute. (`spike/0014` found `TsconfigBuilder` this way, which I had missed by hand.)
4. One check: an **unsatisfiable** glob is a finding, regardless of how many subjects the rule has.

Why this and not the funnel:

- **Condition globs need no separate phase.** `notImportFrom('**/src/buidlers/**')` is unsatisfiable — a fact about the project, independent of whether anything imported anything.
- **It survives combinators and polarity.** `not(resideInFolder(typo))` matches _everything_, so no emptiness check can ever see it; satisfiability still reports the typo.
- **It reaches `crossLayer()`, the smells and `resolvers()`** as `globs()` entries rather than per-builder guard logic.
- **It cannot be confused with a legitimate empty.** "No repositories yet" is a _satisfiable_ folder with no matching elements. Silent.

Rejected alternatives, recorded so they are not re-derived: an _observational_ matcher ("did I ever return true") cannot distinguish a negative condition's success from a typo; parsing the glob back out of `description` is a derivation from the same source the check protects (ADR-008 rule 5) and breaks the day someone rewords a string.

### Polarity decides whether unsatisfiability is a fault

Measured:

```
notImportFrom('**/src/gone/**')   (negative)  ->  0 violations   silent green
onlyImportFrom('**/src/gone/**')  (positive)  ->  1 violation    loud red
```

A **positive** constraint with an unsatisfiable glob fails every subject — loud, self-reporting, no guard needed. A **negative** constraint with an unsatisfiable glob is genuinely ambiguous: a live tripwire (`notImportFrom('**/legacy/**')` after `legacy/` was deleted — armed for its return) or a typo. Satisfiability cannot tell them apart, so it **must not fail negative conditions**. Failing them reds the build the moment a team finishes the cleanup the rule demanded.

| Position                                              | Unsatisfiable ⇒                                         |
| ----------------------------------------------------- | ------------------------------------------------------- |
| **Selector** predicate (`.that().resideInFolder`)     | **fault** — the rule can never have subjects            |
| Discovery glob (`slices()`, preset `folders`)         | **fault** — shipped already (0067-D)                    |
| **Positive** condition (`onlyImportFrom`, `dependOn`) | no guard — already fails loudly                         |
| **Negative** condition (`notImportFrom`)              | **no fault** — indistinguishable from an armed tripwire |

What _is_ verifiable at every position, regardless of polarity, is **anchoring**: a glob with a `./` segment, or one not anchored with `**/`, can never match an absolute path. That is a transformation the tool can verify and state. Negative conditions are therefore guarded for _spelling_, not for _satisfiability_.

### Reuse `diagnoseGlob`, do not reinvent it

`diagnoseGlob` + `FAULT_ADVICE` (`src/builders/slice-rule-builder.ts:40-76`) already implements per-fault remedies with the right discipline, including a comment explaining why `no-match` lists causes **without asserting one** — earlier revisions asserted causes that were false on reachable inputs. Promote to `src/core/glob-diagnosis.ts` and add exactly one fault:

| Fault                 | Condition                                            | May name a cause?     |
| --------------------- | ---------------------------------------------------- | --------------------- |
| `dot-segment`         | contains `./`                                        | yes — verifiable      |
| `unanchored`          | not `**/`-prefixed, absolute-base glob               | yes — verifiable      |
| **`file-not-folder`** | `kind: 'folder'`, matches ≥1 file, **0 directories** | yes — verifiable      |
| `no-match`            | anything else                                        | **no** — lists causes |

`file-not-folder` is the fault both codebases actually produced, and the only new one they produced.

`base: 'tsconfig-relative'` exists so the remedy for a `resolvers()` glob never says _"prefix with `**/`"_ — which would be actively wrong there. A guard that emits a wrong remedy is worse than no guard (ADR-008 rule 2).

---

## Decisions the review demanded

**Semantic emptiness does not flip.** `.that().extend('BaseRepository')` matching nothing stays green, and `.expectNonEmpty()` remains the tool for pinning it. Proposal 014's _"Why not 'empty always fails'"_ stands; draft 1 reversed it by accident, not by argument, and there is no measured evidence for the semantic case — **every** bug in the table above is a path glob.

**Therefore no `.allowEmpty()` is added.** An unsatisfiable glob has no legitimate reading, so it gets no opt-out (ADR-008 rule 3: say so in the message). The collision with `CorrespondenceBuilder.allowEmpty(sideName)` dissolves rather than being renamed around.

**Meta-findings become severity-proof.** Measured: `.asSeverity('warn')` downgrades a `bypassFilters` finding to a warning, so `overrides: { rule: 'warn' }` silences it. That is a hole in the **already-shipped** 0067-A/D guards, not only in this plan. `TerminalBuilder.violations()` must floor meta-findings at `error`, and `.warn()` must not swallow one.

**`emptyIsPass` never covers a path fault.** It suppresses the _semantic_ collapse only. Otherwise every `.that().resideInFolder(<typo>).should().notExist()` is permanently green — reopening bug 0011 for the whole absence family. Its `.some()` must also become `.every()`.

**Presets guard their inputs, not their generated rules.** One mis-globbed `strictBoundaries({ folders })` currently fans out to 37 unsilenceable findings. `assertDiscovered` (`presets/shared.ts:50`) already does input-guarding for boundaries; generalise it to `include`/`src`/`repositories`/`layers`, name **the option the user wrote**, and exempt preset-generated rules from the per-rule check. No third override value needed.

**`notExist()` with a path glob:** the selector glob is a claim about the project and is guarded; the _condition's_ emptiness is not. `.that().resideInFolder('**/legacy/**').should().notExist()` with `legacy/` deleted fails, with the verifiable remedy _"no path matches `**/legacy/**`; if `legacy/` was intentionally removed, delete this rule."_ A reintroduction ratchet is a different assertion and deserves its own spelling.

---

## Releases

**R1 — bug 0014, alone.** Matcher fix: test import globs against the resolved path _and_ non-relative specifiers. Makes the documented `notImportFrom('fastify')` work. Green→red for anyone whose ban now functions; its own Upgrading note.

**R2 — non-breaking groundwork.** Single root (`spike/0014` refactor). `globs()` contract, `PathUniverse`, `glob-diagnosis.ts`. The severity floor for meta-findings. Proposal 019 (`conditions === 0`, one implementation on the root — checked **first**, since it is static and knowable before any element is touched). A `ts-archunit doctor` surface that **reports** every unsatisfiable glob without failing: the pre-flight the 0.18.1 retrospective says a breaking guard needs.

**R3 — the guard (breaking).** Turn R2's report into a failure, at selector predicates, discovery globs and negative-condition _spelling_. Ships with the 15 JSDoc fixes, the `init` templates and the 8 vacuous tests **in the same commit** — 014 called the docs sweep a ship-blocker because an agent copies examples verbatim.

**R-any — our own 14 rules.** Needs no product change; the `definePredicate` + `startsWith(dirname(tsConfigPath))` form is already measured correct in bug 0011. Land it now, ahead of everything.

---

## Test inventory

| Test                                                                    | Proves                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| `file-not-folder` fires; the other three faults keep their own remedies | the fault both codebases produced                 |
| a satisfiable folder with no matching elements does **not** fire        | the legitimate case stays green                   |
| `not(resideInFolder(typo))` still reports                               | survives combinators — the funnel could not       |
| `or(resideInFolder(ok), resideInFolder(typo))` reports the dead branch  | ditto                                             |
| `notImportFrom('**/legacy/**')` with `legacy/` absent does **not** fire | polarity — successful cleanup stays green         |
| `notImportFrom('src/x/**')` fires on **anchoring**                      | spelling guarded even where satisfiability is not |
| a `resolvers()` glob never gets the `**/` remedy                        | tsconfig-relative base                            |
| `.asSeverity('warn')` cannot downgrade a meta-finding                   | the shipped hole                                  |
| every builder contributes `globs()`                                     | all positions, enforced by the compiler           |
| the arch suite is green from a differently-named checkout               | bug 0011 fixed by construction                    |

Each verified by sabotage: revert the fix, watch it go red.

---

## Open questions

1. **Blast radius of satisfiability is unmeasured.** It fires on rules _with_ subjects, so it is strictly larger than the funnel's. R2's `doctor` exists to measure it on both codebases before R3 flips.
2. **`definePredicate` third-party path predicates** cannot emit a `GlobUse`, so the guard has a permanent hole shaped like every user-defined predicate. Symmetric options parameter, or accept and document the hole?
3. **`.expectNonEmpty()`** stays, since the semantic case is not flipping. Confirm a no-op call does not read as "this rule is guarded" in `explain`.
4. **1.0 gate.** Not this release. Proposed: 1.0 is the release after two consecutive releases that change no default, plus one external validation.

## Out of scope

- **Bug 0012** — per-element thresholds, different mechanism.
- **Path normalization** — making `'src/*'` _work_ rather than only fail loudly is the deeper fix and is separable; bundling two breaking changes is the 0.18.1 mistake.
- **The `resolvers()`/`schema()` tsconfig-relative convention** — a real inconsistency; this plan only ensures the guard does not emit a wrong remedy because of it.
