# Bug 0053: the stub rule matched prose _about_ stubs, including its own documentation

**Reported:** 2026-08-04 · **Fixed:** 2026-08-04 (v0.47.0)
**Found in:** every version since `STUB_PATTERNS` shipped — but **latent** until
[bug 0052](./0052-nostubcomments-cannot-see-a-functions-own-docstring.md)'s fix made the rule read
docstrings, where prose lives.
**Severity:** Medium. A false positive on a rule whose findings fail a build, in the surface most
likely to contain the words: documentation.

## What

`STUB_PATTERNS` was `/\b(TODO|FIXME|HACK|XXX|STUB|DEFERRED|PLACEHOLDER)\b|…/i` — the marker words as
whole words, anywhere in a comment, case-insensitively.

That matches every sentence _mentioning_ a marker. Latent while the rule only read function bodies;
the moment bug 0052's fix let it read docstrings it fired on five places in our own `src/`, none of
them a stub:

| Site                    | Text                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| `body-traversal.ts`     | the docstring of bug 0052's fix, which says the word TODO three times      |
| `callback-extractor.ts` | "Reference resolution requires type-checker lookups and is **deferred**."  |
| `terminal-builder.ts`   | "…**stub**, which the compiler could not have done anyway."                |
| `matchers.ts`           | the `STUB_PATTERNS` definition's own docstring                             |
| `hygiene.ts`            | **`noStubComments()`'s own docstring**, which lists the phrases it matches |

The last one is [bug 0043](./0043-an-exclusion-directive-inside-a-string-literal-suppresses.md)'s shape
exactly — _documentation of a syntax read as the syntax, and the first casualty is the parser's own
grammar documentation._ Second occurrence, different mechanism.

## Fix as shipped, in two steps because the first was not enough

**1. Anchor markers to the start of a comment line** — past any `//`, `/*` or `*`. That is where a
real marker goes (`// TODO:`, ` * FIXME`) and where prose mentions do not. Killed 4 of 6.

**2. Make the markers case-SENSITIVE.** Anchoring alone left two, and the reason is worth recording:
a wrapped JSDoc sentence put the lowercase word `stub,` at the start of a continuation line, so the
anchor matched. Uppercase is the convention, and casing is what separates the marker from the English
word.

Measured after both — six real forms detected, five prose forms rejected:

| Input                                             | Matched      |
| ------------------------------------------------- | ------------ |
| `// TODO: finish this`                            | ✅           |
| `// FIXME` (bare)                                 | ✅           |
| `/** TODO: finish */`                             | ✅           |
| ` * TODO: finish` in a JSDoc block                | ✅           |
| `/* HACK: works around X */`                      | ✅           |
| `// not implemented yet`                          | ✅           |
| `// missed both \`// TODO\` and \`/\*_ TODO _/\`` | ❌ correctly |
| `// requires lookups and is deferred.`            | ❌ correctly |
| ` * stub, which the compiler could not have done` | ❌ correctly |
| `noStubComments()`'s own docstring                | ❌ correctly |
| `// replaced the placeholder with a real rule`    | ❌ correctly |

**A stated limit rather than a discovered one:** a lowercase `// todo: x` is no longer matched. That is
the price of not matching "the todo list below", and it is the right trade for a rule whose findings
fail a build — a false positive costs an adopter an argument with their tooling, a false negative costs
one unflagged marker. The phrase forms stay case-insensitive, because nobody writes "NOT IMPLEMENTED",
but they are anchored for the same reason as the markers.

## Why this is filed separately from 0052

They shipped together and could not have shipped apart — 0052's fix cannot go green with this
outstanding. But they are different defects with different mechanisms: 0052 is _where the rule looks_
(the traversal never offered the declaration node), 0053 is _what the rule accepts_ (the pattern had no
notion of where a marker belongs).

Recording them as one would have hidden the more general lesson, which is already a line in
`BUGS.md`: **fixing a false green often widens a neighbouring one.** 0052 was a false negative; fixing
it converted a latent false positive into a live one, in exactly the surface the fix newly reached.
Check what a fix makes _reachable_.

## Sabotage

| Revert                                              | Result                                 |
| --------------------------------------------------- | -------------------------------------- |
| Drop the line-start anchor                          | CAUGHT — prose rows red                |
| Restore the `i` flag on the markers                 | CAUGHT — the wrapped-`stub,` row reds  |
| Drop the anchor from the phrase forms               | CAUGHT — the rule's own docstring reds |
| Baseline asserted green before each, restored after | 0                                      |

## Related

- [Bug 0052](./0052-nostubcomments-cannot-see-a-functions-own-docstring.md) — the traversal fix that
  exposed this, and shipped with it.
- [Bug 0043](./0043-an-exclusion-directive-inside-a-string-literal-suppresses.md) — same shape:
  documentation of a syntax read as the syntax. Its resolution was the same idea, _a directive must
  begin its comment_.
- [Plan 0083](../../plans/0083-eat-our-own-dogfood.md) Phase 1 — the root of the chain.
