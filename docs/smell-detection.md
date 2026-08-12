# Smell Detection

::: tip Rule file or test file?
Snippets on this page end in `.check()` (the **test-file** form). In a [CLI rule file](/cli) (`arch.rules.ts`), **drop `.check()`** and spread the bare builder into `export default [...]` — a `.check()` inside a rule-file array is [silently skipped](/running-in-tests#converting-between-the-two-forms). Use `.asSeverity('warn')` for warnings.
:::

The `smells` entry point detects code smells -- patterns that are not necessarily wrong but indicate potential design problems.

There is **no default severity**: like every other builder, a smell does nothing until you call a terminal. `.warn()` reports without failing, `.check()` fails. The examples here use `.check()` unless they are making a point about severity. If your consumer is an AI agent, prefer `.check()` — the CLI derives its exit code from error-severity findings only, so a warning is invisible to a loop that stops at `exit 0` ([ADR-008](https://github.com/NielsPeter/ts-archunit/blob/main/adr/008-agent-first-failure-surfaces.md)).

## What Smells Are

Smells are not bugs. They flag structural patterns that tend to cause problems over time:

- **Duplicate bodies** -- copy-pasted functions that diverge and become maintenance traps
- **Inconsistent siblings** -- files in the same folder that should follow the same pattern but don't

Smell detectors do not use the `.that().should()` chain grammar. Instead, they have their own configuration API and terminate with `.warn()` (advisory) or `.check()` (hard failure).

## `smells.duplicateBodies()`

Detects functions with structurally similar bodies using AST fingerprinting. Two functions are flagged when their AST similarity exceeds a threshold (default: 85%).

```typescript
import { project, smells } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

smells
  .duplicateBodies(p)
  .inFolder('**/services/**')
  .minLines(10)
  .ignoreTests()
  .because('copy-pasted service methods diverge over time')
  .warn()
```

### Configuration

Each detection run can be scoped, tuned, and filtered using these chainable methods. Start broad and tighten thresholds as you reduce duplicates.

| Method                  | Default   | Description                                                               |
| ----------------------- | --------- | ------------------------------------------------------------------------- |
| `inFolder(glob)`        | all files | Scope detection to files matching the glob. Can be called multiple times. |
| `minLines(n)`           | `5`       | Ignore functions shorter than N lines.                                    |
| `ignoreTests()`         | `false`   | Exclude test files (`*.test.ts`, `*.spec.ts`, `__tests__/**`).            |
| `ignorePaths(...globs)` | `[]`      | Exclude files matching the given glob patterns.                           |
| `withMinSimilarity(n)`  | `0.85`    | AST similarity threshold (0--1). Lower values catch more pairs.           |
| `groupByFolder()`       | `false`   | Group violation output by directory.                                      |
| `because(reason)`       | --        | Explain why this smell check exists.                                      |

### Terminal Methods

Terminal methods end the builder chain and execute the smell detection. Choose `.warn()` for advisory feedback during adoption or `.check()` when you want CI to block on smell violations.

| Method     | Description                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.warn()`  | Log violations to stderr without throwing, with one exception ([configuration findings](/violation-reporting#the-one-thing-warn-cannot-silence)). |
| `.check()` | Throw `ArchRuleError` if any violations are found.                                                                                                |

Both accept an optional `{ format: 'terminal' | 'json' | 'github' }` parameter.

## AST Fingerprinting

Understanding how fingerprinting works helps you tune similarity thresholds and predict what will (and won't) be caught. This section explains the internals so you can set expectations correctly.

Duplicate detection works by comparing structural fingerprints, not raw text. Two functions with different variable names, string literals, and formatting can still be flagged as duplicates if their AST shapes are similar.

A fingerprint captures:

- **Node kinds** -- the ordered sequence of `SyntaxKind` values in the body (e.g., `IfStatement`, `CallExpression`, `ReturnStatement`)
- **Call targets** -- normalized call expression targets (e.g., `parseInt`, `this.extractCount`)
- **Node count** -- total AST nodes, used for filtering

Similarity is computed using the longest common subsequence (LCS) of the kinds arrays, normalized to `[0, 1]`:

```
similarity = LCS(a.kinds, b.kinds) / max(a.kinds.length, b.kinds.length)
```

This means:

- Renaming variables does not affect similarity
- Changing string literals does not affect similarity
- Adding or removing statements reduces similarity
- Reordering statements reduces similarity

## `smells.inconsistentSiblings()`

Use this detector when your codebase has folder-level conventions (e.g., all repositories call `this.validate()`, all handlers call `handleError()`) and you want to catch files that missed the memo. It works by majority rule: if most files in a folder follow a pattern, the outliers are flagged.

Detects files in the same folder where a majority follow a pattern but some don't. This catches files that forgot to adopt a convention that most siblings already follow.

```typescript
import { smells, call } from '@nielspeter/ts-archunit'

smells
  .inconsistentSiblings(p)
  .inFolder('**/repositories/**')
  .forPattern(call('this.validate'))
  .because('all repositories should call this.validate()')
  .warn()
```

### How It Works

1. Groups source files by parent folder
2. For each folder with 2+ files, checks which files contain the pattern
3. If 60% or more of files match the pattern, flags the non-matching files

### Configuration

All base configuration methods from `SmellBuilder` apply (`inFolder`, `minLines`, `ignoreTests`, `ignorePaths`, `groupByFolder`, `because`). In addition:

| Method                | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `forPattern(matcher)` | The `ExpressionMatcher` that siblings should follow. Required. |

The `matcher` parameter accepts any expression matcher -- `call()`, `newExpr()`, `access()`, or `expression()`.

### Inert Detection

`inconsistentSiblings()` reports a minority diverging from an already-formed 60% majority — so a rule can examine a real, non-empty corpus and still be structurally unable to ever produce a finding, if no folder's matching files are within one edit of that majority. `.inertAdvice()` names that state before you find out the hard way:

```typescript
const rule = smells
  .inconsistentSiblings(p)
  .inFolder('**/handlers/**')
  .forPattern(call('handleError'))

rule.inertAdvice()
// 'This detector examined 5 sibling files, but only 1 of them hold the pattern
//  'handleError', and no folder is within an edit of a majority — so as written
//  it cannot produce a finding today. ...'
```

It returns `''` — nothing to report — once a folder has a real majority, or is one edit away from forming one; and it also returns `''` when the pattern matches nothing at all, since that is a dead pattern, not majority arithmetic. `diagnose()` (and `ts-archunit doctor`) surface the same text, so you see it before `check()` ever runs. Today this is preview-only: `check()` still passes on an inert rule. The message gives three ways out, in order:

- **Still adopting the convention?** Swap for `correspondence().side(...).beComplete()` — it asserts the convention directly and fails the day a file falls short, rather than waiting for a majority to exist.
- **Wrong scope?** Widen `.inFolder(...)` so a real majority can form.
- **Wrong pattern?** Point `forPattern()` at a pattern the siblings already share.

## Real-World Examples

### Detecting Copy-Pasted Parsers

```typescript
smells
  .duplicateBodies(p)
  .inFolder('**/parsers/**')
  .minLines(8)
  .withMinSimilarity(0.8)
  .ignoreTests()
  .groupByFolder()
  .because('copy-pasted parsers should be consolidated into a shared utility')
  .warn()
```

### Enforcing Consistent Error Handling

```typescript
smells
  .inconsistentSiblings(p)
  .inFolder('**/handlers/**')
  .forPattern(call('handleError'))
  .because('all request handlers should use the shared error handler')
  .warn()
```

### Catching Duplicate Service Methods Across Features

```typescript
smells
  .duplicateBodies(p)
  .inFolder('**/features/**/services/**')
  .minLines(15)
  .withMinSimilarity(0.9)
  .ignorePaths('**/shared/**')
  .because('similar service methods across features should be extracted to shared/')
  .warn()
```

### Consistent Validation in Repositories

```typescript
smells
  .inconsistentSiblings(p)
  .inFolder('**/repositories/**')
  .forPattern(call('this.validate'))
  .minLines(5)
  .ignoreTests()
  .because('repositories should validate inputs before database operations')
  .warn()
```

## Tips

- **Choose the terminal deliberately** -- `.warn()` while you triage a large backlog, `.check()` once you are ready to hold the line. Neither is a default. A smell registered through a preset is promoted the same way as any other rule: `overrides: { 'preset/agent/no-copy-paste': 'error' }`.
- **Adopt a large backlog with a baseline, not a warning** -- `withBaseline()` accepts today's findings and fails on new ones, which keeps the signal at error severity where an agent will see it.
- **Start with high similarity** -- `withMinSimilarity(0.9)` avoids false positives. Lower gradually as you clean up duplicates.
- **Combine with `ignorePaths()`** -- exclude generated files, migration scripts, or intentionally duplicated code.
- **Use `groupByFolder()`** -- makes violation output easier to triage by grouping related findings together.
