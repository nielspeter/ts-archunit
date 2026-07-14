# Plan 0061: Docs Restructure — Golden Path & Coherent IA

## Status

- **State:** Done (v0.16.0, branch `feat/0061-docs-restructure`) — all 7 phases built: run-modes reconciled (CLI default + conversion table + `running-in-tests.md`), `cli.md` intro fixed, golden-path Getting Started (forks greenfield/existing-code), new Setup & Best Practices + Troubleshooting pages, recipes merged into What to Check (+ redirect stub), landing trimmed, four-tier nav (Rule Catalog), `.check()`-in-rule-file callout on all 15 catalog pages. `docs:build` passes (dead-link gate), prettier clean. Docs-only — no version bump; deploys on merge to main.
- **Decision locked (2026-07-13):** the **golden-path default is the CLI rule-file form** (`npx ts-archunit init` → `arch.rules.ts` with `export default [...]` → `npm run arch`). But the two forms are framed as **co-equal, pick-by-context**, not "default vs footnote" — the installed base is test-file-first and the landing page sells "it's just tests, zero extra infra" as a differentiator, so the test-file form (`.check()` in vitest/jest) keeps prominent signposting from Getting Started, Core Concepts, and index, plus its own page. (Review: a hard demotion of the established mode would alienate current users.)
- **Priority:** P1 — docs coherence gates adoption of everything shipped in v0.13–0.15 (`init`, `recommended`, `agentGuardrails`, `tsconfig`, the severity pipeline).
- **Effort:** ~2–3 days (revised up after review — the best-practices page is net-new authoring, the reference-page reconciliation and `cli.md` rewrite were added to scope, and the golden path forks greenfield/existing-code).
- **Rollout:** ship as **one squash-merged PR**, not phase-by-phase — `.github/workflows/docs.yml` deploys to GitHub Pages on every push to `main` touching `docs/**`, so a half-applied restructure would deploy a state _more_ inconsistent than today.
- **Created:** 2026-07-13
- **Depends on:** Nothing. All features referenced are already shipped (v0.15.0). Purely a documentation/IA change.

## Problem

The docs grew **test-file-first** (rules written in `arch.test.ts`, run with vitest via `.check()`). Then the v0.13–0.15 wave — the severity-aware `check` pipeline (0060), `agentGuardrails`/`explain --format agent` (0044), `recommended` (0049), the `init` scaffolder (0050), and `tsconfig()` (0055) — bolted a **second workflow** (CLI rule files) on top without reconciling the two. Each feature also landed as its own peer page in an undifferentiated 20-item "Guide" list. The result, from a newcomer's point of view:

1. **Four competing on-ramps that disagree** — `index.md`, `getting-started.md`, `what-to-check.md`, `recipes.md` each present a different "how you start," with different first examples.
2. **Two run-modes that contradict and are never reconciled** — the **test-file form** (`.check()` in vitest; used by getting-started/what-to-check/recipes/core-concepts) vs the **CLI rule-file form** (`export default [...]` + `npm run arch`; produced by `init`, used by cli/presets/agents/tsconfig). A user who runs `init` then reads Getting Started gets contradictory instructions. This is the single biggest coherence break and it is _new_.
3. **`what-to-check.md` and `recipes.md` overlap heavily** — two copy-paste one-liner galleries a newcomer can't distinguish (though `recipes` also carries unique teaching content — exclusion decision table, delegation, hygiene — that must be preserved, not flattened).
4. **The high-value new surface is buried** — `init` is not a nav item at all; `recommended`/`agentGuardrails` are hidden inside `presets`; `tsconfig` is the cryptic "Project-Config Rules"; "AI Agents" sits between "Presets" and "Recipes" as if it were another rule category rather than a workflow.
5. **The 20-item Guide is an undifferentiated pile** mixing concepts/workflow, the matcher catalog, and copy-paste galleries as flat siblings — no "start here" vs "exhaustive reference" signal.
6. **No best-practices / recommended-setup page exists.** The adoption ladder (init → `recommended` → shape presets → baseline → CI → custom rules last) lives only as fragments across five pages.
7. **`index.md` is a 247-line marketing wall** that never shows the fastest path (`npx ts-archunit init`) and duplicates `what-to-check`.

## Goal

A newcomer lands, understands the pitch in 30 seconds, runs one command to a working setup, and knows where to go next — without ever hitting two contradictory instructions. One golden path with a **clearly co-equal** test-file alternative (not a hidden footnote), no silent-skip trap when moving a rule between forms, and a clear split between **tutorial/workflow** pages and the **rule catalog**.

## Decision: CLI rule-file as the documented default

Every walked-through example uses the form `init` scaffolds:

```typescript
// arch.rules.ts
import { project } from '@nielspeter/ts-archunit'
import { recommended } from '@nielspeter/ts-archunit/presets'

const p = project('tsconfig.json')

export default [
  ...recommended(p),
  // your rules — builders, no .check(); append .asSeverity('warn') to warn
]
```

Run with `npm run arch` (`ts-archunit check`). Rationale: it is what `init` produces, it is the modern severity-aware path, and it is the richer CI superset (`--changed` diff-aware, `--format github/json`, one aggregated report). The **test-file form** (`.check()` in vitest) is genuinely co-equal — it uniquely gives per-`it()` granularity and vitest-native watch/reporters, and "architecture rules are just tests, no extra infra" is a real selling point on the landing page. It gets its own page ("Running rules in your test suite") plus prominent cross-links from Getting Started, Core Concepts, and index.

**The two forms are not mechanically interchangeable — the docs must make the conversion explicit** (review finding, and a silent-failure trap otherwise):

| Concern  | CLI rule file (`arch.rules.ts`)      | Test file (vitest)     |
| -------- | ------------------------------------ | ---------------------- |
| terminal | **none** — bare builder in the array | `.check()`             |
| warn     | `.asSeverity('warn')` (non-terminal) | `.warn()`              |
| baseline | `--baseline` flag / config           | `.check({ baseline })` |
| run      | `npm run arch`                       | `npx vitest run`       |

A builder ending in `.check()` inside a rule-file array **is silently skipped — the rule never runs** (`cli.md:166`). This is why the reference/gallery pages cannot be left mixed (see Phase 6). The `running-in-tests.md` page carries this table as a conversion guide.

## Target information architecture

Four tiers replace the flat list. Nav groups are visually distinct so a reader can tell a tutorial page from a reference page.

| Tier             | Pages                                                                                                                                                                                                                  | Job                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Introduction** | What is ts-archunit? (trimmed) · **Getting Started** (one golden path) · What Can It Check? (single merged gallery)                                                                                                    | Land, orient, first success in 5 min              |
| **Guide**        | Core Concepts · **Setup & Best Practices** (NEW) · Running Rules in Tests (NEW, the alt workflow) · Presets · AI Agents · Custom Rules · Violation Reporting                                                           | How to use it _well_                              |
| **Rule Catalog** | Modules · Classes · Functions · Types · Calls · JSX · Slices & Layers · Body Analysis · Pattern Templates · Cross-Layer · Smell Detection · Metrics · Enforce Compiler Options (`tsconfig`) · GraphQL · Standard Rules | The matcher catalog — look up, don't read through |
| **Reference**    | CLI · Explain · **Troubleshooting** (NEW) · API Reference                                                                                                                                                              | Exhaustive lookups + "it went wrong"              |

## Implementation phases

### Phase 1 — Reconcile the two run-modes (~3 hours)

The keystone. Until this is done, everything else still contradicts.

- **Getting Started, What to Check, Recipes:** convert the walked-through examples to the CLI rule-file default form (spread builders into `export default [...]`, drop `.check()`, run via `npm run arch`). Keep any `describe/it` examples only on the new "Running Rules in Tests" page.
- **Core Concepts:** add an explicit "Two ways to run rules" section near the top — CLI rule file (golden-path default) vs test file — with the conversion table from the Decision section (terminal, warn, baseline, run), stating when to pick each, then use the CLI form for the rest of the page.
- **`docs/cli.md` (added to scope after review):** its intro currently says _"Most teams should put rules in test files… the CLI is for teams that need standalone rule execution"_ (`cli.md:5`) — the **opposite** of the locked decision. Rewrite that framing to present the CLI rule-file form as the default path (still noting the test-file alternative). Without this, our own CLI page contradicts the restructure.
- **New page `docs/running-in-tests.md`** — the test-file form as a first-class alternative: `.check()` inside `it()`, `describe` grouping, why you might prefer it (already run vitest, want per-rule output). Carries the **conversion table** (Decision section) so a reader moving a rule between forms swaps _both_ the terminal and the severity call — and doesn't paste a silently-skipped `.warn()`/`.check()` into a rule file. Absorbs the test-file content removed elsewhere.
- Cross-link both directions.

**Files:** `docs/getting-started.md`, `docs/what-to-check.md`, `docs/recipes.md` (until merged in Phase 4), `docs/core-concepts.md`, `docs/cli.md`, `docs/running-in-tests.md` (new), `docs/.vitepress/config.ts`.

### Phase 2 — Rewrite Getting Started as one golden path (~3 hours)

A single 5-minute path, one workflow, everything else linked out. **The first run forks — this is a review-critical fix** (`recommended` ships two `error` rules, `no-eval` / `no-function-constructor`, that fail on legacy code; `cli.md:39` already says to baseline before gating). Do NOT promise a "green first run" unconditionally:

1. `npm install -D @nielspeter/ts-archunit`
2. `npx ts-archunit init` — what it generates (config, `arch.rules.ts` with `recommended`, scripts)
3. **First run — pick your case:**
   - **New / small project** → `npm run arch` → likely green. Good.
   - **Existing codebase** → run `npm run arch:baseline` first, commit `arch-baseline.json`, _then_ `npm run arch`. Baselining is part of **setup** here, not a later step — otherwise the first command is a wall of red. (A short "what if my first run has 200 violations?" note lives right here, not four steps down.)
4. Read what `recommended` gave you (link Presets)
5. Add one rule for your shape (one concrete custom rule, CLI form)
6. Iterate locally with `npm run arch -- --watch`
7. Wire into CI — a **complete** GitHub Actions job in the CLI world (checkout → setup-node → install → `ts-archunit check --format github`), not the test-runner `- run: npm test` snippet that exists today.

Move the deep material currently in Getting Started (monorepo, "organizing rules", rich metadata) out — monorepo → a short section in Setup & Best Practices; organizing/metadata → Custom Rules or Core Concepts.

**Files:** `docs/getting-started.md`.

### Phase 3 — New "Setup & Best Practices" page (~3 hours)

The recommended adoption ladder, the page currently missing. `docs/setup-best-practices.md`:

- The ladder: `init` + `recommended` floor → add a shape preset (layered / boundaries) → adopt on legacy code with `--baseline` → run in CI → add project-specific custom rules **last**.
- Severity guidance: error vs warn, when to use `.asSeverity('warn')`, that warns never fail CI.
- Enforce the config upstream: `tsconfig(p).requires({ strict: true })` so code-level rules aren't silently bypassed (link Config rules).
- Monorepo: `workspace()` and per-package `tsconfig`.
- AI-agent projects: point at the AI Agents page as a track.
- "Anti-patterns" callout: don't start with 50 rules; don't gate CI before baselining; don't put project-specific rules in a preset.

**Files:** `docs/setup-best-practices.md` (new), `docs/.vitepress/config.ts`.

### Phase 4 — Merge the two galleries (~2 hours)

Correction from review: `recipes.md` is **not** "the same page" as `what-to-check.md` — it overlaps on the one-liner galleries but also carries genuinely unique teaching content (the three-way exclusion-mechanism decision table, delegation patterns via `mustCall`, export/dead-code hygiene, `silent()`). That explanatory/decision material is not gallery filler and must be routed, not flattened.

- **Give `what-to-check.md` real internal structure** so absorbing recipes doesn't recreate the "wall" the plan criticizes: anchored top-level sections + a clearly-parented **"Customizable recipes"** subsection for the regex/ORM-customizable one-liners. Keep the "scan in 2 minutes" promise by leading with the section index.
- **Route recipes' non-gallery content to its right home:** the exclusion decision table and delegation/hygiene explanation belong in **Setup & Best Practices** or the relevant Rule Reference page, not squeezed into a gallery. Preserve every code example; de-duplicate only true overlaps.
- Ensure every example uses the CLI default form (or is explicitly marked test-form where that's the point).
- **Delete `recipes.md` — with a redirect stub, not a bare 404.** The only inbound link is the nav entry (`config.ts:44`), but the deploy target is **GitHub Pages** (static; no server redirects), so external bookmarks / search-indexed `/ts-archunit/recipes` would hard-404. Keep a one-line `recipes.md` stub with a `<meta http-equiv="refresh" content="0; url=./what-to-check">` (or a VitePress `rewrites` entry) pointing at the merged section. This reconciles the old Phase-4-vs-Out-of-scope contradiction (redirects are now explicitly _in_ scope as a stub, not "redirect infrastructure").

**Files:** `docs/what-to-check.md`, `docs/setup-best-practices.md` (routed content), `docs/recipes.md` (→ redirect stub), `docs/.vitepress/config.ts`.

### Phase 5 — Trim the landing page (~2 hours)

`index.md` becomes a punchy pitch, not a wall. It stays **plain markdown** (it has no `layout: home` frontmatter today — do not convert it to the VitePress hero/features layout):

- One-line thesis + the fastest path (`npx ts-archunit init`) above the fold.
- Keep the differentiators that genuinely sell — body analysis, the comparison table (`index.md:163`), the sample violation (`index.md:182`) — these are the best trust-builders in the doc set; compress, don't cut.
- Replace the 40-bullet "What ts-archunit Can Enforce" wall with a **compressed teaser** (a handful of categories) that links to the full gallery in `what-to-check.md` — don't relocate the whole list there (that just moves the wall; `what-to-check` is already 600 lines).
- Preserve the existing "browse N categories" inbound-link promise so it doesn't orphan.
- One clear CTA to Getting Started.

**Files:** `docs/index.md`.

### Phase 6 — De-trap the reference pages, promote & rename (~3 hours)

**The reference-page reconciliation is now IN scope — it was the review's #1 critical.** Leaving the ~15 Rule Reference/gallery pages on `.check()` while tutorials teach the bare-builder CLI form is not cosmetic whiplash: a reader copies a `classes(p)….check()` example into their `arch.rules.ts`, and the CLI **silently skips it** (`cli.md:166`) — a rule they believe is enforcing runs nothing. For an architecture-testing tool that is the worst failure mode (manufactured false confidence). Fix it, don't defer it:

- **Every Rule Reference page and `what-to-check.md` gets a short standing callout** at the top: _"Snippets below use `.check()` (test-file form). In a CLI rule file, drop `.check()` and spread the builder into `export default [...]` — see [Running Rules in Tests] / [Rule files]."_ (This is the pragmatic fix — rewriting every catalog snippet to bare-builder form is a larger effort; the callout closes the trap without it.)
- Nav: regroup into the four tiers (Phases 1–5 already touch `config.ts`; this finalizes it). Rename the tiers to be unambiguous — "Reference" (CLI/Explain/API) reads too close to the catalog tier, so use **"Rule Catalog"** (or "Rules by Element") for the matcher pages and keep "Reference" for tooling lookups.
- Rename "Project-Config Rules" to surface the **need, not the mechanism** — e.g. "Enforce Compiler Options (`tsconfig`)" — since a user searching for "make sure nobody turns off strict" won't scan for "Config Rules."
- Update the **top nav bar** (`config.ts:9-13`, separate from the sidebar) too, not just the sidebar.
- Ensure `init` is discoverable (add an "Install & init" mention in the Introduction group).
- Elevate "AI Agents" so it reads as a workflow track under Guide, not a rule category. Confirm the Getting Started `--preset agent-guardrails` cross-link survives the rewrite (it's the agent audience's entry point).

**Files:** `docs/.vitepress/config.ts`, the Rule Catalog pages (callout only), `docs/what-to-check.md`.

### Phase 6b — Troubleshooting / FAQ page (~1 hour)

Review's top "what's still missing." New `docs/troubleshooting.md` (under Reference) covering the predictable first-day failures with one obvious "now what": first run has N violations (→ baseline), `init` refuses because a file exists (→ `--force` / `--dry-run`), `project('tsconfig.json')` can't resolve, a rule "isn't firing" (→ the `.check()`-in-rule-file trap). Cross-link from Getting Started step 3 and the first-failure moment.

**Files:** `docs/troubleshooting.md` (new), `docs/.vitepress/config.ts`.

### Phase 7 — Verify (~1 hour)

- `npm run docs:build` passes. VitePress fails the build on broken links in **markdown** (no `ignoreDeadLinks` set — confirmed), so prose links are gated.
- **Manual nav click-through — the build does NOT validate `config.ts` nav/sidebar links.** After deleting/renaming pages (recipes, config-rules label), click every sidebar and top-nav entry; a stale nav link (e.g. `/recipes`) ships a green build that 404s.
- Manual golden-path walkthrough: follow Getting Started top to bottom against a real scratch project **for both branches** (greenfield → green; existing-code → baseline-then-green); every command and snippet works and is internally consistent (CLI form throughout).
- Confirm the `.check()`-in-rule-file callout is present on every Rule Catalog page and `what-to-check.md`, so no page leaves the silent-skip trap open.
- Confirm the redirect stub at `/recipes` resolves to the merged section.
- Confirm no page still implies two _default_ workflows (co-equal-with-signposting is the target, not "two defaults").

## Files changed (summary)

| File                           | Change                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `docs/index.md`                | Trim to a punchy pitch (plain md); lead with `init`; compressed teaser + link  |
| `docs/getting-started.md`      | Rewrite as the golden path; first-run forks greenfield/existing; CLI-world CI  |
| `docs/setup-best-practices.md` | New — adoption ladder + severity/baseline/CI/monorepo + routed recipes content |
| `docs/running-in-tests.md`     | New — test-file (`.check()`) workflow + the form-conversion table              |
| `docs/troubleshooting.md`      | New — first-day failures + "now what" (Phase 6b)                               |
| `docs/what-to-check.md`        | Absorb recipes galleries; anchored structure + "Customizable recipes"; callout |
| `docs/recipes.md`              | → redirect stub (meta-refresh to what-to-check); not a bare delete             |
| `docs/core-concepts.md`        | Add "Two ways to run rules" + conversion table; CLI form                       |
| `docs/cli.md`                  | Rewrite the intro that contradicts the default (`cli.md:5`)                    |
| Rule Catalog pages (~15)       | Add the "drop `.check()` in a rule file" callout (no full rewrite)             |
| `docs/.vitepress/config.ts`    | Four-tier nav (sidebar + top nav); rename tiers/labels; group AI Agents        |

No source-code changes. No API changes.

## Out of scope

- **Any API/behavior change.** This is docs only. If a doc gap reveals a real product gap (e.g. a missing `.forbids()` on `tsconfig`), file it as its own plan — do not fix it here.
- **Rewriting every Rule Catalog snippet to bare-builder form.** The catalog keeps `.check()` examples (the canonical test-file terminal); the silent-skip trap is closed by the standing callout (Phase 6), not by rewriting ~15 pages of snippets. A full catalog refresh is a separate effort.
- **Redirect _infrastructure_** (versioned docs, history tooling, per-page redirect maps). A single `/recipes` meta-refresh stub IS in scope (Phase 4) — that's the pragmatic exception, not general redirect tooling.
- **README restructure.** README already leads with `init` (v0.14). Touch only if an inbound link breaks.
- **New diagrams/visual design.** Prose + nav IA only; no custom graphics.
- **`docs/.vitepress/dist/`** — gitignored and untracked (verified); local build output only, rebuilt on deploy. Nothing to touch.

## Strategic note

The docs are the on-ramp to three releases of high-value work (`init`, presets, agents, `tsconfig`, severity). The features shipped faster than the narrative; this plan makes the narrative catch up. The keystone is Phase 1 — one documented default workflow — because every other confusion (competing on-ramps, buried features, missing best-practices page) is downstream of the unreconciled two-workflow split. Do Phase 1 first; the rest is organization on top of a now-consistent foundation.
