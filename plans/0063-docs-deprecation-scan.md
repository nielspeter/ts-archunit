# Plan 0063: Docs Deprecation Scan

## Status

- **State:** Ready to build. Graduated from `proposals/013-docs-deprecation-scan.md` (3 drafts), then cut down after **two** five-persona review rounds. The **design** was reproduced independently by five reviewers and holds; every earlier draft failed on the _scaffolding around it_, which is now deleted rather than elaborated.
- **Priority:** P2, **behind 0047 and ADR-008's dependents.** Docs are at **zero** deprecated usages at HEAD, so this is purely preventive.
- **Effort:** **~2.5–3h.** (Draft 3 was ~4–5h and growing; the cut list is in "What was removed and why".)
- **Created:** 2026-07-17
- **Depends on:** [ADR-008](../adr/008-agent-first-failure-surfaces.md) — this plan is its first application, and rule 5 is why the draft-3 scaffolding is gone.
- **Breaking:** No. `tests/` only. No `src/`, no public API, no new dependency, **no workflow change** (see Decisions).

## Problem

**The docs rot and nothing catches it.** ~320 TypeScript code blocks across 31 doc pages are never compiled, and no gate reads doc prose at all. `typecheck` covers only the `src`/`tests` includes; `lint` covers only `src/ tests/`; `format:check` checks markdown _formatting_, not correctness.

They did rot: **27 usages across 7 pages** taught deprecated methods, including reference tables presenting them as canonical (`modules.md:49`). Nobody noticed for releases. **Deprecation is invisible to `tsc`** — `shouldResideInFile` compiles perfectly; it is deprecated, not removed. So no existing gate can catch this class.

**Honest sizing.** Deprecated ≠ broken: a reader copying `shouldResideInFile` gets a **working** rule. The rot is fixed at HEAD. The argument is timing, not severity — **a preventive check is cheapest when the baseline is clean, and it is clean now.** The sharpest harm if it returns: teams running `@typescript-eslint/no-deprecated` get lint failures **sourced from our docs**, which is pointed for a lint-adjacent tool.

## Design

One ts-morph pass over `src/` yields the deprecated names, their replacement text, and the **collision set** (names that are _also_ live exports, where a bare mention in prose is ambiguous). Then a text scan over living docs.

**Measured on the frozen pre-sweep corpus (`8ddd33e`) — reproduced independently by five reviewers:**

| Design                          | Hits        | False positives                            |
| ------------------------------- | ----------- | ------------------------------------------ |
| Bare match everything           | 27 / 27     | **4** (`api-reference.md:188,194,195,196`) |
| Dot-prefix everything           | **22 / 27** | 0                                          |
| **Collision-aware (this plan)** | **25 / 27** | **0**                                      |

We take 25/27 with zero false positives over 27/27 with four: a scan that reddens **correct** documentation trains the reader to suppress it, and the suppression is the artifact that has failed repeatedly (ADR-008 rule 3).

### Known limit — derivable, deliberately skipped

The 2 misses are bare `conditionHaveNameMatching` in two-column tables (`core-concepts.md:176`, `classes.md:56`). This is **not** undecidable: that name is an _alias_ (`haveNameMatching as conditionHaveNameMatching`), so it never legitimately appears with parens, and a reviewer implemented the alias rule and confirmed it reaches **27/27 at 0 FP**. We skip it: 2 hits, clean corpus, and it adds a third rule class.

> **Warning to whoever revisits this.** The _obvious_ fix — a call-shape discriminator (`name(`) — looks right and **goes red on `api-reference.md:194-196`**, where `shouldExtend(name: string)` sits legitimately in a Signature column. Two reviewers probed it; it fails. Use the alias rule or nothing.

### Everything is derived, and every derivation is checked by a _different_ derivation

Per ADR-008 rule 5 — this is the part three drafts got wrong.

| Derived value    | Guarded by                                                                                                       | Independent?                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Deprecated names | `getDescendantsOfKind(JSDocDeprecatedTag)` — **ask for the tag**, not a shape list                               | —                                               |
| `collides`       | `expect(s.collides).toBe(s.name in publicApi)` — **ts-morph static analysis vs the runtime ES namespace object** | ✅ two mechanisms that cannot fail the same way |
| Replacement text | non-empty + contains a backticked call                                                                           | ✅ asserts the prose the message depends on     |
| Guard result     | vacuity guards + a can-fail seed derived from the live set                                                       | ✅                                              |

**The counting oracle is deleted.** Draft 3 compared a raw `/@deprecated/g` count to the recovered count. `recovered ≤ raw` always, so it detected under-collection only — it certified **cardinality, never identity**, and a stray tag in prose raised both sides by one and cancelled exactly. It is ADR-008 rule 5's textbook case. Asking for the tag directly removes the need for it.

## Phase 1 — Read the symbols (tag-first)

**`tests/docs/deprecated-symbols.ts`**

```typescript
import { Node, SyntaxKind } from 'ts-morph'
import type { Project } from 'ts-morph'

export interface DeprecatedSymbol {
  readonly name: string
  readonly replacement: string
  readonly declaredAt: string // file:line — REPORTED, per ADR-008 rule 2
  readonly collides: boolean
}

/** ts-morph strips the ` * ` gutter but keeps newlines; 2 of the 8 tags wrap. */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function readDeprecatedSymbols(
  project: Project,
  sourceGlob = 'src/**/*.ts',
  entryPoint = 'src/index.ts',
): DeprecatedSymbol[] {
  // getExportedDeclarations() keys by the EXPORTED name, so the aliased
  // re-export (`haveNameMatching as conditionHaveNameMatching`) resolves natively.
  const exported = new Set(
    project.getSourceFileOrThrow(entryPoint).getExportedDeclarations().keys(),
  )
  const found = new Map<string, DeprecatedSymbol>()

  for (const sourceFile of project.getSourceFiles(sourceGlob)) {
    // Ask for the tag. Enumerating node shapes (isJSDocable && hasName) is a
    // hand-coded list — it misses an exported const arrow, whose JSDoc lives on
    // the VariableStatement. The tag knows where it is; we don't have to guess.
    for (const tag of sourceFile.getDescendantsOfKind(SyntaxKind.JSDocDeprecatedTag)) {
      const decl = tag.getFirstAncestor((a) => Node.isJSDocable(a) && Node.hasName(a))
      if (decl === undefined || !Node.hasName(decl)) continue
      const name = decl.getName()
      if (found.has(name)) continue // same name, same guidance — verified identical for all 3 today
      found.set(name, {
        name,
        replacement: normalise(tag.getCommentText() ?? ''),
        declaredAt: `${sourceFile.getFilePath()}:${decl.getStartLineNumber()}`,
        collides: exported.has(name),
      })
    }
  }
  return [...found.values()]
}
```

Verified against real `src/`: **10 tags → 8 unique names**, every name resolved, `collides` true for `conditionHaveNameMatching` / `shouldExtend` / `shouldImplement` / `shouldHaveMethodNamed`.

**The two guards that matter** (`tests/docs/deprecated-symbols.test.ts`):

```typescript
import * as publicApi from '../../src/index.js'

// ADR-008 rule 5: static analysis vs the runtime module namespace. Two mechanisms
// that cannot fail the same way. Verified: 0 disagreements; and if `collides`
// breaks entirely this reports 4, where a same-derivation test reports pass.
it('collides agrees with the runtime export surface', () => {
  for (const s of readDeprecatedSymbols(project)) {
    expect(
      s.collides,
      `collides for '${s.name}' disagrees with the real export surface. Do NOT flip ` +
        'this flag or edit this test — collides MUST come from getExportedDeclarations(). ' +
        'If it goes all-false, the 4 api-reference.md false positives return.',
    ).toBe(s.name in publicApi)
  }
})

// ADR-008 rule 2: the remedy is prose, so assert the prose. `/** @deprecated */`
// is legal and yields an empty FIX — the message is the only thing standing.
it('every @deprecated tag carries a usable remedy', () => {
  const symbols = readDeprecatedSymbols(project)
  expect(symbols.length, 'no deprecated symbols found — this guard is vacuous').toBeGreaterThan(0)
  for (const s of symbols) {
    expect(
      s.replacement,
      `@deprecated on '${s.name}' (${s.declaredAt}) has no usable replacement text. ` +
        'FIX: write the replacement into the tag, e.g. "Use `x()` after `.should()` instead." ' +
        'Do NOT delete this test — the tag text IS the fix an agent is given.',
    ).toMatch(/`\w+\(\)`/)
  }
})
```

**Files:** `tests/docs/deprecated-symbols.ts`, `tests/docs/deprecated-symbols.test.ts`.

## Phase 2 — The scanner

**`tests/docs/scan-markdown.ts`** — `patternFor` unchanged from draft 3 (it is correct and reviewer-verified):

- **COLLIDE** → `\.name(?!\w)`; a bare mention is ambiguous (`api-reference.md` documents it legitimately).
- **SOLO** → `\bname(?!\w)`; any mention is rot. This is what catches two-column tables.
- `(?!\w)` is **required**: `notImportFromCondition` is a strict prefix of `notImportFromConditionWithOptions`.
- **No `/g` flag** with `.test()` — `lastIndex` is stateful and would make hits depend on scan order.

`Hit` carries `matchedAs: 'dotted' | 'bare'` so the message never renders a call form that isn't on the line.

**Tested with a synthetic vocabulary**, not real names — the algebra outlives the 1.0 removal:

```typescript
const SYNTHETIC: DeprecatedSymbol[] = [
  { name: 'oldSolo', replacement: 'Use `newSolo()`.', declaredAt: 'x:1', collides: false },
  { name: 'oldShared', replacement: 'Use `newShared()`.', declaredAt: 'x:2', collides: true },
  {
    name: 'oldSoloWithOptions',
    replacement: 'Use `newOpts()`.',
    declaredAt: 'x:3',
    collides: false,
  },
]

it.each([
  ['dotted call, colliding', '.oldShared(`X`)', ['oldShared']],
  ['bare mention, colliding', '| `oldShared` | desc |', []], // the api-reference guard
  ['bare mention, solo', '| `oldSolo(glob)` | desc |', ['oldSolo']], // the two-column-table case
  ['right boundary', '.oldSoloWithOptions([], {})', ['oldSoloWithOptions']], // 1 hit, not 2
  ['twice on one line', '.oldShared(a) .oldShared(b)', ['oldShared']], // 1 hit per line
  ['link target', '[oldSolo](/api#oldSolo)', ['oldSolo']], // known: fires. Pinned deliberately.
  ['clean', 'Use `newSolo()` instead.', []],
])('%s', (_label, text, expected) => {
  expect(scanMarkdown([{ path: 'f.md', text }], SYNTHETIC).map((h) => h.name)).toEqual(expected)
})
```

**Files:** `tests/docs/scan-markdown.ts`, `tests/docs/scan-markdown.test.ts`.

## Phase 3 — The guard

**Enumerate with `node:fs`.** `picomatch` is a _matcher_ — it has no filesystem walk and cannot do this. Node 24 (ADR-001) does:

```typescript
const files = globSync(['docs/**/*.md', 'README.md']) // 32 files, verified
```

Scope is `docs/**` + `README.md`, so `ts-archunit-spec.md`, `CHANGELOG.md` (which names 7 deprecated symbols in one line, legitimately, forever), `plans/`, `proposals/`, and `adr/` are out **by construction** — no exclusion list to rot (ADR-008 rule 3). `docs/.vitepress/` contains zero `.md` files.

```typescript
const IMPERATIVE =
  'A doc teaches deprecated API. FIX: use the replacement named in each hit. ' +
  'Do NOT suppress this check, add an exception, delete this test, reword the doc to ' +
  'evade the match, or remove the @deprecated tag from src/. If a page must name ' +
  'deprecated API on purpose (e.g. a migration guide), that is a design decision — ' +
  'stop and ask a human. The migration narrative belongs in CHANGELOG.md.'

it('no living doc teaches deprecated API', () => {
  const files = readLivingDocs()
  const symbols = readDeprecatedSymbols(project)
  // Vacuity: toEqual([]) passes on an empty glob. ADR-008 rule 5.
  expect(files.length, 'living-docs glob matched nothing — this guard is vacuous').toBeGreaterThan(
    0,
  )
  expect(
    files.map((f) => f.path),
    'the false-positive canary is not in scope',
  ).toContain('docs/api-reference.md')
  // Per-hit facts on the hit; the imperative once, on the assertion.
  expect(scanMarkdown(files, symbols).map(format), IMPERATIVE).toEqual([])
})

it('the guard can fail: seeded rot produces a hit', () => {
  const symbols = readDeprecatedSymbols(project)
  const solo = symbols.find((s) => !s.collides)
  expect(solo, 'no solo symbol to seed with — the guard is now vacuous').toBeDefined()
  const seeded = [{ path: 'docs/__seeded__.md', text: `Use \`${solo?.name}(glob)\` to do it.` }]
  expect(scanMarkdown(seeded, symbols).map((h) => h.name)).toEqual([solo?.name])
})
```

The seed derives **from** the symbol set, so it cannot go stale — and at 1.0, when the tags vanish, it fails **loudly** rather than passing silently.

**The message** (ADR-008 rule 2), per hit — location, fix, and the disambiguation only where it applies:

```
docs/x.md:12 — `.shouldExtend()` is deprecated.
  FIX: Use `extend()` after `.should()` instead.
  This is the builder method (src/builders/class-rule-builder.ts:220) — NOT the
  `shouldExtend` condition export, which is current.        [only when collides]
```

**Files:** `tests/docs/deprecation.test.ts`.

## Decisions

1. **No escape hatch, and the message says so.** At 1.0 the methods are deleted, the tags vanish, the symbol set empties and the guard matches nothing — so a 1.0 migration guide passes. The collision window is _now_, and `CHANGELOG.md` already carries that content, out of scope by construction. A front-matter opt-out is **worse than none** for an agent consumer: it would get stamped on any page to go green, silently (ADR-008 rule 3). The sanctioned action for the one case the check cannot decide is _stop and ask a human_ — **advisory, enforced by code review**, not load-bearing.
2. **Do NOT gate `docs.yml`.** Reversed from draft 3, on measurement: `npm test` is **~103s on a 4-vCPU runner** (my 13.9s was a 14-core local number — `user 143.94` vs `real 13.72`), so the docs job goes 29s → ~132s, a **4.5x** increase, not the "+15s" the draft claimed. And the gate does not do what draft 3 said: `docs.yml` has `paths: ['docs/**']`, so it never fires for the src-side case at all. `ci.yml` already runs `npm test` on every push to `main` **and** every PR — the rot fails there. The residual hole is a ~1m50s window on a direct docs push to `main`, which does not justify 4.5x on every deploy plus the `concurrency` group `docs.yml` lacks. **Keeps this plan `tests/`-only.**
3. **The release gate needs no decision.** `publish.yml:27` already runs `npm test`; "accepting" it is a no-op. It is genuinely upstream of every irreversible effect — a reviewer traced it: `npm publish`, the GitHub Release, and `context7.yml` **all never fire**, so the blast radius is one orphan git tag. But per ADR-008 rule 2 the recovery path must be written down, or an agent invents one — and the invented one (**bump the version** instead of re-tagging) _goes green_ and ships an empty changelog to npm and the AI docs index. That is a real false-green in the release path and it is **not this plan's to fix** → `bugs/0011`.

## Out of Scope

- **The compile harness** (proposal 013 draft 1) → the **1.0 removal milestone**, when deprecation→removal makes the drift class certain. Note it **supersedes** this guard rather than extending it: at 1.0 this scan goes quiet by construction.
- **Reaching 27/27** via the alias rule — verified achievable at 0 FP; skipped as a third rule class.
- **The frozen corpus.** Draft 3 wanted 8 pages + a frozen `symbols.json`. The recall table above is a **one-time validation already performed and reproduced by five reviewers**; freezing it buys a regression test of the scanner at ~1h, against a guard with a 1.0 expiry. Not worth it. The synthetic algebra tests cover the mechanics.
- **Enabling `@typescript-eslint/no-deprecated` for `src/`** (~15 min, `src/`-only — ~74 legitimate deprecated call-sites live in `tests/`). Raised in priority by a review finding: TypeScript parses a line-start `@deprecated` **inside an `@example`** as a real tag, and `src/` has 140 `@example` blocks — so a live API could enter the vocabulary. The lint rule is the real remedy; the deprecation-workflow note should say **never write `@deprecated` inside an `@example`**. Separate PR.
- **`bugs/0009`** (the ~13 doc compile errors — a _stub describing work_, not a triaged list; they need the scope-aware preamble first), **`bugs/0010`** (ADR-007's dogfooding example references a non-existent `entry` export and is unscoped — would false-red against 107 test files), **`bugs/0011`** (the release-gate recovery path, decision 3). All three are **independent commits, not merge-blockers for this plan**.
- **`ROADMAP.md:162`** says "7 deprecated aliases" and lists 7; there are **8**. Free fix, not this plan.
- **The `shouldExtend` rename** → 0.18+, on its own merits. Note the interaction: it deprecates a standalone export in `src/conditions/`, which is exactly why Phase 1 walks `src/**/*.ts` rather than `src/builders/*.ts`.

## What was removed and why

Draft 3 was ~4–5h and growing. Every removed item was scaffolding that ADR-008 rule 5 shows was not doing its job:

| Removed                                           | Why                                                                                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The completeness counting oracle                  | Certified cardinality, not identity; blind by construction; misdiagnosed on most red paths. Asking for the tag removes the need.                                      |
| `conflicts` + the synthetic-project conflict test | The conflict branch dropped a declaration, tripping the oracle with the wrong remedy. Same-name-same-guidance is verified for all 3 duplicates; first-wins is honest. |
| The 8-file frozen corpus + `symbols.json`         | ~1h for a scanner regression test on a guard with a 1.0 expiry. The measurement is done and reproduced.                                                               |
| The `docs.yml` gate                               | 4.5x cost on a false premise; `ci.yml` already covers it.                                                                                                             |
| `bugs/*` as merge-blockers                        | Deferrals from reviews of _other_ artifacts. Write them; don't gate on them.                                                                                          |
| `toBeGreaterThan(25)`                             | A hand-picked magic number inside the assertion meant to prevent vacuity. `> 0` plus the canary does the real work.                                                   |
