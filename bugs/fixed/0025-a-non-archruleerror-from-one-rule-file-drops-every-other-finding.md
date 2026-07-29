# Bug 0025: a non-`ArchRuleError` from one rule file drops every finding in the run

**Reported:** 2026-07-29
**Fixed:** 2026-07-29 (v0.24.0)
**Found in:** all versions through v0.23.0
**Severity:** High — one malformed rule silences every other rule in the same CLI run, and
the output is a raw Node stack trace with `node_modules` paths. It reds rather than greens,
so it is not false coverage; it is the worst-looking output the tool produces, and it makes
the other rules' findings invisible at the moment the user most needs them.

## Description

`runCheck` catches `ArchRuleError` only (`src/cli/commands/check.ts:41-50`). Any other error
escapes the per-file loop and terminates the process, so no report is written and
`errorCount` is never returned — every finding already collected is lost.

The reachable producer today is `CorrespondenceBuilder`'s arity check
(`src/builders/correspondence-builder.ts:220-224`), which throws `RangeError` when a
correspondence does not have exactly two sides. Plan 0070's assertion gate removed the
_other_ `RangeError` from that builder (missing assertion) by reporting it as a
configuration finding before `collectViolations()` runs — and the gate's own docstring
(`src/core/terminal-builder.ts:130-138`) cites this blast radius as one of the three
measured reasons for placing it first. The arity branch was deliberately left throwing,
because wrong arity is a different fault from a missing assertion and has a different
remedy. That decision is right; the CLI's reaction to it is not.

Note the asymmetry it produces: a one-sided `correspondence()` with **no** assertion is a
clean configuration finding, and adding `.beComplete()` to it — which does not fix it —
turns that into a whole-run abort.

## Reproduction

Two rule files, measured at v0.23.0 by both the architect and customer reviews of that
release, independently:

```
file A: correspondence(p).side('a', <selection>, keyFn).beComplete()   // one side + assertion
file B: functions(p).that().haveNameMatching(/^parse/).should().notExist()   // 4 real findings

runCheck([A, B])
  -> RangeError: correspondence() requires exactly two .side(...) calls; got 1.
  -> raw stack trace including node_modules paths
  -> B's 4 findings never collected, writeReport never called, errorCount never returned
```

## Why no test caught it

The CLI tests exercise rule files that either succeed or throw `ArchRuleError`. No fixture
throws anything else, so "the loop survives a rule file that fails unexpectedly" was never
a claim any test could falsify. Ask ADR-008's question — _what would these tests do if the
catch clause were deleted entirely?_ — and the answer is: pass.

## Suggested fix

Fix the fault class, not the one producer: catch **per rule file** in `runCheck` (and its
`runBaseline` twin), convert a non-`ArchRuleError` into a `bypassFilters` configuration
finding carrying the error message, and continue with the remaining files. That is what
`runDoctor` already does for a file it cannot load (`src/cli/commands/doctor.ts:72-77`) —
one mechanism, two call sites, and it covers every future builder that throws for its own
reasons rather than only `correspondence()`.

The finding must name the rule file, because a stack trace is the only thing that currently
does.

## Guard this needs

- A fixture rule file that throws a non-`ArchRuleError`, run alongside a file with real
  violations: the second file's findings still reach the report, and the exit code is
  non-zero.
- The thrown message appears in the finding, so nothing is swallowed.
- Sabotage in both directions: with the per-file catch removed it must fail, and with the
  throwing fixture made to throw `ArchRuleError` instead it must still pass — otherwise it
  is measuring the ordinary path, not the boundary.

## How it was fixed

Both halves, in v0.24.0:

**The fault class, at the CLI boundary.** `runCheck` and `runBaseline` now catch at the **two**
boundaries that can fail independently — loading (per file, the only attribution available) and
evaluating (per builder, so one malformed rule does not take its siblings in the same file down
with it). A non-`ArchRuleError` becomes one configuration finding naming the rule file, via a
single `failureOrViolations` shared by both commands; the two had a copy each of the
`ArchRuleError` half and had already diverged on everything else.

**The known producer, at its source.** `CorrespondenceBuilder.assertsSomething()` now returns
`false` for the wrong number of sides regardless of which assertion was chosen. `.beComplete()`
on a one-sided correspondence cannot assert anything — there is no second side to compare
against — so the arity fault reports identically whether or not an assertion is present, through
the assertion gate, with the remedy `assertionAdvice()` already had for it (another `.side(...)`,
never `.beComplete()`). The `RangeError` stays on `collectViolations()` as the invariant it
always was, unreachable through every terminal.

Measured end to end on the real CLI: two rule files, the first a one-sided `correspondence()`
with `.beComplete()`, the second with four real violations. Before, a raw `RangeError` stack
trace and zero findings. After, five findings and exit 1.

## Found while fixing it

Three defects the fix walked into, each measured on the real CLI rather than reasoned about:

- **The rich terminal formatter never printed a located violation's `message`** — for _every_
  ordinary violation, not just this finding. The location slot rendered `file:line — element`
  and the message was rendered nowhere, while `formatViolationsPlain` had always printed it, so
  the two formatters disagreed about what a violation is. Nothing failed when it was fixed,
  because nothing pinned it either way.
- **`--format github` doubled the period** between a message ending in punctuation and its
  `Fix:` clause. Pre-existing, and invisible until a producer wrote a well-punctuated message.
- **The finding named its own path four times** — in `rule`, `element`, the location line and
  the remedy — and the location line runs it through `path.relative(cwd, …)`, so a rule file
  outside the cwd printed as `../../../../../../private/tmp/…`.
