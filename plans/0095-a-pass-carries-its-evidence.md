# Plan 0095 — a pass carries its evidence

**Status:** Open, not started. Filed 2026-08-06; revised the same day after a five-persona review (28
findings, marked ⚑), then a second **delta round** by the architect and testing reviewers over the
revision's own new mechanisms (10 findings, marked ⚑² — including one Critical: a fixture cell that was
unconstructible as named, hiding a suspected live fail-open behind it). Implements
[ADR-009](../adr/009-a-pass-is-constructed-from-evidence.md) (Proposed — this plan is the artifact that
should accompany it to Accepted; two of its Decision sentences were amended to match this plan's
analysis, recorded in the ADR itself). Executes
[ADR-010](../adr/010-the-extension-surface-is-a-contract.md) rule 3(a) (the `expectEmpty` hoist) and the
contract-break process for the seam retype. Carries the fix for
[bug 0066](../bugs/0066-a-smell-detector-over-zero-files-passes.md) inside it, per the ADR's
one-red-event requirement.
**Priority:** High. A High bug's fix is gated on it, both shipped presets construct the fail-open
configuration today, and Phase 0 doubles as the ADR-008 conformance audit — the measurement that says,
per published entry point, whether our green is real.
**Effort:** **Large** (⚑ revised from medium-large: the classification alone is dozens of reviewed
entries across twelve subpaths, and the phase that gets rushed when a budget runs out is Phase 0 — the
one the Priority line calls the point). Three phases across **two releases**.
**Blast radius:** **Published API — top row** of ADR-008 rule 6. Strangers depend on every entry point
this plan touches, and the seam it retypes is ADR-010's contract member. Guard the guard: the matrix
carries its own controls, the flip gets sabotage rows, and the retype gets adversarial review.

## Problem

Four waves of vacuity guards (0.18.0 discovery, 0.34.0 selection, bug 0048 attribution, and the live
suite around them) built every component ADR-009 needs — the terminal root, the configuration-finding
machinery, both declared-empty mints, the empty-project diagnosis — and the smell family still failed
open on the day all of them existed, because nothing makes the components **unavoidable**. Measured on
the 0.57.0 dist (2026-08-06):

| cell                                             | result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smells.duplicateBodies(p).check()`, zero files  | **PASSED** — fail-open (bug 0066, reconfirmed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `smells.inconsistentSiblings(p).check()`         | threw the **asserts-nothing** finding — the vacuity cell is masked; with `.forPattern(…)` it is expected fail-open (BUGS.md) but **not yet measured**                                                                                                                                                                                                                                                                                                                                                                                       |
| `schema(dir, glob)`, zero `.graphql` files       | **THREW** — the loader fails closed; one family conforms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `resolvers(p, glob)`, zero-file project          | **unmeasured** (probe recipe was wrong; Phase 0 fixes it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CLI `check` over a zero-file project             | **unmeasured** (bug 0066's third "Not measured" item — a Phase 0 row, ⚑)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| call family, `within()` yielding zero callbacks  | **GUARDED — suspicion refuted, measured** (⚑³ 1 file loaded, **2 calls matched**, zero callbacks extracted → threw the empty-selection configuration finding; control with a real callback threw an ordinary violation, so the probe discriminates). `ScopedFunctionRuleBuilder` narrows by **overriding `getElements()`**, and `filterElements()` calls `getElements()` — so the scoped materialization _is_ routed through the shared path and `rule-builder.ts:577` sees the scoped set. The docstring's warning names a different path. |
| rule family, empty selection / dead glob         | guarded, live tests (`dead-selector-fails`, plan 0069/0074)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `.warn()` per family, presets × smells, tsconfig | **never measured**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

ADR-009 decided the shape of the fix: evidence at every family's seam, required by the terminal seam's
type, empty only by declaration, an empty project outranking every declaration, enforced by the compiler
plus a vacuity matrix enumerated from the `package.json` exports map. This plan builds exactly that.

## Release shape

Per ADR-009's migration rulings (and ADR-008 rule 1's diagnostic-first corollary):

- **Release A (no `check()` behaviour changes — ⚑ not "nothing breaks", which was false):** evidence
  computed at every seam behind a public accessor; `diagnose()` — the core, not just the doctor wrapper
  (⚑) — gains a `zero-subjects` finding kind derived from that computation, and doctor renders it, so
  "two hosts, one diagnosis" stays true **and test-runner users get a preview after all**: the release-A
  changelog carries the recipe `expect(diagnose(rules)).toEqual([])` to run inside their own suite.
  Priced honestly in the release notes: doctor-in-CI users see new findings (doctor exits non-zero on
  anything), `DiagnosticFinding['kind']` is a documented JSON contract growing a member, diagnosing now
  _runs_ each family's selection-and-filter counting (both hosts' "without running any of them" sentence
  changes — `doctor.ts:14`, `diagnose.ts:107`), and suites calling `diagnose()` get a time increase. The
  vacuity matrix lands in **audit mode**. Changelog leads with the active instruction: _run
  `doctor` / `diagnose()` now; what it reports under `zero-subjects` goes red next release_ — plus the
  interim remediation (`.expectNonEmpty()` where reachable).
- **Release B (breaking, one red event):** the seam retype, the root conversion, the precedence flip,
  the `expectEmpty` hoist, the preset threading, the `allowEmpty` conversion, and the smell-family fix —
  together. The matrix's known-fail-open list is emptied in the same commit. The changelog is
  **self-contained** (⚑ dependabot users jump straight over A): the full per-cause remedy table inline,
  every break enumerated — including the `.warn()` flip and the precedence flip, which red previously
  green suites with no code change — the `allowEmpty` migration in its honest two-branch form, a link to
  the Phase 0 truth table, and the terminal claim **scoped falsifiably** (⚑): _zero examined units can
  no longer produce a pass, for any published check entry point, enforced by `tests/matrix/` — the
  named residues (ADR-009 Notes) remain review-enforced._

## Phase 0 — the matrix in audit mode (this is the ADR-008 conformance audit)

`tests/matrix/enumerate.ts` (⚑ shared) — one enumeration for the whole suite: read the `package.json`
exports map (twelve subpaths: root, nine `./rules/*`, `./presets`, `./graphql`) and expose it two ways
(⚑² so the migration does not re-import the stale-dist problem into the default suite): a **pure-data
module** — the subpath list, each with its mechanical `src/` counterpart — importable from anywhere, and
the **dist-importing prober** (package self-reference, `@nielspeter/ts-archunit/...`, the
`verify-package.mjs` pattern, recursing into namespace-object exports), which only `tests/matrix/` may
import. `assertion-gate.test.ts`'s hand-maintained `[rootExports, graphqlExports]` list migrates to the
pure-data module and keeps importing `src` — one authoritative list, and the default suite still runs
without a build.

`tests/matrix/vacuity-classification.ts` — every export classified, as a discriminated union (⚑ the
"recipe iff check" rule is a type, not a comment), and **each check names its examined unit** (⚑ ADR-009
part 1 makes the unit a written claim; a field, not a plan table no future family reads):

```ts
interface Ctx {
  project: ArchProject // zero-file fixture
  dir: string // empty directory, for constructors that take a root (schema)
}
interface Probeable {
  check(): void
  warn(): void // ⚑² the observable on the flipped path is the throw, not a return value
}
type Entry =
  | { kind: 'check'; unit: string; recipe: (c: Ctx) => Probeable; deviation?: string }
  | { kind: 'preset'; unit: string; recipe: (c: Ctx) => Probeable[]; deviation?: string } // ⚑ presets are probed, not helpers
  | { kind: 'helper' | 'class' | 'namespace' | 'no-corpus' }
```

- **Completeness, both directions** (⚑): every discovered export appears in the classification, and
  every non-`control:` entry corresponds to a live export — stale rows fail, the pattern
  `every-config-finding-is-classified.test.ts` already uses.
- **Probes and the recorded table:** each recipe runs over the zero-subject fixture at `.check()`
  **and** `.warn()`, and the table records the **full three-way verdict per cell** —
  `fail-open | config-finding | other-throw` — in **both** phases (⚑² membership lists alone cannot see
  a probe that misclassifies throws). Phase 2 acceptance is per-cell, not "config-finding everywhere":
  the schema loader's plain throw is a conforming instrument and its cell's expected verdict is
  `other-throw`, recorded as a `deviation` (fail-closed-by-instrument). If Phase 0 finds the
  fieldless-SDL cell unreachable because the loader reds first, that is recorded the same way (⚑²) —
  not left as an unwritten fixture someone later "fixes" by weakening the loader.
- **Recipes are the bare construction**; `deviation` is required whenever they are not (the
  `inconsistentSiblings` masking is the worked example: bare reds on the assertion gate before the
  vacuity cell is reached, so its recipe carries `.forPattern(…)`).
- **Audit mode, ratcheted and expiring** (⚑): `KNOWN_FAIL_OPEN` must be a subset of a dated measurement
  constant (`AUDIT_2026_08`) — the list can only shrink — and the matrix reds if the list is non-empty
  once the package version reaches the release-B target: a slipped release B fails the audit itself
  (ADR-008 rule 6's scheduled-expiry row). Stated residue (⚑²): during the release-A window a
  regression plus a same-diff edit of **both** constants passes; that hatch is bounded by the expiry and
  by review of a constant whose name says it is a dated measurement, and per ADR-008's own standard the
  unclosable remainder is recorded here rather than papered over.
- **Three controls, in their own `it()` blocks, permanent** (⚑, ⚑² — never routed through
  `KNOWN_FAIL_OPEN`, which Phase 2 empties): `control:fail-open` (a fake that passes over nothing),
  `control:other-throw` (a fake throwing a plain error), and `control:config-finding` (⚑² a fake
  emitting a genuine `bypassFilters` finding through `ArchRuleError`) — all through the identical probe
  function, closing the verdict triangle: a probe that misclassifies any of the three verdicts reds a
  control.
- **Freshness by build stamp, not mtime** (⚑ git and CI caches scramble mtimes in both directions):
  `npm run build` appends a step writing `dist/.build-stamp.json` — a hash over the sorted
  `(path, content-hash)` pairs of `src/**` **plus `tsconfig.build.json` and `package.json`, with the
  TypeScript version as a recorded field** (⚑² compiler-option and exports-map changes alter dist with
  identical `src/`) — and the matrix recomputes and compares. The stamp ships in the tarball
  (`files: ["dist"]`); accepted, it is one small file.
- **CLI row** (⚑ ADR-009 assigns it to this plan twice; measurement is cheap even where the fix is
  follow-up): run the CLI `check` command over the zero-file fixture, record exit code and output in the
  truth table.

**Wiring** (⚑ as first drafted this either reds every CI run or never runs in CI — tests run _before_
build in both workflows and `dist/` is gitignored; `verify-package.mjs`'s header documents this exact
trap and the pattern to copy): `tests/matrix/` is **excluded from the default vitest include**
(`vitest.config.ts`); `test:matrix` builds, then runs it; explicit post-build steps in **both** `ci.yml`
(beside `verify-package.mjs`) and `publish.yml` — so the audit is loud on every push, not only at
publish (a tag is too late to learn a cell moved). `prepublishOnly` runs the matrix against the build it
already made, asserting the stamp rather than building a third time (bug 0062's gates-drift warning: the
matrix has one implementation, referenced from three slots).

**Deliverable:** the completed truth table, appended to bug 0066 and this plan, **linked from the
release-A changelog** (⚑ the falsifiable backing for release B's terminal claim belongs where users can
see it, not only in-repo). The table records per-family deviations honestly — including that the
empty-project precedence rows are unreachable for correspondence, whose constructor discards its project
by documented design (⚑² the precedence inventory must not imply seven-family coverage). The `within()`
cell was measured ahead of the phase and came back **guarded** (⚑³) — no bug number needed, and the
`RuleBuilder` grammar's scope shrinks accordingly (see Phase 1).

**Files changed:** `tests/matrix/enumerate.ts`, `tests/matrix/vacuity-classification.ts`,
`tests/matrix/vacuity-matrix.test.ts`, `tests/matrix/fixtures/empty/tsconfig.json` (all new),
`tests/core/assertion-gate.test.ts` (consumes the shared subpath data), `vitest.config.ts` (⚑
exclusion), `package.json` (`test:matrix`, build stamp step), `.github/workflows/ci.yml`,
`.github/workflows/publish.yml` (⚑ post-build steps).

## Phase 1 — evidence at every seam, and the preview (ships in release A)

Each family computes its examined-unit count at its own seam, exposed through a **public** accessor on
`DiagnosableRule` (⚑ a protected member cannot satisfy that structural interface — the recorded reason
`assertsSomething()` is public; same precedent, same shape). The accessor is de-facto API once public
(⚑²): release B makes it **delegate to the same computation `CollectResult.examined` carries** — one
derivation, two readers — and it joins ADR-010 rule 1's contract table with the retype.

| family                           | examined unit                                                                                                                                                                                                                                                                                                                                                | seam                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| rule family                      | post-filter subject set handed to conditions — the count at `rule-builder.ts:577`. **Already the examined set**, so the wire is an accessor over an existing number, not a new derivation. Phase 0 enumerates the `RuleBuilder` subclasses to confirm none narrows outside `getElements()` (⚑³ the one suspected exception, `within()`, measured conformant) | `src/core/rule-builder.ts` `evaluate()`           |
| _(scoped/call — no wire needed)_ | ⚑³ measured conformant: `ScopedFunctionRuleBuilder` narrows via a `getElements()` override that `filterElements()` routes, so its examined set **is** the counted set. Listed to record the measurement, not to schedule work.                                                                                                                               | `src/builders/scoped-function-rule-builder.ts:27` |
| duplicateBodies                  | bodies entering pairwise comparison (post-`minLines`)                                                                                                                                                                                                                                                                                                        | `src/smells/duplicate-bodies.ts` `detect()`       |
| inconsistentSiblings             | grouped sibling-file set entering `partitionByPattern` (⚑ the unit the code can count without fiction)                                                                                                                                                                                                                                                       | `src/smells/inconsistent-siblings.ts`             |
| correspondence                   | keys of both sides, summed                                                                                                                                                                                                                                                                                                                                   | `src/builders/correspondence-builder.ts`          |
| graphql schema                   | schema fields entering the chain (loader already fails closed on zero files)                                                                                                                                                                                                                                                                                 | `src/graphql/schema-rule-builder.ts`              |
| graphql resolvers                | collected resolver functions                                                                                                                                                                                                                                                                                                                                 | `src/graphql/resolver-rule-builder.ts`            |
| tsconfig                         | `no-corpus` — the requirements object is the input                                                                                                                                                                                                                                                                                                           | classified, not counted                           |

**Fixture design requirement** (⚑ upgrades an accidental property into a deliberate one): every
files>0/units=0 fixture must hold **every upstream count non-zero** — files loaded, globs matched,
pre-filter selection non-empty — while the seam count is zero. That makes the fixtures a behavioural
provenance guard: evidence wired to any upstream layer (`examined: sourceFiles.length` and its cousins)
reds them. **The whole `RuleBuilder` grammar has no such cell, and that is now measured rather than
argued** (⚑², ⚑³): `filterElements()` returns the one set that is both the selection and what conditions
receive, and the one builder suspected of narrowing outside it — `within()`'s scoped functions —
narrows by overriding `getElements()`, which `filterElements()` calls. Probed on 0.57.0 with 2 calls
matched upstream and zero callbacks extracted: it **threw** the empty-selection finding. So for this
grammar, examined ≡ selection, the 0.34.0 guard already _is_ the ADR-009 floor, and the state is
recorded as an **equivalence** per ADR-008's structurally-unobservable note — not tested twice, and not
re-wired. The families needing new evidence are exactly those outside the grammar: the two smells,
correspondence, and the two graphql builders, all of which extend `TerminalBuilder` directly and own
their own materialization. **A `within()` regression row stays in the inventory** — the guard is
load-bearing now that it is the floor, and nothing else asserts it.

The `zero-subjects` kind lands in `src/core/diagnose.ts` (⚑ the core — doctor stays a renderer, "two
hosts, one diagnosis" stays true, and `diagnose()` is the test-runner user's preview). `doctor.ts`'s
`HAS_GLOB` record is a `Record` over the kind union, so the new kind fails `tsc` until its rendering is
decided — cite that in the PR.

**Files changed:** the family files above, `src/core/diagnose.ts` (⚑ was unlisted),
`src/cli/commands/doctor.ts`, `docs/cli.md` (the "without running" sentence and the doctor kind table),
`docs/api-reference.md` (the documented `DiagnosticFinding` JSON contract), tests per inventory.

## Phase 2 — the flip (ships in release B, one red event)

**2a. The seam retype** (`src/core/terminal-builder.ts:697`, ADR-010 contract process):

```ts
export interface CollectResult {
  violations: ArchViolation[]
  /** Units this family's own semantics examined — subjects, bodies, keys. Never file counts. */
  examined: number
}

protected abstract collectViolations(): CollectResult
```

**2b. The root conversion — a floor under the families, not a replacement for them** (⚑ the first
sketch discarded family-produced findings; ⚑² the second omitted the expiry half):

```ts
const { violations, examined } = this.collectViolations()
if (violations.length === 0 && examined === 0) {
  const project = this.getProject()
  if (project && loadedNothing(project)) {
    // Instrument level: outranks every declaration — .expectEmpty() and .notExist() included.
    return [this.emptyProjectViolation(project)]
  }
  if (!this.declaresEmpty()) return [this.zeroSubjectsViolation()]
}
if (examined > 0 && this._expectEmpty) {
  // The expiry half, at the root for every family (⚑² — previously only the rule family enforced it):
  // a declared-empty check that gained a unit fails, with the mechanical remedy (remove the declaration).
  // NOT `declaresEmpty()`: `.notExist()` over a non-empty selection is the condition doing its job,
  // never an expired declaration.
  return [this.expiredDeclarationViolation(examined), ...violations]
}
return violations
```

- A family that already produced a finding — any finding — passes through untouched; the root fires
  only where a family produced _nothing_ from _nothing_, which is the bug-0066 shape. The two halves
  are sited differently, and the difference is not cosmetic:
  - **Empty half — the family site stays.** `rule-builder.ts:577-584` fires on a condition the root
    cannot see (this family's own selection is empty) and produces a better-attributed message; the
    root is the floor beneath it. Verdict-identical, traced. **Its remedy text delegates to the 2d
    producers, or a coupling test asserts the shared sentence** (⚑² two texts for one state is the
    plan-0070 drift shape, and that site's text at `rule-builder.ts:535-536` is already stale from
    0074 — it is rewritten here either way).
  - **Expiry half — the family site is DELETED, root owns it.** `rule-builder.ts:588`
    (`unexpectedlyNonEmptyViolation`) fires on exactly the state the root's expiry branch now covers,
    so keeping both double-reports one fault (caught in the plan's own sketch before implementation:
    the family returns its finding, then the root appends a second). Its message content moves into
    `expiredDeclarationViolation`, which every family then shares. **Test row:** a rule-family
    `.expectEmpty()` that gains a subject produces **exactly one** finding. (While there: the
    duplicated dead comment at `rule-builder.ts:590-591` goes with it.)
- **`getProject()` may be undefined** (⚑ correspondence discards its project by documented design, and
  every ADR-010 foreign dialect over a non-TS element type has none): the instrument level is skipped
  honestly — the zero-subjects floor still holds, and a family with its own instrument (the schema
  loader) keeps it. Correspondence's pre-existing mis-attribution over an empty project (per-side
  findings blame the sides, the instrument level being unreachable) is **named residue** (⚑²), not
  worsened and not silently absorbed.
- The selection-level ordering inside `deadSelectorFindings()` (`terminal-builder.ts:509`) is untouched:
  `.notExist()` over a **loaded** project with zero matches is still satisfaction.
- **Position equivalence, recorded so nobody invents a guard for it** (⚑²): every downstream drop
  channel (exclusions, severity, baseline, diff-aware) refuses `bypassFilters`, so a floor wired below
  filtering is observationally identical _for a finding carrying the flag_. The non-equivalent
  mis-wirings — the floor inside one terminal only, or the finding shipping without `bypassFilters` —
  are exactly what the triple-route assertion in the inventory exists to catch.

**2c. The hoist** (ADR-010 rule 3(a)): `.expectEmpty()` / `.expectNonEmpty()` and their contradiction
guard move from `src/core/rule-builder.ts:140-180` to `TerminalBuilder`; `copy()` carries the boolean
via the existing clone path. **`CorrespondenceBuilder` overrides with an optional side** (⚑ a required
parameter is not a valid override): `expectEmpty(side?: string)` — with a side, the per-side expiring
assertion replacing `allowEmpty`; without, the whole-rule declaration. **For correspondence,
`declaresEmpty()` is the whole-rule boolean OR all sides individually declared** (⚑² — without the OR,
a user who declared every side still reds zero-subjects with a remedy telling them to declare, the
ADR-008 rule 2 loop). Declaring only _some_ sides does not set it (test row).

**On the mints:** `declaresEmpty()` reads both existing mints — the cardinality `WeakSet` registry and
the `_expectEmpty` boolean — behind one consumer with one semantics. The boolean survives as a mint
deliberately: it is a protected field settable only through the sanctioned method and carried by
`shallowClone` on every chain step, where `WeakSet` membership keyed on a builder would be lost at the
first `copy()`; its audience is subclass authors, governed by ADR-010's contract, not the
user-constructible condition objects the registry was forged against. **ADR-009's part 2 sentence was
amended to say exactly this** (⚑² — ratifying a flagged contradiction was the wrong resolution; the ADR
now states the two-mint mechanism, and this paragraph is the argument of record).

**2d. Per-cause remedies** (ADR-009 part 4), with three additions from review:

- The **filters-excluded-everything** message names the actual excluder, **including internal
  defaults** (⚑): "N function bodies found, all below `minLines(5)`" / "no folder held 2+ sibling
  files".
- When the rule id begins `preset/`, the remedy is **preset-shaped** (⚑ the builder-shaped remedy is
  unwritable for a preset user): it names the exact option to add (see 2e), never `.expectEmpty()`.
- The **empty-project** message keeps its shipped text and never mentions `.expectEmpty()` — asserted as
  a negative string test per cause (the suppressor-negative pattern in `assertion-gate.test.ts`),
  forked per cause because for filters-excluded, `.expectEmpty()` _is_ the sanctioned remedy.

**2e. Presets thread the declaration — one uniform option** (⚑; ⚑² hardened after the delta round
found its unguarded derivation):

```ts
// On every preset's options — typed on the preset's own rule-id union, matching `overrides`:
expectEmpty?: AgentGuardrailsRuleId[] // e.g. ['preset/agent/no-copy-paste']
```

The declaration threads to the named rule's mint and expires per rule. **An id that binds to no
constructed rule — a typo, a stale id, or the id of a rule whose enabling option is absent — is itself a
failing configuration finding** (⚑² the silent version converts an expiring assertion into nothing, and
2d's remedy would tell the user to add the option they already added, misspelled — bug 0017's shape;
the channel is the presets' existing unknown-`overrides`-key finding path, ordered first per bug 0038),
naming the ids the preset actually constructed. This also buys rename protection — a preset rule-id
rename now reds every stale declaration instead of silently expiring it — and makes the coupling
explicit: **preset rule ids are a declaration interface, so renaming one is a breaking change to
`expectEmpty` too** (⚑² owned, one line). Applies to **all five presets**. ADR-009's part 3 sentence
was amended to the carrier form this implements.

**2f. `allowEmpty` converts** — with the honest **two-branch migration** (⚑ "one line" was false):
a side that is empty today → `.expectEmpty(side)`; a side that has keys today → delete the call; and
the third intent — "may be empty sometimes, silently" — is **removed, not renamed**, per ADR-009's
Alternatives, and the changelog says so out loud.

**2g. The matrix flips and the break is witnessed:** `KNOWN_FAIL_OPEN` emptied in the retype's commit;
the graphql reference implementation and `docs/graphql.md` updated in the same commit (ADR-010 rule 2);
and a **compile check of the old signature** — a fixture subclassing against the published `.d.ts` with
the old `collectViolations(): ArchViolation[]` shape, asserted via a **programmatic `tsc` run whose
non-zero exit is the assertion** (⚑² not a bare `@ts-expect-error`, which passes silently if the fixture
drops out of the program) — the external dialect's upgrade experience, simulated in-repo; ADR-010's
fixture and eess's bump gate remain the real thing.

**Existing tests this phase must touch, named now** (⚑ so they are not improvised under deadline):
`tests/core/config-findings-carry-their-own-remedy.test.ts` (asserts the correspondence remedy contains
`.allowEmpty(` — flips to the new remedy, **with a remediation row**, not just a contains flip);
`tests/core/every-config-finding-is-classified.test.ts` (the `zeroSubjectsViolation`,
`expiredDeclarationViolation`, and unmatched-preset-id producers join the census with `behavioural:`
citations).

**Files changed:** `src/core/terminal-builder.ts`, `src/core/rule-builder.ts`,
`src/smells/smell-builder.ts`, both smell detectors, `src/builders/correspondence-builder.ts`, the call
rule builder (⚑² evidence wire), all five preset files, both graphql builders, `src/core/execute-rule.ts`
(result-shape consumers), the two named test files, `tests/matrix/*`, `CHANGELOG.md`. Docs (⚑ the pages
an upgrading user actually lands on): `docs/upgrading.md` (both release rows), `docs/troubleshooting.md`
(its "every rule passes, and doctor says 0 files" premise becomes false; new zero-subjects entry),
`docs/api-reference.md` (kind union, `.allowEmpty()` row out, the external-subclass "exempt by default"
story inverts under the retype), `docs/core-concepts.md` (:269 calls `.allowEmpty()` "hypothetical" — it
shipped; reword), `docs/recipes.md` (⚑ new recipe: shared rule file across N packages where some are
legitimately tiny — per-package branching, the preset `expectEmpty` option, and the expiry churn when a
tiny package graduates), `docs/smell-detection.md`, `docs/presets.md`, `docs/graphql.md`, `docs/cli.md`.

## Test inventory

Phase 0:

- enumeration completeness, **both directions**, controls exempted by prefix; unclassified export fails.
- per-cell probes at `.check()` and `.warn()`, **three-way verdict recorded per cell in both phases**
  (⚑²); audit-mode exactness (a cell moving either way fails); ratchet (`KNOWN_FAIL_OPEN ⊆
AUDIT_2026_08`); expiry (non-empty list past the release-B version target fails).
- **all three control fakes** asserted in their own `it()` blocks, through the identical probe function,
  surviving the Phase 2 flip (⚑² the config-finding fake closes the triangle).
- build-stamp freshness (inputs: `src/**`, `tsconfig.build.json`, `package.json`, compiler version);
  CLI `check` over the empty fixture, behaviour recorded. (The `within()` cell is measured — guarded,
  ⚑³ — and moves to Phase 1 as a regression row; Phase 0 instead enumerates the `RuleBuilder`
  subclasses to confirm none narrows outside `getElements()`.)

Phase 1:

- per family, the files>0/units=0 fixture with the provenance requirement (every upstream count
  non-zero) — **for the five families outside the `RuleBuilder` grammar** (⚑³ the grammar's own cell is
  an equivalence with the 0.34.0 cell, measured, not re-tested): duplicateBodies (bodies all under
  `minLines`), inconsistentSiblings (files loaded, zero sibling groups — one function per file),
  correspondence (both sides empty), resolvers (loaded project, resolver glob matches nothing), schema
  (a matched `.graphql` file defining zero fields — Phase 0 first measures whether the loader already
  reds there; if so, recorded as fail-closed-by-instrument). Plus tsconfig (`no-corpus`, asserted
  classified).
- **`within()` regression row** (⚑³): 2 calls matched, zero callbacks extracted → the empty-selection
  configuration finding, with a control asserting a real callback yields an ordinary violation. The
  probe exists (`scratchpad/within-probe.mjs`); it becomes a test because this guard is now the floor
  for the whole grammar and nothing else asserts it.
- diagnose/doctor: `zero-subjects` fires **on a files>0/units=0 fixture** (⚑ on a zero-file fixture
  `project-empty` fires and the new kind could be dead while the test passed); **and does NOT fire
  beside `project-empty` on a zero-file project** (⚑² one fault, one finding — without the negative
  row, release A double-reports every empty project and prefigures the precedence flip wrongly); the
  JSON contract row; doctor renders and exits non-zero.
- sabotage: break one family's evidence computation → diagnose's row moves with it (coupling, stated as
  same-derivation by design; the matrix is the independent check).

Phase 2:

- per family, **the triple-route shape** (⚑² the stated per-family assertion, catching both
  non-equivalent mis-wirings of the floor): the zero-units finding asserted through `violations()`
  **and** `check()` **and** `.warn()`, with `bypassFilters` read off the `violations()` result — the
  `assertion-gate` triple pattern; then: with the declaration → passes; declaration plus a unit appears
  → fails via the root's expiry branch (⚑² every family, not just rules) and applying the stated remedy
  clears it — **remedy-remediates per cause, including the preset-context row** (⚑).
- precedence: empty project + `.expectEmpty()` → still the empty-project finding; empty project +
  `.notExist()` → same; loaded project + `.notExist()` + zero matches → pass. (Correspondence's
  unreachable instrument row recorded as deviation, ⚑².)
- tripwire regression row (⚑): a condition-glob tripwire iterating N subjects and matching none still
  passes.
- hoist: `.expectEmpty()` reachable and effective on `SmellBuilder`; contradiction guard;
  `expectEmpty(side?)` rows: some-sides-declared → still reds; **all-sides-declared → passes** (⚑²);
  one-side + that side gains a key → expires.
- presets (⚑²): unmatched `expectEmpty` id → failing config finding naming the constructed ids;
  option-disabled variant (`expectEmpty: [id]`, enabling option absent) → same; correcting the id
  clears both that finding and the zero-subjects finding.
- negative message assertions per cause (empty-project never names `.expectEmpty()`).
- `.warn()` on the new finding throws; the old-signature `tsc` compile check exits non-zero; the named
  census/remedy test updates.
- sabotage matrix, ADR-008's recorded standards in full (⚑): green baseline first, exclusive tree, exit
  codes, **each patch asserted to apply non-trivially**, **caught-by-nothing reported as a number**, and
  the split-row rule applied to this plan's own prose — the family evidence wires are one row each
  (call family included, ⚑²), the preset threading is one row per preset file, the two mints are two
  rows, the root's floor and expiry branches are two rows (⚑²); further rows enumerated from the diff
  at implementation time.

## Out of scope

- **Fixing whatever the CLI row measures beyond the root conversion's reach.** The row itself is in
  scope (Phase 0); if CLI `check` runs the terminal path, release B covers it and a Phase 2 row asserts
  the nonzero exit — anything further is follow-up with its own number.
- **Bug 0068** — independent; may ride release A's train as a **separate PR with its own changelog
  entry** (⚑ scheduling, not scope: it must not blur release A's additive narrative).
- **Bug 0056's fail-open half**; **user-condition internal vacuity** (`defineCondition` bodies —
  ADR-009's named residue; foreign dialects that miscount their own evidence are likewise their
  ADR-010 contract obligation, ⚑²); **ADR-010's contract fixture** (the old-signature compile check
  here is a proxy, not the fixture); **eess migration timing** — owned by eess's ADR-009 rule 4 bump
  gate, which is also the second foreign verification of the migration note.
