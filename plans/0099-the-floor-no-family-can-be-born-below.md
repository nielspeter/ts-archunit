# Plan 0099 — the floor no family can be born below

**Status:** Open, not started. Filed 2026-08-08, split out of [0098](./completed/0098-the-evidence-seam-and-the-floor.md)
when that plan's own amendment measured it as two plans wearing one number.
**Depends on:** [0098](./completed/0098-the-evidence-seam-and-the-floor.md) (the floor reads `CollectResult.examined`,
which does not exist until the seam lands), [0097](./completed/0097-the-declared-empty-grammar.md) (the floor
reads the mint it lifts), [0089](./completed/0089-presets-forward-their-options.md) — and the reason is
sharper than "a preset user cannot write `.expectEmpty()`". They **can** reach a remedy today:
`overrides: { '<id>': 'off' }`, documented. It is the **wrong** remedy — permanent, non-expiring, the
`allowEmpty` shape ADR-009 rejects and 0097 spent a release converting away from. Shipping the floor
without the carrier trains every preset user to write the permanent silencer, which is worse than
today's vacuous pass because it looks intentional and nothing ever revisits it: ADR-008 rule 1's
trained-suppression dynamic, manufactured by our own gate.
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

**Enumerate the two breaks review found, because neither is obvious from the diff:**

- **`'warn'` stops meaning "never fails the build".** `bypassFilters` forces `error`
  (`execute-rule.ts`), and four shipped preset rules default to `warn` — `preset/agent/no-copy-paste`,
  `preset/recommended/no-silent-catch`, `preset/recommended/no-empty-bodies`,
  `preset/boundaries/no-duplicate-bodies`. Any of them examining zero units now **hard-fails**, and
  `overrides: { '<id>': 'warn' }` cannot downgrade it. `docs/presets.md` states the contract as
  _"'warn' (reported but never fails)"_ — that sentence becomes false and is corrected in this PR.
- **`recommended` is the largest blast radius in the release.** It defaults `include: '**/src/**'` and
  builds 4 rules, so every project whose sources are not under `src/` has been running four rules that
  enforce nothing — and all four hard-fail at once. That is the correct outcome, but `docs/presets.md`
  currently tells adopters to absorb `recommended`'s findings with `--baseline`, and configuration
  findings **bypass baselines**. Name the concrete remedy (`include:`) in the changelog and fix that
  paragraph's scope.

**Lead the changelog with the pre-upgrade preview, the way 0.34.0 did.** `docs/upgrading.md`'s 0.34.0
entry — the closest precedent for this exact break — opens with _"Run `ts-archunit doctor` on 0.33.x
first, and fix what it reports before you upgrade."_ 0096 shipped precisely that preview. The inventory
row "`diagnose()` and `check()` agree" is what makes the preview **complete** rather than hopeful, so
say that out loud rather than leaving the reader to trust it.

**Four defects in the current advice string, from a user-perspective review of 0098** — this plan owns
the remedy text, so they are fixed here rather than in the seam PR:

- **It hedges where the tool holds the fact.** "including any default it applies that you did not write"
  is printed as a hypothetical when the rule is known: it can say whether `minLines(5)` is in play, and
  it materialized the selection, so it knows the project loaded N files and the selection produced 0.
  Print the numbers, not the possibility. This is the largest available improvement and it needs no new
  machinery.
- **"can never fail" overstates.** For a `crossLayer` rule whose pairs do not exist yet, or a folder
  empty in a young repository, the rule is correct and simply matches nothing **today**. Telling that
  reader their rule is broken is false, and "never" is the word doing it.
- **The ranking is wrong for greenfield adopters, and 0098 widened exactly their case.** The advice says
  widening is the fix and declaring is the exception. For a team whose second layer is not built yet,
  widening is _impossible_ — the code does not exist — so the only available action is the branch the
  message calls an exception and says "proves nothing", and `doctor` exits 1 either way. These are the
  people most likely to adopt an architecture tool early, and they meet this on day one. Either soften
  the ranking for the relational families, or accept that `.expectEmpty()` is the ordinary answer for a
  not-yet-populated layer and stop calling it an exception.
- **One paragraph per finding does not scale.** ~70 words repeated across a dozen findings is a wall.
  Split it: a short per-finding form carrying the facts, and the shared explanation printed **once** at
  the end of the run. The per-family spelling from `emptyDeclarationAdvice()` still substitutes into the
  per-finding form.

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

**Repair the expiry gate in the same commit — it is the check this plan would otherwise break.**
`vacuity-matrix.test.ts` counts only `'fail-open'` cells:

```ts
const open = Object.values(KNOWN_FAIL_OPEN).filter((v) => v === 'fail-open').length
if (open > 0 && past(current, EXPIRES_AT_VERSION)) { throw … }
```

This plan converts all four `'fail-open'` cells to `'config-finding'`, so `open` becomes **0** and the
deadline can never fire again at any version — while the entry that remains (`dataLayerIsolation:
'no-checks'`) is the one thing still genuinely vacuous. **This plan would introduce a check that cannot
fail, into the file whose purpose is finding checks that cannot fail.** Count `'no-checks'` as well, or
delete `EXPIRES_AT_VERSION` rather than keep it decoratively — but decide, because the sentence below
used to assert the deadline survived.

Two further silent failures in the same gate, both measured, both fixed here because this is the commit
that touches it:

- **`past()` is a lexicographic compare.** It re-joins to a string after `map(Number)`, so
  `past('0.100.0', '0.62.0')` is **false** — measured. At this repo's cadence (0.22 → 0.58 across this
  programme) `0.100.0` is reachable, and the failure mode is a deadline that quietly stops existing.
- **The version input fails open.** `process.env.npm_package_version ?? '0.0.0'` — the fallback is never
  past any deadline, and `npm_package_*` under `npm exec` is not a documented contract.
  `tests/matrix/enumerate.ts` already reads `package.json` from disk; read it the same way, or assert
  the variable was present.

**Shrink `KNOWN_FAIL_OPEN` to one entry** in the same commit as the floor — `duplicateBodies`,
`inconsistentSiblings`, `agentGuardrails`, `strictBoundaries` all become `config-finding`. It cannot be
emptied: `dataLayerIsolation` constructs zero rules and no per-rule floor reaches it — and 0100's
measurement found `agentGuardrails` silent at its minimal call too, which the matrix's own recipe hid
([0100](./0100-a-preset-that-constructs-nothing.md)). The matrix's `EXPIRES_AT_VERSION` stays, and the
remaining entry carries a `// 0100` citation so the list names its own reason rather than looking stalled.

**Measure this repo's own 53-rule dogfood suite BEFORE the flip.** `tests/archunit/arch-rules.test.ts`
is gated by `expect(diagnose(BUILT)).toEqual([])`, and that gate is **not** evidence those rules survive
this plan: every rule in it is the `RuleBuilder` family, which has no `examinedUnits()` until 0098. So
`diagnose()` is silent today about a self-rule that narrows to zero subjects, and after this plan such a
rule reds our own CI in the same PR as the flip. The measurement is free during 0098 — dump `examined`
for all `BUILT` rules and record which are zero — and converts this plan's own-CI blast radius from
unknown into a list. **0098 carries the measurement; this plan carries the fixes.**

**Release-train constraints, none of which any automation enforces:**

- **Do not tag between 0098's merge and this one.** An intermediate tag ships a foreign-dialect compile
  break with zero behaviour change, and every check would pass it.
- **Every `docs/**`change lands in the LAST PR before the tag.**`docs.yml`deploys on push to`main`touching`docs/\*\*`, not on tag. Its comment block accepted that skew deliberately — but it reasoned
about a 32-minute window on release day, and this train is several PRs plus 0089. A reader who lands
on the new `upgrading.md`and writes`.expectEmpty()` against the published 0.58.0 gets a silent
  no-op, which is exactly the harm that comment names.
- **One `## [Unreleased]` heading across the train,** renamed once at tag time. `publish.yml`'s
  extractor takes the single section matching the tag; two version headings across two PRs would
  silently drop half the release notes.
- **No global opt-out, and that is a decision rather than an omission.** An env-var escape hatch is the
  conventional move for a break this size and would be wrong here — ADR-008 rule 3's corollary, a marker
  an agent can stamp to go green. Per-rule hatches exist and 0089 is a hard dependency so preset users
  can reach them. Recorded so the next reviewer does not raise it.

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

**Write the carve-out in the reader's terms, not ours.** "any published check entry point that constructs
a rule" is accurate and incomprehensible — a user cannot tell whether their entry point constructs one.
Naming the two calls is what turns a qualifier into a disclosure:

> Every rule that runs and examines nothing now fails. **Not yet covered:** a preset call that constructs
> no rules at all — `agentGuardrails(p, { src })` and `dataLayerIsolation(p, { repositories })` with no
> flags enabled produce an empty array and nothing to check. Enable at least one flag. Tracked in 0100.

## Added 2026-08-08 — what 0089's review left on this plan's doorstep

Three items from the five-persona review of [0089](./completed/0089-presets-forward-their-options.md).
The first is a design correction to something 0089 shipped, and it should be settled **here** rather
than filed as a defect, because it is a decision about where knowledge lives.

**1. The preset-shaped remedy currently branches on a string prefix, in core.** 0089 made
`TerminalBuilder.emptyDeclarationAdvice()` return `expectEmpty: ['<id>'] in this preset's options` when
`this._metadata?.id` starts with `preset/`, so a preset user is no longer told to call `.expectEmpty()`,
which they cannot reach. The outcome is right and this plan depends on it — 0099 line 125 already
commits to "when the rule id begins `preset/`, the remedy is preset-shaped".

The mechanism is not. **Core cannot verify what that sentence asserts.** It is false for a third-party
preset built on `RuleBuilder` that never extended `PresetBaseOptions`, false for a hand-written
`.rule({ id: 'preset/…' })`, and false for a preset that forwards `overrides` but not `expectEmpty`. The
method exists precisely to stop advice naming a call the reader cannot make — `CorrespondenceBuilder`
overrides it because the zero-arg form throws there — and deriving it from a **prefix** rather than from
the family that knows gives that discipline up. It is also an
[ADR-010](../adr/010-the-extension-surface-is-a-contract.md) rule 1 **semantics** change to a member the
contract names, shipped under `### Fixed`.

The fix belongs where the knowledge is: `declareEmptyIfListed` in `src/presets/shared.ts` is the single
site that knows both the id **and** that its caller is a preset accepting `expectEmpty`. Have the preset
supply the spelling — an optional `RuleMetadata` field, or a protected setter the carrier calls — and
leave `emptyDeclarationAdvice()` in core returning `.expectEmpty()`. Third-party presets then get it
right for free by using the same carrier, and core stops guessing. Doing it in this plan keeps the
ADR-010 note in the release that also carries the floor.

**2. The declaration is inert for the smell family, and `declaresEmpty()` still returns `true`** —
[bug 0073](../bugs/0073-a-declaration-binds-to-a-smell-rule-that-ignores-it.md). That matters here more
than anywhere: this plan's floor reads `declaresEmpty()` to stand down, so today the declaration's only
working effect on a smell rule is to suppress the floor that has not shipped yet. Either 0073 ships
first or this plan carries it; what must not happen is the floor arming while one family answers the
question it asks with a value nothing sets.

**3. Which release makes a declaration expire is currently unstated.** For `preset/recommended/*`,
`preset/data/*` and the function rules of `agentGuardrails`, a false declaration hard-fails **today**.
For `preset/layered/no-cycles`, `layer-order`, `preset/boundaries/no-cycles` and
`preset/agent/no-copy-paste` it asserts nothing until this plan lands. `docs/presets.md` says flatly
that a declaration "states a fact about today that a later release can hold you to" — true for some ids
and, right now, false for the one the docs use as their example. This plan is the release that makes the
sentence true; say so in the docs when it ships, and note the docs site deploys on merge rather than on
tag, so the claim goes live before the version does.

## Out of scope

The CLI beyond what the root conversion reaches (0095 measures it; a fix beyond that gets its own number).
Bug 0056's fail-open half. `defineCondition` internal vacuity. ADR-010's contract fixture. The preset seam —
[0100](./0100-a-preset-that-constructs-nothing.md).
