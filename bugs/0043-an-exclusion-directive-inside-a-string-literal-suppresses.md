# Bug 0043: an exclusion directive inside a string literal suppresses a finding

**Reported:** 2026-08-01 · **Found in:** v0.36.3, by the devops review of the 0041/0042 branch
**Severity:** High. A **silent** suppression with no warning of any kind, triggered by text that
is not a comment at all. Pre-existing, but bug 0041 widened it from one condition family to
every one.

## Description

`parseExclusionComments` (`src/core/exclusion-comments.ts:194-223`) splits the source on `\n`
and regexes each line. It has **no comment-token awareness**, so a directive inside a string
literal, a template literal, or any other non-comment context is parsed as a live exclusion.

Measured — three offending files, one dependency rule, before and after the 0041 fix:

```
main:   surviving: in-a-string.ts, plain.ts, undocumented.ts   → exit 3
branch: surviving: plain.ts                                    → exit 1
```

`in-a-string.ts` carries the directive inside a double-quoted string. It **has** a reason, so
the undocumented-exclusion warning never fires, and it silently killed a real dependency
finding. No output at all.

## Why it matters more than it looks

The text has to appear in a file that also produces a violation for the same rule id, which
sounds rare. It is not rare in the population that matters:

- a project's own tests and fixtures for this library;
- documentation examples embedded in `.ts` files as template literals;
- any code that generates or lints exclusion comments.

And the failure is total: the finding disappears, the exit code drops, and nothing is printed.
Compare `.excluding()`, which warns when a pattern matches nothing — this warns when the
directive _works_, and only if it lacks a reason.

## Fix

ts-morph already holds the file in the `Project`, so real comment ranges are available:
`sourceFile.getDescendantsOfKind(SyntaxKind.SingleLineCommentTrivia)` and the block equivalent,
or `forEachComment`. Match directives only inside those ranges.

Two things to settle:

1. **The parser currently takes `sourceText: string`** and is a public export
   (`src/index.ts`), so a signature change is breaking. It can keep the string form and gain an
   optional `SourceFile` overload, with the string form documented as best-effort.
2. **`execute-rule.ts` reads the file with `fs.readFileSync`** rather than going through the
   project. Using the ts-morph copy is the same fix as (1) and removes a second read.

## Guard

Behavioural, over a fixture whose rule genuinely fires (the vacuity control):

- directive in a **real comment** → suppressed (the control; must not regress);
- directive inside a **double-quoted string** → not suppressed;
- inside a **template literal** → not suppressed;
- inside a **block comment** → suppressed, since that is a comment;
- a directive in a string on the line above a violation, with a reason, so the undocumented
  path cannot mask the result.

## Related

- [Bug 0041](./fixed/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md) — widened this
  from `createViolation` conditions to all of them.
- [Bug 0044](./0044-an-inline-exclusion-comment-has-no-feedback-channel.md) — the other half:
  nothing tells you when a comment matched nothing.
- [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 1, and rule 3's corollary on markers.
