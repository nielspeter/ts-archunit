# Bug 0043: an exclusion directive inside a string literal suppresses a finding

**Reported:** 2026-08-01 · **Fixed:** 2026-08-01, unreleased
**Found in:** v0.36.3, by the devops review of the 0041/0042 branch
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

- [Bug 0041](./0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md) — widened this
  from `createViolation` conditions to all of them.
- [Bug 0044](./0044-an-inline-exclusion-comment-has-no-feedback-channel.md) — the other half:
  nothing tells you when a comment matched nothing.
- [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 1, and rule 3's corollary on markers.

## Fix as shipped

The parser now blanks everything that cannot contain a directive, then requires a directive to
**begin its comment**. Two faults, and the second only became visible by fixing the first.

### 1. Not a comment at all

Measured before: `"…"`, `'…'`, `` `…` ``, a regex literal and JSX text **all** produced a live
exclusion. The line scan could not tell code from string from comment.

The first attempt used `ts.createScanner` — the real lexer, so the three plain cases fell
immediately. It left two: `` `${x} // …` `` and JSX text. **A bare scanner has no parser
context**, so it cannot know when to re-scan a template middle or JSX children, and classified
both as code. Measured, not predicted.

So: parse, and blank the literals — everything remaining is code, where `//` genuinely opens a
comment. A **ts-morph** project per ADR-002, reused across calls so the cost is a parse rather
than a project construction, and the whole scan is already gated on the file having produced a
violation.

### 2. A comment _about_ the syntax is not the syntax

Once comments were read correctly, any comment mentioning a directive became one — and the first
casualty was **this parser's own grammar documentation**:

```ts
// Single-line without reason: // ts-archunit-exclude <rule-id>
```

That line declared a real, reason-less exclusion against whatever rule was being evaluated.
Caught by this repo's own preset fan-out test, which is the best argument available for
dogfooding. Every user documenting the feature in a code comment would have hit it.

Fixed two ways: block comments are blanked (the grammar is `//`-only and a `/* */` directive
never worked), and a directive must begin its comment. The caller slices each line from its
first `//` and the regexes anchor at `^`.

**The first version of that anchor broke the documented trailing form** — `^\s*//` requires only
whitespace before the comment, so `const a = 1 // <directive>` stopped matching. The guard's
trailing rows caught it. Slicing from the comment start is what actually expresses "begins the
comment".

## Guard

`tests/core/a-directive-must-be-a-comment.test.ts` — a 14-row table, every row measured before
and after, in both directions:

| Counts                          | Does not count                            |
| ------------------------------- | ----------------------------------------- |
| a line comment                  | inside `"…"`, `'…'`, `` `…` ``            |
| a **trailing** comment          | inside a template **with a substitution** |
| an indented comment             | inside a regex literal                    |
| the `-start`/`-end` block form  | inside JSX text                           |
| after a string on the same line | mid-comment prose                         |
|                                 | inside a block comment, and inside JSDoc  |

Plus a vacuity row asserting the table tests **both** directions — all-zero passes if the parser
never returns anything, which is the opposite of the pre-fix behaviour but just as useless — and
a row pinning that newlines survive the mask, since the scan is line-based.

## Sabotage — 8 rows, 6 caught, 2 green for stated reasons

| Revert                                  | Result    |
| --------------------------------------- | --------- |
| U1 — no masking at all                  | CAUGHT    |
| U2 — strings not blanked                | CAUGHT    |
| U3 — templates not blanked              | CAUGHT    |
| U4 — JSX text not blanked               | CAUGHT    |
| U5 — the regex unanchored again         | CAUGHT    |
| U6 — block comments kept                | CAUGHT    |
| U7 — blanks collapsed instead of spaced | **GREEN** |
| U8 — mask one character short           | **GREEN** |

U7 and U8 are honest residue, and they corrected an overclaim in the fix's own docstring, which
said "every offset and line number is unchanged". Only **line** numbers are load-bearing —
nothing downstream reads a column — so collapsing the blanks or leaving the closing quote
unmasked changes nothing observable. The comment now says that instead.

## What is not covered

A comment inside a template substitution — `` `${/* here */ x}` `` — is blanked with the rest of
the template, so a genuine directive there would be missed. It errs toward **not** suppressing,
which is the safe direction for a mechanism whose failure mode is a silent green.
