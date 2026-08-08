# Proposal 024 — `ts-archunit add`: an English-Invariant Authoring On-Ramp

**Status:** Draft 1 — external origin (2026-08-08). **Not yet architect/product reviewed.** Design ported from a field-report analysis mapping the AI-coding-agent discourse onto ts-archunit; grounded in the current DSL, CLI (`init`/`check`/`doctor`/`baseline`), and rule-file format, but authored from *outside* `src/`, so treat file/behaviour claims as verify-before-acting.
**Priority:** High — this is the one item in that analysis that is **not already shipped or on the roadmap**, and it targets the tool's single largest competitive exposure: **the LLM "verifier" beats ts-archunit on authoring cost, not correctness.** Closing the authoring gap is what makes every existing advantage (determinism, zero per-check cost, body analysis, baseline/ratchet, the `0044` agent loop) decisive rather than academic.
**Affects:** A new CLI subcommand (`add`) + a deterministic phrasebook module + a small project lexicon (config); output appends to the existing `export default [...]` rule file with `.rule({ id, because, suggestion, imperative })`. **Core stays dependency-minimal (ADR-001):** the deterministic MVP (Stages 1–2) adds *no runtime deps*; the optional LLM fallback (Stage 3) lives in a **separate opt-in package** per the ADR-006 precedent, and its *output* is a plain deterministic rule + fixtures (no model at check time).
**Depends on:** `plans/0048-using-tagged-symbol-matcher.md` (tags as lexicon nouns — the vocabulary bridge); `plans/0096` / `plans/0098` (the evidence-seam / fixture gate that verifies a *generated* rule can fail — Stage 3's honesty mechanism); `plans/completed/0064-filtered-subjects-materialization.md` (post-filter subject count, to reject a generated rule that selects nothing — the [proposal 019](./019-rules-that-enforce-nothing-must-fail.md) class); `plans/completed/0044-ai-agent-integration.md` (the `imperative` field the generated rule reuses).
**Origin:** Field-report finding, corroborated by practitioners: authoring — *turning a caught mistake into a permanent rule* — is the bottleneck, not running rules. The verifier wins because *"declare an invariant, scope it with a glob"* is writable by an architect; `functions(p).that().resideInFolder('**/services/**').should().satisfy(...)` is not.

> **Framing:** the English sentence is the *source*; the DSL builder is the *compiled form*. ts-archunit already owns the compiler target — this proposal supplies the missing front end.

## Problem

The DSL is precise and correct, and that is exactly why it is hard to author: it requires a TypeScript engineer who knows the condition catalog. Every scaled team in the corpus reports the same shape — the hard part is converting a caught mistake into a permanent rule, and whoever makes that conversion cheapest accretes coverage fastest (coverage being the frontier: an agent optimizes away anything not gated). The competing answer — a natural-language "verifier" judged by a cheap LLM — is authorable in one sentence but is *probabilistic verification of probabilistic generation*: it lowers the error rate, never changes "probably" to "provably." ts-archunit's determinism is worth nothing in the coverage race if the rule never gets written.

## The command

```bash
npx ts-archunit add "services must not call fetch directly"
```

Appends to `arch.rules.ts` (the existing default-export array — no `.check()`):

```typescript
// invariant: "services must not call fetch directly"      ← English source, preserved verbatim
functions(p)
  .that()
  .resideInFolder('**/services/**')                         // lexicon: "services"
  .should()
  .satisfy(functionNotContain(call('fetch')))               // "must not call fetch"
  .rule({
    id: 'services/no-direct-fetch',
    because: 'services must route through the shared HTTP client, not call fetch directly',
    suggestion: 'use the shared httpClient instead of fetch()',
    imperative: 'Do NOT call fetch() in a service — use the shared httpClient',
  }),
```

Because `imperative` is what `explain --format agent` emits (`0044`), **one sentence produces both a gate and an agent-prompt line** — the agent reads the constraint before writing, and the gate catches it if the agent ignores it. That closed loop already exists on your surface; `add` is the thing that populates it cheaply.

## The compiler — three stages; most sentences never reach a model

### Stage 1 — deterministic phrasebook (ships first, no new deps)

A grammar of the highest-frequency invariant shapes, each mapping onto a condition that **already ships**. Parse to `{subject, modality, verb, object, scope}` → emit the builder:

| English shape | Compiles to (current API) |
|---|---|
| "X must not import (from) Y" | `modules(p).that()…should().notImportFrom('Y')` |
| "X may only import from A, B" | `.onlyImportFrom('A','B')` |
| "X must not call Y" | `functions(p)…should().satisfy(functionNotContain(call('Y')))` |
| "X must call Y" / "X must validate input" | `mustCall(/Y/)` / `mustCall(/validate\|parse/)` |
| "X must use Y instead of Z" | `functionUseInsteadOf(…)` *(note the arg-order fix in [proposal 023](./023-naming-convention-cleanup-before-1-0.md) A1)* |
| "X must not throw generic errors" | `noGenericErrors()` |
| "X must not swallow errors" | `noSilentCatch()` |
| "X must not use eval / console / process.env" | `noEval()` / `noConsole()` / `noProcessEnv()` |
| "X must not contain `new Z`" | `functionNotContain(newExpr('Z'))` |
| "handlers must accept `T`" | `acceptParameterOfType('T')` |

~15 shapes covers most of the agent-mistake catalog. Fully testable, no API key, no model — and it alone neutralizes the verifier's authoring-cost edge for common rules.

### Stage 2 — lexicon resolution (the vocabulary bridge — the crux)

The nouns ("services", "the repository", "handlers") must resolve to selectors. A small project lexicon:

- **Auto-seeded** from the codebase: `src/` folders → folder globs (`services` → `**/services/**`); class-name suffixes → name regex (`repository` → `/Repository$/`).
- **Confirmed once**, stored (`arch.lexicon.json` or a config block), deterministic thereafter and reviewable in diff.
- **Tag-aware** — this is where `0048` pays off: a `@arch-tag money-movement` becomes a lexicon noun, so *"money-moving functions must call authorize"* → `.that().areTagged('money-movement').should().satisfy(mustCall(/authorize/))`. Tags give the compiler precise nouns globs can't express; `add` gives tags a reason to exist. Mutually reinforcing.

An unresolved noun is **surfaced, not guessed** — `add` asks once and records the mapping (the escape-hatch principle; never silently narrow a selector to nothing — the [proposal 019](./019-rules-that-enforce-nothing-must-fail.md) failure).

### Stage 3 — LLM fallback, gated by fixtures (opt-in, separate package)

For sentences no template covers, an LLM can draft a `defineCondition` (full ts-morph node + Project available). **The output is never trusted directly, and the model never runs at check time.** Flow:

1. LLM drafts the `defineCondition` **plus** a *positive* fixture (must pass) and a *negative* fixture (must fail).
2. The tool runs the generated rule against both: it must **pass the positive and fail the negative** — reverse classical evaluation, and the `0096/0098` evidence-seam contract (*a rule that cannot fail is vacuous*). `0064`'s filtered-subject count rejects a rule that selects nothing.
3. If it doesn't pass its own gate, reject/regenerate — **never write a rule that can't fail.**
4. Only a fixture-passing rule is written, with its fixtures committed so CI re-verifies forever. The committed artifact is pure ts-morph — deterministic, un-gameable, model-free.

**Architecture constraint (ADR-001 / ADR-006):** the core must stay at two runtime deps and must not phone home. So Stage 3 is **not in core** — it's an opt-in `@ts-archunit/authoring` (or a CLI plugin) that the developer invokes at authoring time; core `add` ships Stages 1–2 only. This mirrors ADR-006's "framework/runtime concerns live in separate packages." The elegance: Stage 3 reuses the evidence-seam you're *already building* as its acceptance test — it is the report's thesis (mechanical verification of probabilistic generation) applied recursively to rule authoring, with the compiler run as the ground the turtles stop on.

## Why this fits ts-archunit (not a bolt-on)

- Stage 1 is a phrasebook over conditions that already ship — near-zero new surface.
- Stage 3 rides `defineCondition` (public) + `0096/0098` (your active line) + `0064` (shipped).
- The lexicon is the demand-side reason to finish `0048`.
- Output slots into the current rule-file format and reuses `0044`'s `imperative` — no new output path.
- It advances two of the three surfaces named in `plans/ai-era-product-direction.md` at once: **Guide** (rules become authorable, then feed `explain --format agent`) and, via the `propose` follow-up below, **Discovery**.

## Sequencing

- **MVP — Stages 1–2, no LLM, no new deps.** The phrasebook + folder/name lexicon over the top ~15 shapes. This is the piece that actually closes the competitive gap for everyday rules; it is deterministic and testable.
- **v2 — Stage 3** in `@ts-archunit/authoring`, gated by fixtures; lands naturally *after* `0098` (its dependency is already in motion).
- **v3 — `ts-archunit propose`** (batch): read recent PR review comments / CI failures / `doctor` discovery findings and draft candidate rules for human accept. This is the retro→clause loop, and it feeds the **Discovery** surface ([proposal 018](./018-adoptable-discovery-surface.md)) — the same authoring engine pointed at history instead of a single sentence. Consider filing as an extension to 018 rather than a fourth stage here.

## Non-goals / risks

- **It transcribes the invariant you state; it does not invent the right one.** Stating the goal stays the human's job. `add` lowers the cost of writing it down *executably* — the named bottleneck — nothing more.
- **No model in core, ever.** Stage 3 is opt-in, separate-package, authoring-time; the committed rule is deterministic. The "deterministic, un-gameable" identity is preserved.
- **Template brittleness:** natural language is ambiguous. Mitigation — Stage 1 handles a *closed* set of shapes and *echoes back the compiled builder for confirmation* before writing; anything outside the set falls to Stage 3 or an explicit "couldn't parse — here's the closest DSL skeleton" rather than a wrong guess.
- **Lexicon ambiguity:** ask once and record, never silently resolve to an empty selector.

## Acceptance

- `ts-archunit add "<sentence>"` for each of the ~15 Stage-1 shapes emits a builder that (a) compiles, (b) selects a non-empty subject on a fixture repo, (c) reds on a planted violation and greens when fixed — verified in tests.
- The generated `imperative` appears in `explain --format agent` output.
- Stage 3 (when built) refuses to write any rule that does not pass its own positive+negative fixtures.
- Core adds no runtime dependency; `npm run validate` green.

## Open questions for review

- Is `arch.lexicon.json` the right home, or should the lexicon live in the existing config surface?
- Should Stage 1 be interactive (confirm the compiled builder) by default, or one-shot with `--yes`?
- Does `propose` (v3) belong here or as an extension to proposal 018 (Discovery)? — I lean 018.
- Stage 3 packaging: separate npm package vs a lazy-loaded optional dep behind a flag — which better honors ADR-001?
