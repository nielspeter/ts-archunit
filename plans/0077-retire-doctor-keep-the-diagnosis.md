# Plan 0077 — Retire `doctor`, keep the diagnosis

**Status:** PROPOSED. This is a **decision plan**: the mechanism is small and the question is
whether to do it at all. It settles an open question that
[plan 0069](./completed/0069-no-rule-may-certify-nothing.md) required be answered **before R3**
and that has now been deferred across five sessions.
**Priority:** High as a decision, Low as work. It blocks
[plan 0074](./0074-r3b-the-selector-glob-flip.md), and 0069 named the drift mechanism precisely:
_"shipping it experimental/hidden is precisely the mechanism that defers the decision."_
**Effort:** ~half a day across two releases, most of it documentation.
**Breaking:** yes, eventually — a CLI command is removed. Sequenced so the removal lands one
minor after the deprecation.

## The question 0069 left open

> **`doctor`'s life after R3** — keep as a supported command, or retire it? Decided **before R3**,
> not before R2a.

`doctor` ships hidden from `HELP_TEXT` and is documented in seven pages. That is neither hidden
nor supported, and it is the state 0069 predicted would persist.

## What `doctor` is, measured

`src/cli/commands/doctor.ts`, 164 lines, and every finding it reports comes from `diagnose()`
(`src/core/diagnose.ts`), which is a **public export** (`src/index.ts:64`). The command adds four
things and no analysis:

| adds                              | also available as                            |
| --------------------------------- | -------------------------------------------- |
| per-file attribution (`ruleFile`) | the caller knows which file it passed        |
| load-failure reporting            | only meaningful because it loads (see below) |
| terminal / JSON formatting        | the caller's own                             |
| non-zero exit on findings         | the caller's own                             |

The three finding kinds — `dead-glob`, `no-condition`, `project-unknown` — are `diagnose()`'s.

## The deciding fact: it cannot load the shape the docs lead with

`doctor` must `import()` the rule file. A file that imports vitest cannot be imported outside
vitest. So for the authoring shape CLAUDE.md calls primary — _"Rules run in vitest/jest"_, and all
of `docs/running-in-tests.md` — the command cannot see the rules at all, and **its own error
message says to use the other path**:

> `If this file imports a test runner (vitest/jest), doctor cannot load it — run your test suite
instead; the runtime writes the same diagnostics to stderr.`

This is not a defect to fix. It is what importing a test file means.

**The sharpest evidence is this repository.** Plan 0074's gate — run `doctor` over an adopting
codebase and classify its findings — is blocked because ts-archunit cannot run `doctor` on its
own rules: 43 rules inside `it()` callbacks, zero exported builders. The tool's own project sits
in the population the tool cannot serve, and that is what has kept 0074 from starting.

## Decision: retire the command, keep the capability

`diagnose()` already is the diagnosis, it is public, and it runs where the rules actually live.
`docs/running-in-tests.md` teaches the pre-flight today:

```ts
it('every architecture rule asserts something', () => {
  expect(diagnose(rules)).toEqual([])
})
```

Three reasons beyond the loading problem:

1. **The inconsistency is itself the bug.** Hidden from `HELP_TEXT`, present in seven doc pages.
   A reader finds it in the docs and cannot find it in `--help`.
2. **1.0 is the wrong moment to inherit it.** Promoting it means documenting a command half the
   audience structurally cannot use; keeping it hidden past 1.0 makes removal breaking later
   rather than now, which is 0069's own argument for deciding early.
3. **It unblocks 0074.** Restating that gate as _"run `diagnose()` in the adopter's test suite"_
   makes it runnable immediately, including here.

### What is genuinely lost, stated

A CLI-only adopter — the `arch.rules.ts` shape `init` scaffolds — loses a one-command pre-flight
and gets a small test instead. For them `check` has reported configuration findings at **error**
severity since 0.23.0, so R3b's flip is visible without `doctor`; what they lose is seeing it
_before_ it fails, in one command. That is a real cost and this plan does not pretend otherwise.

**If that cost is judged too high, the alternative is to promote rather than retire** — document
`doctor` in `HELP_TEXT`, and state in `docs/cli.md` that it serves the `arch.rules.ts` shape only.
That is a coherent answer too. What is not coherent is the present state, and either answer
unblocks 0074.

## Phases

### Phase 1 — deprecate (one minor)

`runDoctor` gains `@deprecated` naming its replacement, and the command prints a notice before
running. The command keeps working.

```ts
// src/cli/commands/doctor.ts
/**
 * @deprecated Use `diagnose(rules)` from the package instead — it runs where your
 * rules live, including in vitest, which this command cannot load. Removed in the
 * release after next; see plan 0077.
 */
export async function runDoctor(args: DoctorArgs): Promise<number> {
  writeStderr(
    `[ts-archunit] \`doctor\` is deprecated and will be removed. Use \`diagnose(rules)\` ` +
      `in your test suite — it reports the same findings and works with rule files that ` +
      `import vitest, which \`doctor\` cannot load. See docs/running-in-tests.\n`,
  )
  // …unchanged
}
```

`tests/docs/deprecated-symbols.ts` already derives `@deprecated` symbols from source rather than
from a hand-kept list, so the docs scan picks this up with no new machinery — that is the
precedent this phase follows rather than inventing a second one.

**Files:** `src/cli/commands/doctor.ts`; `docs/cli.md`, `docs/troubleshooting.md`,
`docs/api-reference.md` (7 mentions), `docs/custom-rules.md` (4) — each mention gains the
replacement; `CHANGELOG.md`; `docs/upgrading.md` row.

### Phase 2 — remove (the next minor)

Delete the command, its dispatch arm, and `tests/cli/doctor.test.ts` (14 tests). `diagnose()`,
`DiagnosticFinding` and `DiagnosableRule` are untouched — they are the capability.

**Files:** delete `src/cli/commands/doctor.ts` and `tests/cli/doctor.test.ts`; `src/cli/index.ts`;
the seven doc pages; `CHANGELOG.md`; `docs/upgrading.md` row.

### Phase 3 — restate 0074's gate

0074 currently reads: _"a real project with ts-archunit rules in a **loadable** `arch.rules.ts` —
not a vitest test file, because `doctor` cannot load one that imports a test runner."_ That
constraint exists only because the gate was written around `doctor`. Restated against
`diagnose()`, the gate is: **collect the adopter's rules in their own suite, call `diagnose()`,
classify each finding against the registered decision rule.** No loadable rule file required.

**Files:** `plans/0074-r3b-the-selector-glob-flip.md`.

## Test inventory

| test                                           | asserts                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `the deprecation notice names the replacement` | phase 1: the notice says `diagnose`, and why (`doctor` cannot load vitest) |
| `the deprecated command still works`           | phase 1 deprecates, it does not break — the 14 existing tests stay green   |
| `diagnose() reports what doctor reported`      | the capability survives: same three kinds over the same rules              |
| `the command is gone and the dispatch says so` | phase 2: an unknown-command error, not a crash                             |
| `diagnose is still exported`                   | phase 2 removed the wrapper, not the diagnosis                             |

## Guards

Ask ADR-008's question: **what would these tests do if the capability were removed along with the
command?** The first four would pass — they are about the command. So `diagnose() reports what
doctor reported` is the load-bearing one, and it must compare **findings**, not counts: the same
rule set through both paths in phase 1, and against phase 1's recorded output in phase 2.

Sabotage, from the diff: delete the notice (the naming test reds); delete the `@deprecated` tag
(the docs scan reds); in phase 2, delete `diagnose`'s export alongside the command (the capability
test reds).

## Out of scope

- **Changing `diagnose()`.** It is the thing being kept. Its documented promise to report
  _"without running any of them"_ is unaffected.
- **0074's decision table**, which is settled and not reopened here.
- **Whether R3b ships at all.** This removes a blocker; it does not decide the flip.
