# Plan 0063: Docs Deprecation Scan

## Status

- **State:** Ready to build — graduated from `proposals/013-docs-deprecation-scan.md` (draft 3, architect + product reviewed). Design is measured against the real corpus, not asserted.
- **Priority:** P2 — the docs are at **zero** deprecated usages today (`5ff08d0`), so this is purely preventive. It goes first only because it is cheap and the baseline is clean; **0047 (user-facing, already go/no-go'd) is not displaced by a 2-hour task.**
- **Effort:** ~2–3 hours.
- **Created:** 2026-07-17
- **Depends on:** Nothing. ts-morph (ADR-002) and vitest (ADR-001) are already core deps.
- **Breaking:** No. `tests/` only — no `src/`, no public API, no new dependency, no CI change.

## Problem

**The docs rot and nothing catches it.** 307 TypeScript code blocks across 31 doc pages are never compiled, and no gate reads doc prose at all. The `typecheck` script covers only the `src` and `tests` includes; the `lint` script covers only `src/` and `tests/`; `format:check` checks markdown _formatting_, not correctness. Docs are a blind spot by construction.

They did rot: **27 usages across 7 pages** taught deprecated methods, including reference tables presenting them as the canonical API (`modules.md:49`). Nobody noticed for releases.

**Deprecation is invisible to `tsc`** — `shouldResideInFile` compiles perfectly; it is deprecated, not removed. And `@typescript-eslint/no-deprecated` is not enabled, and does not lint markdown regardless. So no existing gate can catch this class.

### The lesson that drives the design

Twice, a hand-maintained artifact failed at exactly this job:

1. The manual sweep checked a **hand-written list** of class-builder names, never enumerated the module/type builders, and left **9 usages live** — reported as "clean." Fixed in `5ff08d0`.
2. Proposal 013 draft 2 fixed _that_ by sourcing names from `src/`, then **hand-coded the matching rule** ("require a dot"). Measured: 22/27, and **zero on `core-concepts.md`** — the two-column conditions table it called the worst rot. The blind spot did not close; it moved.

> **Every part of this check is derived from `src/`. Nothing is hand-maintained — not the names, not the disambiguation rule, not an ignore list.**

## Design

One ts-morph pass over `src/` yields everything: the deprecated names, their replacement text, and which of them are _also_ live exports (and therefore ambiguous in prose).

**Measured on the real pre-sweep corpus:**

| Design                          | Hits        | False positives            |
| ------------------------------- | ----------- | -------------------------- |
| Bare match everything           | 27 / 27     | **3** (`api-reference.md`) |
| Dot-prefix everything (draft 2) | **22 / 27** | 0                          |
| **Collision-aware (this plan)** | **25 / 27** | **0**                      |

25/27 across all 7 pages, zero false alarms. We take that over 27/27 with three: a scan that cries wolf on correct documentation gets ignored, and an ignored check is worse than no check.

### Two decisions that differ from the proposal

**1. Fixtures, not git refs.** Proposal draft 3 says "pin the acceptance corpus to `8ddd33e`." **That is unbuildable.** All four workflows use `actions/checkout@v6` with no `fetch-depth`, which defaults to a **shallow clone** — the commit does not exist in CI. Tests would pass locally and fail (or worse, silently skip) in CI. Use **committed fixtures**: hermetic, deterministic, and each one names the case it covers. The historical 25/27 measurement stands as a **one-time validation already performed**, recorded here — not as a live test.

**2. No exclusion list at all.** Scope is `docs/**/*.md` + `README.md`. `ts-archunit-spec.md` sits at the repo root and `plans/`/`proposals/`/`adr/` are outside `docs/`, so they are excluded **by construction** rather than by a list. This satisfies the binding constraint for free — an exclusion list that can silently grow is the drift vector this plan exists to kill.

`api-reference.md` is scanned normally and needs **no** exemption: it documents the live exports with bare names (`| shouldExtend | shouldExtend(name: string) |`), and the collision rule requires a dot for those names, so it never fires.

## Phase 1 — Read the deprecated symbols from source

**`tests/docs/deprecated-symbols.ts`**

```typescript
import { Project, Node } from 'ts-morph'

export interface DeprecatedSymbol {
  readonly name: string
  readonly replacement: string // the @deprecated tag's text
  readonly declarations: readonly string[] // file:line, for reporting
  readonly collides: boolean // also a live export → a bare mention is ambiguous
}

export function readDeprecatedSymbols(project: Project): DeprecatedSymbol[] {
  // getExportedDeclarations() keys are the EXPORTED names, so the aliased
  // re-export form (`haveNameMatching as conditionHaveNameMatching`) is handled
  // natively — no regex over index.ts.
  const exported = new Set(
    project.getSourceFileOrThrow('src/index.ts').getExportedDeclarations().keys(),
  )

  const found = new Map<string, { replacement: string; declarations: string[] }>()

  for (const sf of project.getSourceFiles('src/builders/*.ts')) {
    for (const cls of sf.getClasses()) {
      for (const method of cls.getMethods()) {
        const tag = method
          .getJsDocs()
          .flatMap((d) => d.getTags())
          .find((t) => t.getTagName() === 'deprecated')
        if (tag === undefined) continue

        const name = method.getName()
        const replacement = normalise(tag.getCommentText() ?? '')
        const where = `${sf.getFilePath()}:${method.getStartLineNumber()}`

        const prior = found.get(name)
        if (prior === undefined) {
          found.set(name, { replacement, declarations: [where] })
        } else {
          // conditionHaveNameMatching is deprecated on class/type/function builders.
          // Assert the guidance agrees rather than silently picking one.
          if (prior.replacement !== replacement) {
            throw new TypeError(
              `Conflicting @deprecated text for '${name}':\n  ${prior.declarations[0]}: ${prior.replacement}\n  ${where}: ${replacement}`,
            )
          }
          prior.declarations.push(where)
        }
      }
    }
  }

  return [...found].map(([name, v]) => ({
    name,
    replacement: v.replacement,
    declarations: v.declarations,
    collides: exported.has(name),
  }))
}
```

Expected today: **8 unique names across 10 declarations**; `collides` true for `conditionHaveNameMatching`, `shouldExtend`, `shouldImplement`, `shouldHaveMethodNamed`.

**Files changed:** `tests/docs/deprecated-symbols.ts` (new).

## Phase 2 — The scanner

**`tests/docs/scan-markdown.ts`**

```typescript
import type { DeprecatedSymbol } from './deprecated-symbols.js'

export interface Hit {
  readonly file: string
  readonly line: number
  readonly name: string
  readonly replacement: string
}

/**
 * COLLIDE — also a live export, so a bare mention is ambiguous (api-reference.md
 *   legitimately documents it). Only the dotted method call is unambiguously rot.
 * SOLO — exists only as a deprecated method, so any mention is rot. This is what
 *   catches two-column reference tables, where no dot appears on the line.
 *
 * The (?!\w) right-boundary guard is required, not cosmetic: notImportFromCondition
 * is a strict prefix of notImportFromConditionWithOptions and double-counts without it.
 */
function patternFor(symbol: DeprecatedSymbol): RegExp {
  const escaped = symbol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return symbol.collides ? new RegExp(`\\.${escaped}(?!\\w)`) : new RegExp(`\\b${escaped}(?!\\w)`)
}

export function scanMarkdown(
  files: readonly { path: string; text: string }[],
  symbols: readonly DeprecatedSymbol[],
): Hit[] {
  const patterns = symbols.map((s) => ({ symbol: s, pattern: patternFor(s) }))
  const hits: Hit[] = []
  for (const file of files) {
    file.text.split('\n').forEach((line, i) => {
      for (const { symbol, pattern } of patterns) {
        if (pattern.test(line)) {
          hits.push({
            file: file.path,
            line: i + 1,
            name: symbol.name,
            replacement: symbol.replacement,
          })
        }
      }
    })
  }
  return hits
}
```

**Files changed:** `tests/docs/scan-markdown.ts` (new).

## Phase 3 — Fixtures + the guard

Fixtures encode one case each, so a failure names its own cause.

**`tests/fixtures/docs-deprecation/`**

| Fixture                    | Encodes                                                                                                                     | Expected                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `dotted-call.md`           | `.shouldResideInFile('**/x/**')` in a fenced chain                                                                          | **hit**                  |
| `two-column-table.md`      | `\| \`shouldResideInFolder(glob)\` \| description \|`— no dot on the line (the`core-concepts.md` case draft 2 was blind to) | **hit**                  |
| `table-with-example.md`    | Name column + a dotted Example column (the `modules.md:49` case)                                                            | **hit**                  |
| `live-export-reference.md` | Bare `\| shouldExtend \| shouldExtend(name) \|` (the `api-reference.md` case)                                               | **no hit**               |
| `prefix-overlap.md`        | `notImportFromConditionWithOptions(...)` alone                                                                              | **exactly 1 hit**, not 2 |
| `clean.md`                 | Current API only                                                                                                            | **no hit**               |

**`tests/docs/deprecation.test.ts`**

```typescript
const LIVING_DOCS = ['docs/**/*.md', 'README.md'] // spec/plans/proposals/adr are outside by construction

it('no doc teaches deprecated API', () => {
  const hits = scanMarkdown(readLivingDocs(), readDeprecatedSymbols(project))
  expect(hits.map(format)).toEqual([]) // format → "docs/x.md:12 — `name` is deprecated: <replacement>"
})
```

The real-docs assertion is the guard; it lands **green** today and turns red on the PR that introduces drift.

**Files changed:** `tests/fixtures/docs-deprecation/*.md` (6 new), `tests/docs/deprecation.test.ts` (new).

## Test inventory

| Test                                    | Asserts                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `deprecated-symbols` — enumeration      | 8 unique names from 10 declarations                                           |
| `deprecated-symbols` — replacement text | Recovered verbatim (e.g. ``Use `resideInFile()` after `.should()` instead.``) |
| `deprecated-symbols` — dedupe           | `conditionHaveNameMatching` collapses across class/type/function builders     |
| `deprecated-symbols` — conflict guard   | Divergent `@deprecated` text for one name **throws**                          |
| `deprecated-symbols` — collision set    | Exactly the 4 colliding names; alias-aware via `getExportedDeclarations()`    |
| `deprecated-symbols` — no hand-list     | Nothing is asserted against a literal array of names (drift guard)            |
| `scan` — dotted call, colliding name    | **hit**                                                                       |
| `scan` — bare mention, colliding name   | **no hit** (`api-reference.md` guard)                                         |
| `scan` — bare mention, solo name        | **hit** (the two-column-table case)                                           |
| `scan` — right boundary                 | `notImportFromConditionWithOptions` yields exactly 1 hit                      |
| `scan` — reporting                      | `file:line` + replacement text in the message                                 |
| `deprecation` — **the guard**           | Living docs produce **zero** hits                                             |
| `deprecation` — seeded rot              | A fixture with rot turns the guard red                                        |

## Out of Scope

- **The compile harness** (proposal 013 draft 1). Deferred to the **1.0 removal milestone**, when deprecation→removal makes the drift class certain rather than hypothetical. Spike data retained in the proposal.
- **The ~13 possible real doc bugs** (`TS2339`/`TS2345`/`TS2554`) the draft-1 spike surfaced. They need the scope-aware preamble before they are even triage-able — file as a tracked issue behind 0047, do not pretend they are free.
- **Enabling `@typescript-eslint/no-deprecated` for `src/`.** Genuinely worth doing (~15 min) and it closes the _source_ of this drift — but it is a different surface (code, not docs) and must be `src/`-only: ~74 deprecated call-sites in `tests/` are **legitimate**, since those tests exist to cover the deprecated methods. Separate PR.
- **The `shouldExtend` naming collision** (a current export and a deprecated method sharing a name). Real, and the reason this rot was hard to spot by hand — but the machine disambiguates cleanly by declaration site, so this plan does not need the breaking rename. 0.18+, on its own merits.
- **ADR-007's broken dogfooding example** (`adr/007:80-89` uses a non-existent `entry` export and is unscoped; as written it would false-red against 107 `tests/` and 54 `src/` files). Real defect, unrelated to this plan. File separately.
- **The 2 undecidable cases.** A bare mention of a name that is both deprecated-method and live-export (`core-concepts.md:176`-style) cannot be resolved from text, and no compile path helps — they are table rows. Documented limit, not a bug.
