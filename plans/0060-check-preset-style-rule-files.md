# Plan 0060: `check` Support for Preset-Style Rule Files

## Status

- **State:** IMPLEMENTED (2026-07-13, branch `feat/0060-unified-check-pipeline`) — primitives, format-json, unified pipeline, and the metadata-propagation fix landed with tests; verified end-to-end. Docs + CHANGELOG done. Remaining nice-to-haves: github per-severity annotations.
- **Review (2026-07-13):** Reviewed (architect + product). Design decision made — **Option 2 (returning form + unified pipeline)**; see "Design decision (RESOLVED)" below. Resolves the warn-path gates in 0049/0050.
- **Priority:** TBD (likely P2 once approved)
- **Effort:** ~1.5 days (runCheck refactor + shared `filterAndReport` helper + two new primitives — `ArchViolation.severity` and non-terminal `.asSeverity()` — + the agent-facing `--format json` contract: single-document aggregation, `severity`, summary counts)
- **Created:** 2026-07-13
- **Depends on:** Nothing new. Builds on plan 0020 (CLI runner), 0016 (baseline), 0040 (`.violations()` / `throwIfViolations`).

## Design decision (RESOLVED 2026-07-13) — Option 2: returning form + unified pipeline

Round-2 review found the systemic blocker: `dispatchRule('warn', …)` (`src/presets/shared.ts:39-44`) prints via `console.warn` and **returns `[]`**, so `warn`-severity violations never enter the `ArchRuleError` a preset throws. A "catch the throw, extract `.violations`" design captures only error-severity violations — and a **warn-only** run (the common brownfield case: empty catches / no-op bodies, no `eval`) throws nothing at all, so the CLI sees nothing. An exception is a binary fail signal; severity is a spectrum. The throwing model cannot carry warns.

**Decision: Option 2 — extend plan 0040's `.violations()` (return) vs `.check()` (throw) dual surface up to the preset level, and have the CLI run one unified non-throwing pipeline.**

- **Presets gain a returning form.** For a rule _bundle_ like `recommended` the natural form is an **array of severity-carrying builders** (`RuleBuilderLike[]`) — identical in shape to a builder-export rule file. This requires two new primitives (see "New primitives"), because today `.severity()` is a _terminal_ that executes on the spot and `ArchViolation` carries no severity: a **non-terminal `.asSeverity('error'|'warn')`** that sets builder state and returns `this`, plus a **`severity` field on `ArchViolation`**. (A cross-cutting aggregating preset that dedups across builders may instead return a severity-tagged `ArchViolation[]`; same principle, added incrementally.)
- **The CLI owns one pipeline.** `runCheck` collects `builder.violations()` from each builder, tags each with the builder's severity, and runs a shared non-throwing `filterAndReport` (baseline → diff → format → count). Exit code = the **error**-severity count; warns are baseline-filtered and formatted but never fail the build.
- **`loadRuleFiles` stays a pure loader.** The generated `arch.rules.ts` (plan 0050) does `export default [...recommended(p)]`, flowing through the standard builder-export path — no throw to catch, warns handled.
- **Bare throwing preset calls** (`layeredArchitecture(p)` at top level, no export) remain supported via a best-effort `ArchRuleError` catch — but that shape carries **error-severity only** (documented limitation; prefer the returning `export default` form).
- **Backward compatible.** Shipped presets keep their throwing public API for direct/vitest use; the returning form is additive.

This dissolves the earlier stdio-suppression hack and the exceptions-as-control-flow coupling — warns flow as data, not console side-effects. It also resolves the warn-tier gates in plans 0049 and 0050.

## Problem

The CLI `check` command cannot run **preset-style** rule files — files whose top-level code _calls_ a preset or rule rather than exporting builders. This surfaced while reviewing plan 0050 (`init` scaffolder), which generates exactly such a file:

```typescript
// arch.rules.ts — the natural, documented shape
import { project, recommended } from '@nielspeter/ts-archunit'
const p = project('tsconfig.json')
recommended(p) // runs at import, throws ArchRuleError on violation
```

(`recommended` ships in plan 0049; the already-implemented presets
`layeredArchitecture` / `dataLayerIsolation` / `strictBoundaries` follow the
identical `throwIfViolations` pattern, so this plan is testable today against
those.)

`loadRuleFiles` (`src/cli/load-rules.ts`) only accepts a **default export** of builders (objects with `.check()`), which the runner then calls. Against a preset-style file:

- If the preset **passes**, it exports nothing → `extractDefault` returns `undefined` → zero builders → `check` exits 0. (Correct _outcome_ by luck — the preset did run and pass at import — but `check` applied none of its own `CheckOptions`.)
- If the preset **finds error-severity violations**, it throws `ArchRuleError` during `import()` → `loadRuleFiles` propagates the throw → `runCheck` (which only catches per-_builder_ `.check()` throws) lets it **crash** (uncaught).
- Either way, because the preset ran at import time with no access to `CheckOptions`, `--baseline` / `--changed` / `--format json` are **silently ignored** — this is the always-true, strongest motivation (stronger than the "zero rules" framing, which only misleads when a preset-style file is mixed with expected builder exports).

Presets (`recommended`, `layeredArchitecture`, `dataLayerIsolation`, `strictBoundaries`) are the recommended way to configure ts-archunit, yet they don't work with the CLI's own `check` command. This is a general gap, and a hard dependency of plan 0050.

This is the same execution model plan 0044 already specced for its (now-deferred) MCP tool — see 0044 "Deferred: MCP server," the `executeRuleFile` two-phase import/execute sketch.

## Goal

`ts-archunit check` runs one unified, non-throwing violation pipeline for every rule file — builder-export and preset-returning alike — with severity, baseline, diff, and format applied uniformly:

- Every builder (from a builder-export file or a preset's returning form) reports via `.violations()`, tagged with its severity.
- `error`-severity violations set a non-zero exit; `warn`-severity violations are baseline-filtered and formatted but do not fail the build.
- Baseline / `--changed` / `--format` apply to all of them (today they are silently ignored for anything a preset self-executes at import).
- Bare throwing preset calls still work (best-effort, error-severity only — documented).
- Non-`ArchRuleError` failures (syntax error, missing tsconfig) still surface as real errors, not silent passes.

## Design

### New primitives (required by the returning form)

Verified absent today (`src/core/rule-builder.ts:230` — `.severity()` is a terminal executor that calls `.check()`/`.warn()` immediately; `src/core/violation.ts` — `ArchViolation` has no severity field). The returning form needs:

1. **`ArchViolation.severity: 'error' | 'warn'`** (`src/core/violation.ts`) — so a violation carries its level through baseline/filter/format and the exit decision. Default `'error'` at existing call sites (additive, non-breaking).
2. **Non-terminal `.asSeverity('error' | 'warn'): this`** on `RuleBuilder` + `TerminalBuilder` — sets a `_severity` field and returns `this` (chainable), **without executing**. Distinct from the existing terminal `.severity()` (which runs the rule now). A builder configured `.asSeverity('warn')` can be held in a default-export array; when the CLI collects its `.violations()`, each violation is stamped with `_severity` (default `'error'` if never set).

`RuleBuilderLike` (the CLI's structural type, `src/cli/load-rules.ts:6`) widens from `{ check }` to also expose `violations(): ArchViolation[]` and a readable severity (a `severity` getter or field).

### Unified pipeline (returning form primary, catch as fallback)

`loadRuleFiles` today: `import` → `extractDefault` → filter `isRuleBuilderLike` → `builders[]`, and `runCheck` calls `builder.check()` (throwing) on each. New flow, per rule file:

1. `import` the file. `extractDefault` → array of **severity-carrying builders** — the shape both a builder-export file and a preset's returning form produce (`export default [...recommended(p), myRule(p)]`). `loadRuleFiles` stays a pure loader.
2. `runCheck` reads each builder's `.asSeverity()` state (default `'error'`), collects `builder.violations()` (non-throwing terminal from plan 0040), and stamps each violation with that severity, into one list.
3. **Fallback:** if `import()` itself throws `ArchRuleError` (a bare top-level throwing preset call with no export), catch it and add `err.violations` — **error-severity only** (documented limitation). A non-`ArchRuleError` throw (syntax error, bad tsconfig) is a real failure and propagates.
4. The combined, severity-tagged list runs through a shared non-throwing `filterAndReport(violations, ctx, options): number` — baseline `filterNew` → diff `filterToChanged` → format-branch → count. Output is grouped **per-source** for the human/terminal + `github` formats (so multi-builder files keep their individual `reason`/metadata), while **`--format json` emits a single aggregated document** (see "Agent-facing `--format json` contract"). Exit code = the **error**-severity count after filtering; warns are filtered + formatted but don't fail.

This is what makes **baseline + `--format` + warns all work with presets**: everything arrives as severity-tagged data through `.violations()`, so the CLI — not the preset — owns filtering, formatting, and the exit decision. Nothing self-prints via `console.warn`, so there is nothing to suppress.

`filterAndReport` is extracted from the throwing `executeCheck` (`src/core/execute-rule.ts`) so both it and the new path share the three format branches (no drift).

Broader framing: the contract is **"a rule file contributes severity-tagged violations — via exported builders' `.violations()`, or (best-effort) via an `ArchRuleError` thrown on import."** One pipeline, not two special shapes.

### Agent-facing `--format json` contract (the agent loop consumes this)

Plan 0044 makes `check --format json` the payload of the AI agent's edit loop, so the JSON contract is load-bearing here — and today's code doesn't meet it:

1. **One JSON document, not per-builder blobs.** `executeCheck` currently writes `formatViolationsJson(...) + '\n'` **per builder** (`src/core/execute-rule.ts:112`), so a multi-builder file (`recommended` = 4 builders; `agentGuardrails` = several) emits several concatenated JSON objects — **not valid JSON**, so an agent's `JSON.parse` fails. The unified pipeline must aggregate **all** violations across all builders/sources into **one** `formatViolationsJson` call → a single parseable document. Per-source grouping (step 4 above) applies only to the human/terminal + `github` formats; **JSON is always one array** (each violation already carries its own `rule`/`because`/`suggestion` as fields, so aggregating loses nothing).
2. **Serialize `severity`.** `formatViolationsJson` must include the new `ArchViolation.severity` field so the agent distinguishes blocking (`error`) from advisory (`warn`). The agent uses the process exit code (0/1) for pass/fail and per-violation `severity` to prioritize.
3. **Summary counts.** Extend the JSON `summary` from `{ total, reason }` to also carry `{ errors, warnings }`, so the agent sees "N blocking, M advisory" without scanning the array.

(`formatViolationsJson` is also gaining `codeFrame` in plan 0044 — coordinate the two edits to `src/core/format-json.ts`.)

### stdio hygiene (only the bare-throw fallback)

Under the returning form there is nothing to suppress — violations are data, not console output. The only residual case is the **bare throwing preset call** fallback: `throwIfViolations` writes to `stderr` before throwing (`src/presets/shared.ts:74`), which would double-print alongside the CLI's own formatting. Suppress the engine's pre-throw stderr write **for that fallback path only**; the returning-form path never triggers it.

### Multiple presets — resolved by the returning form

With the returning form, `export default [...layeredArchitecture builders, ...dataLayerIsolation builders]` composes cleanly (arrays concat) — all builders run, all violations report. The first-failure-halts limitation applies **only** to the bare-throw fallback shape (two bare throwing preset calls at top level). Docs steer multi-preset files to the returning `export default` form.

## Implementation phases

### Phase 1 — Primitives + unified pipeline refactor (~4 hours)

1. **Primitives** — add `ArchViolation.severity` (`src/core/violation.ts`, default `'error'`) and the non-terminal `.asSeverity(level): this` on `RuleBuilder`/`TerminalBuilder` (sets `_severity`, returns `this`). Widen `RuleBuilderLike` (`load-rules.ts`) with `.violations()` + a severity accessor.
2. Extract `filterAndReport(violations, ctx, options): number` from `executeCheck` (`src/core/execute-rule.ts`) — baseline `filterNew` → diff `filterToChanged` → format-branch → count, non-throwing, per-source formatting.
3. `src/cli/commands/check.ts` (`runCheck`) — for each builder read `.asSeverity()` (default `'error'`), collect `builder.violations()`, stamp severity; combine; call `filterAndReport`; set the exit code from the error-severity count. Best-effort catch of an import-time `ArchRuleError` (error-severity fallback). Stop calling `builder.check()` for control flow. No `console.warn` suppression except the bare-throw fallback's pre-throw stderr write.

### Phase 2 — Tests (~1.5 hours)

`tests/cli/check-preset-style.test.ts`:

- Returning-form file (`export default [...recommended(p)]`) with error violations → reported, exit 1.
- Returning-form file with **only warn** violations → formatted + reported, **exit 0** (does not fail) — the case the throwing model couldn't handle.
- Warn violations filtered by `withBaseline()` → suppressed on re-run (the brownfield baseline case).
- `--format json` output includes **both** error and warn violations, each tagged with `severity`.
- **Multi-builder file emits ONE valid JSON document** — `JSON.parse` of the full stdout succeeds (not concatenated per-builder blobs). This is the agent-loop contract.
- JSON `summary` carries `{ total, errors, warnings }`.
- Builder-export file still works (regression), incl. per-source `reason`/metadata preserved across multiple builders.
- Bare throwing preset call (no export) → error-severity violations surface via the fallback catch, no double-print; documented warn-loss for this shape.
- Syntax error / missing tsconfig → real error, non-zero, not a silent pass.
- `.asSeverity('warn')` is **non-terminal** — returns the builder unexecuted, usable in an array; its violations stamp `severity: 'warn'`, while a builder with no `.asSeverity()` stamps `'error'`.

### Phase 3 — Docs (~30 min)

- `docs/cli.md` — note that `check` accepts both builder-export and preset-style rule files; show the `recommended(p)` one-liner form.
- `CHANGELOG.md` — `### Fixed` / `### Added`.

## Files changed

| File                                               | Change                                                                                                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/violation.ts`                            | Add `severity: 'error' \| 'warn'` field (default `'error'`)                                                                                                                                                                                   |
| `src/core/rule-builder.ts` + `terminal-builder.ts` | Add non-terminal `.asSeverity(level): this` (sets `_severity`, no execute)                                                                                                                                                                    |
| `src/core/execute-rule.ts`                         | Extract shared non-throwing `filterAndReport(violations, ctx, options)`                                                                                                                                                                       |
| `src/core/format-json.ts`                          | Serialize `severity`; extend `summary` to `{ total, errors, warnings, reason }` (coordinate with 0044's `codeFrame`)                                                                                                                          |
| `src/cli/commands/check.ts`                        | Severity-aware unified pipeline: read `.asSeverity()` + collect `.violations()` → stamp → `filterAndReport`; **`--format json` aggregates ALL violations into one document**; error-count exit; best-effort import-time `ArchRuleError` catch |
| `src/cli/load-rules.ts`                            | `RuleBuilderLike` gains `.violations()` + severity accessor; stays a pure loader (best-effort import-time `ArchRuleError` catch)                                                                                                              |
| `tests/cli/check-preset-style.test.ts`             | New                                                                                                                                                                                                                                           |
| `docs/cli.md`                                      | Document the unified pipeline + returning-form rule files                                                                                                                                                                                     |
| `CHANGELOG.md`                                     | Entry                                                                                                                                                                                                                                         |

No new dependencies.

## Out of scope

- **MCP server** — plan 0044 (deferred).
- **`init` scaffolder** — plan 0050 (this plan is its prerequisite).
- **Multi-preset full aggregation** — first-failure is documented; changing preset internals to defer throwing is a separate concern.
- **Breaking preset public APIs** — Option 2 is **additive**: shipped presets keep their throwing public API (direct/vitest use unchanged); the returning form is a new, additional surface. Adding returning forms to the shipped aggregating presets (`layeredArchitecture` etc.) can be incremental — this plan needs only `recommended`'s returning form (plan 0049) plus the CLI pipeline.

## Strategic note

This unblocks plan 0050 (`init` generates a `recommended(p)` file) and closes a standalone gap: presets are the documented configuration path, and until now they only worked when embedded in a vitest test, not via the CLI's own `check`. It also retires the last remaining piece of 0044's execution-model design that had real value independent of MCP.
