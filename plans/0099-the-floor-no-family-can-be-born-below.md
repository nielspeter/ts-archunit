# Plan 0099 — the floor no family can be born below

**Status:** Open, not started. Filed 2026-08-08, split out of [0098](./0098-the-evidence-seam-and-the-floor.md)
when that plan's own amendment measured it as two plans wearing one number.
**Depends on:** [0098](./0098-the-evidence-seam-and-the-floor.md) (the floor reads `CollectResult.examined`,
which does not exist until the seam lands), [0097](./completed/0097-the-declared-empty-grammar.md) (the floor
reads the mint it lifts), [0089](./0089-presets-forward-their-options.md) (a preset user cannot write
`.expectEmpty()`, so the escape hatch has to arrive through preset options or the remedy is one the reader
cannot follow — ADR-008 rule 2).
**Carries** the fix for [bug 0066](../bugs/0066-a-smell-detector-over-zero-files-passes.md), deliberately:
ADR-009 requires the seam change and the smell-family fix in **one red event**, so 0098 and this ship in one
release even though they are separate PRs.
**Priority:** High. This is the plan that makes vacuity unrepresentable; 0095–0098 prepare for it.
**Effort:** Medium.
**Blast radius:** **Published API — top row** of [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6.
Every entry point flips from pass to fail on one input class. Guard the guard: adversarial review of the
floor, sabotage per branch, and the 0095 matrix as the independent behavioural check — which for this plan
it genuinely is, because the matrix probes `check()` over a zero-file corpus and that is exactly what
changes.

## Problem

After 0098 every family **reports** what it examined, and after 0096 `diagnose()` **previews** the ones that
examined nothing. Neither fails. A rule whose glob matched nothing, whose filters excluded everything, or
whose corpus never loaded still returns green from `check()`, and the suite counts it as coverage — the
statement ADR-008 opens with, and the reason [bug 0066](../bugs/0066-a-smell-detector-over-zero-files-passes.md)
reported 401 findings as clean.

The components to fix it all exist. What does not exist is the thing that makes them **unavoidable**: a
guard is something you can forget to add, and four waves of guards were each followed by a family outside
their enumeration. 0098 makes the evidence unforgettable at the type level. This plan makes acting on it
unforgettable at the root.

## The work

**Convert at the root — a floor beneath the families, not a replacement for them** (`terminal-builder.ts`,
the single consumer 0098 leaves behind):

```ts
const { violations, examined } = this.collectViolations()
if (violations.length === 0 && examined === 0) {
  const project = this.getProject()
  if (project && loadedNothing(project)) return [this.emptyProjectViolation(project)]
  if (!this.declaresEmpty()) return [this.zeroSubjectsViolation()]
}
if (examined > 0 && this._expectEmpty)
  return [this.expiredDeclarationViolation(examined), ...violations]
return violations
```

Four rulings that are not obvious from the code and must not be re-derived by whoever implements it:

- **A family that produced any finding passes through untouched.** The root fires only where a family
  produced _nothing_ from _nothing_ — the bug-0066 shape. The rule family's own empty-selection block stays
  as its better-attributed implementation; its **remedy text delegates to the shared producers**, or a
  coupling test asserts the shared sentence, because two texts for one state is the plan-0070 drift shape.
- **The expiry half is the root's alone.** `rule-builder.ts:588` already covers that exact state, so keeping
  both double-reports one fault — caught in the sketch before implementation. Its message content moves to
  the shared producer, and a test asserts a declared-empty rule that gains a subject produces **exactly one**
  finding. Note the branch reads `_expectEmpty`, **not** `declaresEmpty()`: `.notExist()` over a non-empty
  selection is the condition doing its job, never an expired declaration.
- **`getProject()` may be undefined** — correspondence discards its project by documented design, and every
  ADR-010 foreign dialect over a non-TypeScript element type has none. The instrument level is skipped
  honestly; the zero-subjects floor still holds.
- **An empty project outranks every declaration.** A declaration asserts a fact about a loaded corpus; over
  zero loaded files it asserts nothing, and the expiry that justifies `.expectEmpty()` never engages — so on
  a solution-style tsconfig an agent's one-line `.expectEmpty()` would restore bug 0066's 401
  findings-reported-clean **forever**, through the sanctioned door. This supersedes the precedence bug 0066's
  root-cause note endorsed: that ordering stays correct at **selection** level and is now wrong at
  **instrument** level.

**Per-cause remedies** (ADR-009 part 4). Three causes, three remedies, and rule 2 forbids naming one as
universal: empty project → point at the tsconfig holding the sources, and **never** offer `.expectEmpty()`;
dead selector glob → fix the glob; filters excluded everything → the one judgment call, and the message names
the **actual excluder including internal defaults** ("N bodies found, all below `minLines(5)`"), because "fix
your filters" to a user who wrote none sends an agent looking for filters that do not exist. When the rule id
begins `preset/`, the remedy is preset-shaped.

**Reuse the per-family spelling 0096 shipped.** `emptyDeclarationAdvice()` already exists on `TerminalBuilder`
and is overridden by `CorrespondenceBuilder`; the floor's remedies read it rather than hard-coding
`.expectEmpty()`, which is a `TypeError` on that class. The classification census in
`tests/core/evidence-at-every-seam.test.ts` already forces the pair.

**Shrink `KNOWN_FAIL_OPEN` to one entry** in the same commit as the floor — `duplicateBodies`,
`inconsistentSiblings`, `agentGuardrails`, `strictBoundaries` all become `config-finding`. It cannot be
emptied: `dataLayerIsolation` constructs zero rules and no per-rule floor reaches it — and 0100's
measurement found `agentGuardrails` silent at its minimal call too, which the matrix's own recipe hid
([0100](./0100-a-preset-that-constructs-nothing.md)). The matrix's `EXPIRES_AT_VERSION` stays, and the
remaining entry carries a `// 0100` citation so the list names its own reason rather than looking stalled.

## Files changed

`src/core/terminal-builder.ts`, `src/core/rule-builder.ts`, `src/core/execute-rule.ts`, `tests/matrix/*`,
`tests/core/every-config-finding-is-classified.test.ts` (three new producers join the census with
`behavioural:` citations), `CHANGELOG.md`, `docs/upgrading.md`, `docs/troubleshooting.md` (its "every rule
passes, and doctor says 0 files" premise becomes false), `docs/api-reference.md` (the external-subclass
"exempt by default" story inverts), `docs/smell-detection.md`, `docs/presets.md`, `docs/recipes.md` (a shared
rule file across N packages where some are legitimately tiny), `bugs/0066-*.md` → `bugs/fixed/`; this plan
moves to `plans/completed/`.

## Test inventory

- **`.expectEmpty()` is EFFECTIVE, not merely reachable** — moved here from 0097, whose hoist made it
  callable on every family while nothing read the flag. A smell detector that declares empty over a
  zero-subject corpus passes; one that declares empty and then examines something fails. And
  `CorrespondenceBuilder.declaresEmpty()` is overridden per side, so a rule whose every side is declared does
  **not** red at the floor asking the author to declare — ADR-008 rule 2's loop, which the base
  implementation would produce because that class refuses the whole-rule form. (0096 guards this for
  `diagnose()`; this row is the `check()` half, and they must agree.)
- **Per family, the triple-route shape**: the zero-units finding asserted through `violations()` **and**
  `check()` **and** `.warn()`, with `bypassFilters` read off the `violations()` result. That is the row that
  catches the two non-equivalent mis-wirings — the floor inside one terminal only, or the finding shipping
  without the flag. (Below-filter placement is an **equivalence**, recorded so nobody invents a guard for it:
  every drop channel refuses `bypassFilters`.)
- **Precedence**: empty project + `.expectEmpty()` → still the empty-project finding; empty project +
  `.notExist()` → same; loaded project + `.notExist()` + zero matches → passes.
- **Expiry**: exactly one finding, and applying the stated remedy clears it.
- **Remedy-remediates per cause**, including the preset-context row; negative assertion that the
  empty-project message never names `.expectEmpty()`.
- **`diagnose()` and `check()` agree.** Every input class the preview reports must now also fail, and every
  input the preview stays silent on must still pass. This is the row that keeps 0096's surface honest: it was
  shipped saying "a later release makes this state fail at check time", and this is that release.
- **Tripwire regression**: a condition-glob tripwire iterating N subjects and matching none still passes —
  0.34.0's carve-out asserted across the flip.
- **Sabotage at top-row depth**, verdicts **per test**: the floor and expiry branches are two rows each,
  patches asserted to apply **and to compile** (0096's matrix scored a false CAUGHT on a patch that did not
  parse), caught-by-nothing reported as a number, green baseline first, exclusive tree.

## Release

Ships with 0098 (and 0089's threading) as **one red event**, with a self-contained changelog — dependabot
users jump straight over the preview releases — carrying the full per-cause remedy table inline, every break
enumerated including the `.warn()` and precedence flips, and the terminal claim **scoped falsifiably**: _zero
examined units can no longer produce a pass, for any published check entry point that constructs a rule,
enforced by `tests/matrix/`_ — with ADR-009's three named residues and 0100's preset gap still open. A broad
"vacuous greens are over" gets falsified by the first residue and burns the trust it was spending; the
qualifier "that constructs a rule" is load-bearing and is there because 0098's amendment measured the
exception.

## Out of scope

The CLI beyond what the root conversion reaches (0095 measures it; a fix beyond that gets its own number).
Bug 0056's fail-open half. `defineCondition` internal vacuity. ADR-010's contract fixture. The preset seam —
[0100](./0100-a-preset-that-constructs-nothing.md).
