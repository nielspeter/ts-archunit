# Bug 0026: a location-less finding does not say which rule file it came from

**Reported:** 2026-07-29
**Found in:** all versions through v0.23.0
**Severity:** Medium — the finding is correct and actionable in kind, but not locatable. Two
identical vacuous rules in two different files render as two identical paragraphs with
nothing distinguishing them, so the reader greps prose to find the line to edit. v0.23.0
made this the failure a whole population of adopters meets first.

## Description

A configuration finding has no source position — `file: ''`, `line: 0` — because it reports
a fault in the rule, not in the code. The formatters handle that deliberately: the rich
terminal format prints the message in the location's slot
(`src/core/format.ts:31-38`) and `--format github` emits a run-level annotation
(`src/core/format-github.ts:46-48`). What none of them can supply is **which rule file the
rule was written in**, because the violation never carried it.

In the test form this does not bite: vitest reports the frame that built the rule, so the
developer gets file, line and a code frame for free. It bites in the CLI form — the one
`docs/cli.md` calls the golden-path default — and in `doctor`.

`docs/cli.md` claims `doctor` "reports **identities**, never totals — which glob, in which
rule, at which position." That is true for `dead-glob` findings, which carry a glob position
(plan 0067's `GlobNode`), and false for `no-condition` findings, whose only identity is the
rule's description or its optional `.rule({ id })`.

## Reproduction

Measured at v0.23.0 during the customer review, with two rule files each containing the same
vacuous rule:

```
Architecture Violation [1 of 2]
  Rule: that have name ending with "Repository"
  this rule reached .should() but no condition follows...

Architecture Violation [2 of 2]
  Rule: that have name ending with "Repository"
  this rule reached .should() but no condition follows...
```

Neither says which file to open. With rule ids set (`.rule({ id })`) the two are
distinguishable — but ids are optional and most rules do not carry one.

## Suggested fix

The attribution already exists at the call site and is thrown away: `runCheck` loops per
rule file and knows the path (`src/cli/commands/check.ts:35-40`), as does `runDoctor`. Stamp
that path onto findings that have no location of their own, at that boundary — not in the
builders, which do not know it and should not.

Decide two things explicitly rather than discovering them in review:

- **The renderers branch on `v.file === ''`** to produce their location-less forms. Filling
  `file` in changes the rich format's location slot, the GitHub annotation from run-level to
  file-level, and `formatViolationsPlain`'s `(:0)` suffix. Either give the finding a
  separate field for provenance, or update all three renderers together and re-measure each.
- **`line: 0`** is not a real line. If `file` is filled, either find the rule's line (the
  glob machinery already carries positions for a related case) or keep the location-less
  rendering and print the file as provenance rather than as a position.

## Guard this needs

- Two rule files each containing the same vacuous rule: the two findings are distinguishable
  by file, asserted on the rendered output rather than on the field.
- The three renderers each still produce a valid form for a finding with no line — in
  particular `--format github`, where an invalid `line=` silently drops the annotation
  (the defect fixed in v0.22.0).
- `doctor`'s claim in `docs/cli.md` becomes true for `no-condition`, or the claim is
  narrowed to the finding kinds that can honour it.
