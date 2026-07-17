# Plan 0063: Docs Deprecation Scan

## Status

- **State:** Ready to build — graduated from `proposals/013-docs-deprecation-scan.md` (draft 3), then revised against a five-persona review (architect / testing / product / devops / customer, 2026-07-17) which found the plan's own code did not compile and reintroduced its own headline failure mode. Design verified independently by four reviewers; **implementation corrected below.**
- **Priority:** P2, **behind 0047.** The docs are at **zero** deprecated usages today (`5ff08d0`), so this is purely preventive. Review raised the honest effort past the half-day line the plan set for itself — it no longer claims to be too cheap to sequence.
- **Effort:** **~4–5 hours** (was ~2–3h). The scan itself is ~60 lines and was reproduced by reviewers in minutes; the completeness cross-check, frozen corpus, synthetic symbol set, tracker entries, and the three undefined helpers are the real cost.
- **Created:** 2026-07-17
- **Depends on:** Nothing. ts-morph (ADR-002), vitest (ADR-001), and picomatch are already core deps.
- **Breaking:** No. `tests/` only — no `src/`, no public API, no new dependency, no workflow change.

## Problem

**The docs rot and nothing catches it.** ~320 TypeScript code blocks across 31 doc pages are never compiled, and no gate reads doc prose at all. The `typecheck` script covers only the `src` and `tests` includes; `lint` covers only `src/` and `tests/`; `format:check` checks markdown _formatting_, not correctness. Docs are a blind spot by construction.

They did rot: **27 usages across 7 pages** taught deprecated methods, including reference tables presenting them as the canonical API (`modules.md:49`). Nobody noticed for releases.

**Deprecation is invisible to `tsc`** — `shouldResideInFile` compiles perfectly; it is deprecated, not removed. `@typescript-eslint/no-deprecated` is not enabled, and does not lint markdown regardless. No existing gate can catch this class.

### The lesson that drives the design — and kept recurring while writing it

A hand-maintained artifact has failed at this job **six times**, three of them discovered during review of this very plan:

| #   | The hand-maintained thing                          | Outcome                                          |
| --- | -------------------------------------------------- | ------------------------------------------------ |
| 1   | The manual sweep's list of class-builder names     | Missed **9 of 27**; reported "clean" (`5ff08d0`) |
| 2   | Proposal draft 2's dot-prefix matching rule        | Found **22 of 27**; zero on its headline page    |
| 3   | This plan's **search scope** (`src/builders/*.ts`) | Goes silent at 0.18 — see below                  |
| 4   | `ROADMAP.md:162`'s alias list                      | **Already wrong** — says 7, there are 8          |
| 5   | This plan's false-positive count                   | **Already wrong** — said 3, measured 4           |
| 6   | The inventory's "verbatim" assertion               | Certified on the 6/8 population that works       |

> **A glob is a hand-written list with better syntax.**
>
> Every part of this check derives from `src/` — the names, the replacement text, the disambiguation rule, the **scope**, and the tests' own expectations. Where derivation is impossible, the gap is **pinned by a test**, never trusted.

## Design

One ts-morph pass over `src/` yields the deprecated names, their `@deprecated` replacement text, and the **collision set** (names that are also live exports, where a bare mention is ambiguous).

**Measured on the real pre-sweep corpus (`8ddd33e`), reproduced independently by four reviewers:**

| Design                          | Hits        | False positives                                                     |
| ------------------------------- | ----------- | ------------------------------------------------------------------- |
| Bare match everything           | 27 / 27     | **4** (`api-reference.md:188,194,195,196` — one per colliding name) |
| Dot-prefix everything (draft 2) | **22 / 27** | 0                                                                   |
| **Collision-aware (this plan)** | **25 / 27** | **0**                                                               |

25/27 across all 7 pages, zero false alarms. We take that over 27/27 with four: a scan that reddens **correct** documentation trains the team to add exemptions, and the exemption list is the hand-maintained artifact that has already failed six times.

### The scope must be derived, and its completeness pinned

The reviewed draft scanned `src/builders/*.ts` and only `getClasses().getMethods()` — **9 of 122** files in `src/`, methods only. All 10 deprecations live there **today**, which is precisely the danger: the blind spot is invisible on the population under test.

It is not hypothetical. This plan's own Out of Scope defers the **0.18 `shouldExtend` rename**, which deprecates the _standalone export_ in `src/conditions/` — outside that glob. The scanner would go quiet exactly when it is needed.

So: walk `src/**/*.ts`, collect from every JSDocable named node, **and pin completeness with a cross-check test** (Phase 1) that fails the moment a `@deprecated` tag escapes the scanner — forcing a deliberate scope decision instead of a silent miss.

### Known limit — derivable, not worth the third rule class

**2 of 27 are missed**: bare `conditionHaveNameMatching` in a two-column table (`core-concepts.md:176`, `classes.md:56`), suppressed because that name is also a live export.

This limit is **not** "undecidable from text" (an earlier overstatement). It _is_ derivable: `conditionHaveNameMatching` is an **alias** (`haveNameMatching as conditionHaveNameMatching`), so it never legitimately appears with parens — whereas `shouldExtend(name: string)` does at `api-reference.md:194`. Comparing the export key to the declaration's own name would reach 27/27 at zero false positives.

**We skip it deliberately**: 2 hits, corpus already clean, and it adds a third rule class to a small task. Overstating a limit is the same sin as understating one.

> **Warning for whoever revisits this.** The _obvious_ fix — a call-shape discriminator (`name(`) — looks correct and **goes red on `api-reference.md:194-196`** against today's docs. Review probed it and it fails. The frozen-corpus snapshot (Phase 3) pins the 2 misses so any change here surfaces as a reviewable diff.

### Two decisions that differ from the proposal

**1. Fixtures and a frozen corpus, not git refs.** Proposal draft 3 says "pin the acceptance corpus to `8ddd33e`." **That fails in CI** — all four workflows use `actions/checkout@v6` with no `fetch-depth`, i.e. a shallow clone, and `git show 8ddd33e:docs/x.md` exits 128 there. Worse, an implementation that does not check the exit status degrades to **an empty scan → zero hits → green**: a silent false-green, the exact class this plan exists to kill.

(A reviewer noted "unbuildable" is overstated — `fetch-depth: 0` costs ~0.8 MB and ~0.7s on this repo. True. Fixtures are still right, for better reasons: `git show` couples tests to a `.git` directory existing at all, a SHA-pinned corpus dies on any history rewrite, and committed files are reviewable in a diff.)

**2. No exclusion list at all.** Scope is `docs/**/*.md` + `README.md`. `ts-archunit-spec.md`, `CHANGELOG.md` (which names 7 deprecated symbols in one line, legitimately, forever), `plans/`, `proposals/`, `adr/` are all outside `docs/` — excluded **by construction**, not by a list. Use **picomatch** (already a core dep); its `dot: false` default also excludes `docs/.vitepress/` for free.

`api-reference.md` is scanned normally and needs **no** exemption: the collision rule already declines to fire on the bare export names it documents.

## Phase 1 — Derive the symbols from source

**`tests/docs/deprecated-symbols.ts`**

Globs are **parameters with defaults** — that is what makes the conflict path testable without mutating `src/`, and what makes the scope one line to widen.

```typescript
import { Node } from 'ts-morph'
import type { Project } from 'ts-morph'

export interface DeprecatedSymbol {
  readonly name: string
  readonly replacement: string
  readonly declarations: readonly string[] // file:line — REPORTED, not just collected
  readonly collides: boolean // also a live export → a bare mention is ambiguous
}

export interface DeprecatedScan {
  readonly symbols: readonly DeprecatedSymbol[]
  /** Divergent @deprecated text for one name. Returned as data — a reader must not throw. */
  readonly conflicts: readonly string[]
}

/** ts-morph strips the ` * ` gutter but keeps newlines; two of the eight tags wrap. */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function readDeprecatedSymbols(
  project: Project,
  sourceGlob = 'src/**/*.ts', // derived scope — NOT src/builders/*.ts
  entryPoint = 'src/index.ts',
): DeprecatedScan {
  // getExportedDeclarations() keys by the EXPORTED name, so the aliased re-export
  // (`haveNameMatching as conditionHaveNameMatching`) resolves natively — no regex.
  const exported = new Set(
    project.getSourceFileOrThrow(entryPoint).getExportedDeclarations().keys(),
  )

  const found = new Map<string, { replacement: string; declarations: string[] }>()
  const conflicts: string[] = []

  for (const sourceFile of project.getSourceFiles(sourceGlob)) {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isJSDocable(node) || !Node.hasName(node)) return
      const tag = node
        .getJsDocs()
        .flatMap((doc) => doc.getTags())
        .find((t) => t.getTagName() === 'deprecated')
      if (tag === undefined) return

      const name = node.getName()
      const replacement = normalise(tag.getCommentText() ?? '')
      const where = `${sourceFile.getFilePath()}:${node.getStartLineNumber()}`

      const prior = found.get(name)
      if (prior === undefined) {
        found.set(name, { replacement, declarations: [where] })
      } else if (prior.replacement !== replacement) {
        // conditionHaveNameMatching is deprecated on three builders; their text agrees
        // today. Report divergence as data so the test can assert it.
        conflicts.push(`${name}: '${prior.declarations[0]}' vs '${where}'`)
      } else {
        prior.declarations.push(where)
      }
    })
  }

  return {
    symbols: [...found].map(([name, v]) => ({
      name,
      replacement: v.replacement,
      declarations: v.declarations,
      collides: exported.has(name),
    })),
    conflicts,
  }
}
```

Expected today: **8 unique names across 10 declarations**; `collides` true for `conditionHaveNameMatching`, `shouldExtend`, `shouldImplement`, `shouldHaveMethodNamed`.

**The completeness cross-check** — the test that makes the derived scope honest. It counts `@deprecated` a second, unrelated way and fails if the scanner's enumeration disagrees:

```typescript
it('no @deprecated tag in src/ escapes the scanner', () => {
  const raw = project
    .getSourceFiles('src/**/*.ts')
    .flatMap((sf) => sf.getFullText().match(/@deprecated/g) ?? []).length
  const recovered = readDeprecatedSymbols(project).symbols.reduce(
    (n, s) => n + s.declarations.length,
    0,
  )
  // Both sides derived. Fails the moment a deprecation lands on a shape the walk
  // misses (an exported const, a VariableStatement's JSDoc), forcing a decision.
  expect(recovered).toBe(raw)
})
```

**Files changed:** `tests/docs/deprecated-symbols.ts`, `tests/docs/deprecated-symbols.test.ts` (both new).

## Phase 2 — The scanner

**`tests/docs/scan-markdown.ts`**

```typescript
import type { DeprecatedSymbol } from './deprecated-symbols.js'

export interface Hit {
  readonly file: string
  readonly line: number
  readonly name: string
  readonly replacement: string
  readonly declaredAt: string // so the message can disambiguate — see format()
}

/**
 * COLLIDE — also a live export, so a bare mention is ambiguous (api-reference.md
 *   legitimately documents it). Only the dotted method call is unambiguously rot.
 * SOLO — exists only as a deprecated method, so any mention is rot. This is what
 *   catches two-column reference tables, where no dot appears on the line.
 *
 * No `g` flag: `.test()` with /g is stateful via lastIndex and would make hits
 * depend on scan order. The (?!\w) right-boundary guard is required, not cosmetic:
 * notImportFromCondition is a strict prefix of notImportFromConditionWithOptions.
 */
function patternFor(symbol: DeprecatedSymbol): RegExp {
  const escaped = symbol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return symbol.collides ? new RegExp(`\\.${escaped}(?!\\w)`) : new RegExp(`\\b${escaped}(?!\\w)`)
}

/** At most one hit per (line, symbol) — the metric is line-hits, not usages. */
export function scanMarkdown(
  files: readonly { path: string; text: string }[],
  symbols: readonly DeprecatedSymbol[],
): Hit[] {
  const patterns = symbols.map((symbol) => ({ symbol, pattern: patternFor(symbol) }))
  const hits: Hit[] = []
  for (const file of files) {
    file.text.split('\n').forEach((line, i) => {
      for (const { symbol, pattern } of patterns) {
        if (!pattern.test(line)) continue
        hits.push({
          file: file.path,
          line: i + 1,
          name: symbol.name,
          replacement: symbol.replacement,
          declaredAt: symbol.declarations[0] ?? '(unknown)',
        })
      }
    })
  }
  return hits
}
```

**Reporting must disambiguate what the machine just resolved.** For the 4 colliding names, `` `shouldExtend` is deprecated `` is misleading on its face — `shouldExtend` _is_ a live export, documented as canonical at `api-reference.md:194`. A contributor greps it, finds it exported, and concludes the check is broken. So `format()` reports the declaration site:

```
docs/x.md:12 — `.shouldExtend()` is deprecated:
  Use `extend()` after `.should()` instead.
  (the builder method at src/builders/class-rule-builder.ts:221 — not the
   `shouldExtend` condition export, which is current)
```

**Files changed:** `tests/docs/scan-markdown.ts`, `tests/docs/scan-markdown.test.ts` (both new).

## Phase 3 — Fixtures, frozen corpus, and the guard

### Synthetic symbols for the matching algebra

The scanner is a **pure function**, and it is **line-based and context-blind** — it cannot tell a fence from a table from a heading. So fixtures decomposed by markdown _shape_ test decoration, not behaviour. The real axes are `collides` × `dot | bare` × `right-boundary`.

Test them with a **synthetic vocabulary**, so the scanner's tests do not hardcode real names that expire at 1.0:

```typescript
const SYNTHETIC: DeprecatedSymbol[] = [
  { name: 'oldSolo', replacement: 'Use `newSolo()`.', declarations: ['x:1'], collides: false },
  { name: 'oldShared', replacement: 'Use `newShared()`.', declarations: ['x:2'], collides: true },
  {
    name: 'oldSoloWithOptions',
    replacement: 'Use `newOpts()`.',
    declarations: ['x:3'],
    collides: false,
  },
]

it.each([
  ['dotted call, colliding name', '.oldShared(`X`)', ['oldShared']],
  ['bare mention, colliding name', '| `oldShared` | desc |', []], // the api-reference guard
  ['bare mention, solo name', '| `oldSolo(glob)` | desc |', ['oldSolo']], // the two-column-table case
  ['right boundary', '.oldSoloWithOptions([], {})', ['oldSoloWithOptions']], // 1 hit, not 2
  ['same name twice on one line', '.oldShared(a) .oldShared(b)', ['oldShared']], // 1 hit per line
  ['link target', '[oldSolo](/api#oldSolo)', ['oldSolo']], // known: fires. Pinned deliberately.
  ['clean', 'Use `newSolo()` instead.', []],
])('%s', (_label, text, expected) => {
  expect(scanMarkdown([{ path: 'f.md', text }], SYNTHETIC).map((h) => h.name)).toEqual(expected)
})
```

### The frozen corpus — the only input not authored by the test author

Hand-written fixtures encode what the author _believes_ the cases are. That is exactly how draft 2 scored 22/27 and zero on the page it called worst. The historical corpus is adversarial in a way fixtures structurally cannot be, and it is free to freeze.

```
tests/fixtures/docs-deprecation/corpus-8ddd33e/
  README.md      — "Frozen verbatim from 8ddd33e. Never edit. Provenance + why."
  symbols.json   — the 8 symbols as of that SHA (frozen both sides → survives 1.0)
  *.md           — the 7 rotted pages + api-reference.md (the false-positive canary)
```

```typescript
it('finds 25 of 27 on the frozen pre-sweep corpus, with no false positives', () => {
  const hits = scanMarkdown(readCorpus('corpus-8ddd33e'), FROZEN_SYMBOLS)
  expect(hits.map(format)).toMatchInlineSnapshot() // 25 entries — reviewable, no magic number
})
```

The snapshot **is** the pin for the 2 known misses: `core-concepts.md:176` and `classes.md:56` are visibly absent, so any future change that catches them shows as a diff and forces a deliberate decision.

### The guard — and proof it can fail

```typescript
const LIVING_DOCS = ['docs/**/*.md', 'README.md'] // spec/CHANGELOG/plans/adr are outside by construction

it('no living doc teaches deprecated API', () => {
  const files = readLivingDocs()
  const { symbols } = readDeprecatedSymbols(project)
  // Vacuity guards: toEqual([]) passes if the glob matched nothing.
  expect(files.length, 'living-docs glob matched nothing — guard is vacuous').toBeGreaterThan(25)
  expect(files.map((f) => f.path)).toContain('docs/api-reference.md') // the FP canary must be in scope
  expect(symbols.length, 'no deprecated symbols — guard is vacuous').toBeGreaterThan(0)

  expect(scanMarkdown(files, symbols).map(format)).toEqual([])
})

it('the guard can fail: seeded rot produces a hit', () => {
  const { symbols } = readDeprecatedSymbols(project)
  const solo = symbols.find((s) => !s.collides)
  expect(solo, 'no solo symbol to seed with — guard is now vacuous').toBeDefined()
  const seeded = [{ path: 'docs/__seeded__.md', text: `Use \`${solo?.name}(glob)\` to do it.` }]
  expect(scanMarkdown(seeded, symbols).map((h) => h.name)).toEqual([solo?.name])
})
```

The seed derives **from** the symbol set, so it cannot go stale — and when the vocabulary empties at 1.0 it fails **loudly with the right message** rather than silently passing.

**Files changed:** `tests/docs/deprecation.test.ts` (new), `tests/fixtures/docs-deprecation/corpus-8ddd33e/**` (new), `.prettierignore` (add `tests/fixtures/docs-deprecation/` — `format` is `prettier --write .` and would silently rewrite the frozen corpus, destroying the one artifact whose value is being unedited; note `eslint.config.ts` already ignores `tests/fixtures/**`).

## Phase 4 — Close the deferrals for real

The reviewed draft said "file as a tracked issue." **That venue does not exist** — `gh issue list --state all` returns zero, ever; this project tracks defects in `bugs/*.md`. Routing a deferral to a tracker with no history _is_ the evaporation the plan warns against. So the deferrals are files, written **before this merges**:

- **`bugs/0009-docs-code-block-errors.md`** — the ~13 `TS2339`/`TS2345`/`TS2554` failures the draft-1 spike surfaced. State the entry cost honestly: they come from the _naive_ run, and a triage-able list needs the scope-aware preamble first (i.e. most of the compile harness). Behind 0047.
- **`bugs/0010-adr-007-dogfooding-example.md`** — `adr/007:80-89` uses `entry(project)`, which **is not an export**; the rule is also unscoped, so as written it would false-red against 107 `tests/` and 54 `src/` files that import ts-morph.

(Next free number is 0009 — `bugs/fixed/` contains two `0007-` files.)

**Files changed:** `bugs/0009-*.md`, `bugs/0010-*.md` (new).

## Test inventory

| Test                                            | Asserts                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `deprecated-symbols` — **completeness**         | Scanner enumeration == an independent raw `@deprecated` count over `src/**/*.ts`                     |
| `deprecated-symbols` — multi-line normalisation | `notImportFromCondition`'s replacement contains **no newline** (the 2/8 case `normalise` exists for) |
| `deprecated-symbols` — replacement text         | Recovered and normalised (**not** "verbatim" — 2 of 8 wrap)                                          |
| `deprecated-symbols` — dedupe                   | `conditionHaveNameMatching` collapses across three builders                                          |
| `deprecated-symbols` — conflict path            | Divergent text on a **synthetic project** (via the glob params) lands in `conflicts`                 |
| `deprecated-symbols` — collision **property**   | For every derived symbol: dotted always hits; bare hits iff `!collides`                              |
| `deprecated-symbols` — anchor                   | `toContain('shouldExtend')` as documentation — **never** `toEqual([...4 names])`                     |
| `scan` — matching algebra (synthetic, 7 cases)  | dot/bare × collides, right-boundary, one-hit-per-line, link target, clean                            |
| `scan` — reporting                              | Message carries `file:line`, replacement, **and the declaration site**                               |
| `corpus` — frozen `8ddd33e`                     | 25 hits via inline snapshot; 0 in `api-reference.md`; the 2 known misses visibly absent              |
| `deprecation` — **the guard**                   | Living docs produce zero hits                                                                        |
| `deprecation` — vacuity                         | Glob matched >25 files, includes `api-reference.md`, symbol set non-empty                            |
| `deprecation` — **can fail**                    | Seeded rot (derived from the live symbol set) produces exactly one hit                               |

**Deleted from the reviewed draft:** _"Nothing is asserted against a literal array of names"_ — that was a wish, not a test, and it was contradicted by the two rows above it. Replaced with the honest rule: **the production path derives; tests may pin, and pinned values are expected to change when a deprecation lands — that is the point of a test.**

## Open decisions (need a call before build)

1. **The 1.0 migration guide is currently unwritable.** This plan defers the compile harness to the 1.0 removal milestone. At 1.0 someone writes `docs/migration.md` — _"replace `.shouldResideInFile()` with `.resideInFile()`"_ — and **the guard fires on it.** It is the one page whose job is to name deprecated API, and there is no escape hatch by design. Under release pressure the outs are deleting the guard or mangling the prose. Decide **structurally**, not with an ignore list: e.g. front-matter `deprecation-guide: true`, greppable and self-documenting. Same issue for a heading like `### shouldResideInFile (deprecated)`.
2. **Should `docs.yml` be gated on `npm test`?** It triggers on push to `main` (`paths: ['docs/**']`) and **deploys in ~39s while CI takes ~2m27s** — so on a direct push, deprecated docs publish ~1m50s before the guard reports. The PR path is covered. Adding `- run: npm test` costs ~15s (`npm ci` already paid). Consistency vs. speed — a real call, not an oversight.
3. **`publish.yml:27` runs `npm test`,** so this guard silently becomes a **release gate**: a markdown table cell can block `npm publish`, and adding `@deprecated` to a method in `src/` turns docs red **without touching docs**. That is the design working — but it means deprecating a method now requires a same-PR docs sweep. Accept and document, or exclude.

## Out of Scope

- **The compile harness** (proposal 013 draft 1) → the **1.0 removal milestone**, when deprecation→removal makes the drift class certain rather than hypothetical. Spike data retained in the proposal.
- **The ~13 possible real doc bugs** → `bugs/0009` (Phase 4). Not free: they need the scope-aware preamble before triage is meaningful.
- **Enabling `@typescript-eslint/no-deprecated` for `src/`** — worth doing (~15 min), closes the _source_ of this drift, and we currently cite the rule's absence as evidence while not running it. **`src/`-only**: ~74 deprecated call-sites in `tests/` are legitimate (those tests cover the deprecated methods). Separate PR.
- **The `shouldExtend` naming collision** → 0.18+, on its own merits. The machine disambiguates by declaration site, so this plan does not need the rename. **Note the interaction:** that rename deprecates a standalone export in `src/conditions/`, which is exactly why Phase 1's scope must be `src/**/*.ts`.
- **`ROADMAP.md:162`'s rotted alias list** (says 7, there are 8 — missing `notImportFromConditionWithOptions`). Free to fix; do it alongside, but it is not this plan.
- **Reaching 27/27.** Derivable (see Known limit) but adds a third rule class for 2 hits on an already-clean corpus.
