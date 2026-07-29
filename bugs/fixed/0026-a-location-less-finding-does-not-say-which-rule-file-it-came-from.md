# Bug 0026: a location-less finding does not say which rule file it came from

**Reported:** 2026-07-29
**Fixed:** 2026-07-29 (v0.24.0)
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

## How it was fixed

**v0.24.0.** `attributeToRuleFile` (`src/cli/rule-file-findings.ts`) stamps `file` and `line: 1`
onto findings that carry no location of their own, called from `runCheck` and `runBaseline` at the
point in the per-file loop where the mapping exists. A violation that already has a location is
left alone — overwriting the code it found with the rule file that declared the rule would be the
feature backwards.

`line: 1` follows `tsconfig()`'s precedent for a fault belonging to a file rather than to a
position in it. The builders genuinely cannot supply a line: a rule with no glob has no position
anywhere, and the assertion-gate findings are exactly the rules that may have none.

**`doctor`'s half needed a restructure.** It flattened every file's rules into one array and called
`diagnose()` once, discarding the mapping before it could be used. It now diagnoses per file and
stamps `ruleFile` on each finding — `diagnose()` treats rules independently, so the results are
identical. `DiagnosticFinding.ruleFile` is optional and `diagnose()` never sets it: it is handed
rules, not files, and inventing a path it cannot verify is the thing this library exists to stop.

`docs/cli.md`'s claim that `doctor` reports "which glob, in which rule, at which position" was
true of a dead glob and false of every `no-condition` finding. Corrected rather than left to be
rediscovered.

## Found while fixing it

- **The `ts-archunit-exclude` immunity had no test, and this change made it live.**
  `applyFilters` keeps comment exclusions from silencing a configuration finding via
  `v.bypassFilters === true || !isExcludedByComment(...)`, and its own comment named this exact
  change as "the temptation" — because until now these findings carried `file: ''`, so
  `readFileSync('')` threw and no comment could ever match. Now the rule file IS read and its
  comments ARE parsed. Guarded in `tests/helpers/exclusion-comments.test.ts`, with the ordinary
  violation asserted to be excluded in the same run — otherwise the guard would pass because the
  comment matched nothing.
- **Two source comments named a directive that does not exist** (`// arch-ignore`). The real
  spelling is `// ts-archunit-exclude`. My first version of the new guard used the invented one and
  its own control assertion caught it.
- **`runBaseline` printed refused findings without the file**, so attributing them there would have
  been invisible. The print now leads with the rule file.
- **The wiring was caught by nothing.** `attributeToRuleFile` was unit-tested and both commands'
  calls to it could be deleted with the suite still green — every assertion was made against the
  function rather than against the command that has to call it. Both are now pinned end to end.
