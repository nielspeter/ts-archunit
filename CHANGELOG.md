# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.46.1] - 2026-08-04

Everything here came out of two reviews of v0.46.0. One finding is a **real hole in a gate**, present
since v0.23.0 and unrelated to v0.46.0 except that reviewing v0.46.0 is how it was found.

### Fixed

- **The empty-selection gate could be switched off in one line, through public API**
  ([bug 0050](bugs/fixed/0050-the-cardinality-exemption-was-forgeable.md)). The exemption that lets
  `notExist()` pass on a selector matching nothing was a module-private `unique symbol` keyed onto
  the condition — chosen over a boolean property precisely to stop a "one-line silent opt-out". But
  four shipped conditions carry it as an own property and `notExist` is exported, so
  `Object.getOwnPropertySymbols(notExist())[0]` hands it to anyone. Measured: an honest condition on
  an empty selection produces **1** configuration finding; a forgery carrying the stolen symbol
  produces **0**.

  **"Module-private" describes the binding, not the value.** Both exemptions — this one and plan
  0081's — are now membership of a module-level `WeakSet`: nothing to read off an object, nothing to
  copy. The guard that existed asserted only that `defineCondition` emits no symbols, which covers
  user-built conditions and not the shipped ones where the key was readable.

- **v0.46.0's own ownership symbol had the identical hole**, and shipped with it for a day. Same
  fix, plus the `in`-operator hazard it carried: `{ [SYMBOL]: undefined }` type-checked and `in`
  returned true for it — also 0 findings, measured.

### Changed

- **A named function expression on a property now reports the property name.** `{ handler: function
legacyName(req) {} }` reported `legacyName` before v0.46.0 and reports `handler` since. This is the
  second arm of v0.46.0's naming change and it went out undeclared and unguarded — the sabotage that
  restores the old behaviour for function expressions only passed the entire suite. Both directions
  are now pinned: the property key wins on a property, and a positional named function keeps its own
  name.

### Documentation

- The v0.46.0 baseline-migration note was **wrong about its own mechanism**. `hashViolation` is
  `identity ?? element::message`, so producers that set `identity` — every body-analysis condition —
  **keep their hashes**; only structural conditions move. The note said the hash was "over rule +
  element + message" and told everyone to regenerate. Corrected, and the test plan 0082 called "not
  optional" now exists over both producer classes.
- `terminal-builder.ts` and `docs/api-reference.md` both claimed `SliceRuleBuilder` was the only
  builder overriding `ownsDiscoveryDiagnosis()`. False since v0.44.0 — a hand-maintained roster, the
  exact defect class plan 0081 was filed to delete, one file away from the fix.

## [0.46.0] - 2026-08-04

Minor rather than patch for one reason: an object-literal callback now has a **name**, which changes
`element` and message text on violations about it — and therefore their baseline hashes. See
Upgrading.

### Changed

- **A callback written as an object property keeps its name** ([plan 0082](plans/completed/0082-an-object-literal-callback-keeps-its-name.md)).
  `extractCallbacks` discarded the property path one line from where it was produced, so both
  callbacks in `app.post('/x', { preHandler, handler })` came back anonymous **and** shared the
  object's `argIndex`. Nothing in the shape told them apart, so a rule an adopter would plausibly
  write —

  ```ts
  within(calls(p).that().withMethod('post'))
    .functions()
    .that()
    .haveNameMatching(/^handler$/)
    .should()
    .notContain(call('db.query'))
  ```

  — was writable and selected **nothing**. Not a false green, but the shape next to one: expressible,
  plausible, empty. It reds today only because an empty selection is itself a finding.

  `fromObjectLiteralFunction` already existed, already exported, already computing the name from
  exactly that path. The fix was to call it. Nested properties get the dotted form
  (`hooks.onRequest`), matching what that function already produced elsewhere — two surfaces
  disagreeing about one node's identity would make `.excluding()` patterns depend on which surface
  reported. **Positional callbacks are unchanged** and still anonymous, identified by `argIndex`.

  **If you baseline violations about object-literal callbacks, some entries move — but fewer than
  this note first said.** `hashViolation` is `identity ?? \`${element}::${message}\``, so a producer
that sets its own `identity`supersedes the element entirely. Measured: **body-analysis rules keep
their hashes** —`notContain(call('x'))` and friends identify a violation by the call site, not by
  the enclosing function's name — while **structural conditions do move**, because they compose the
  subject from element and message. Regenerate the latter only.

  The first version of this note said the hash was "over rule + element + message" and told everyone
  to regenerate. That was wrong about the mechanism and wrong about the consequence for the very
  rule it quoted, and it shipped because the test plan 0082 called "not optional" was not written.
  It is now (`tests/helpers/baseline.test.ts`), over both producer classes.

### Fixed

- **Discovery-diagnosis ownership is declared by the condition, not asserted about all of them**
  ([plan 0081](plans/completed/0081-a-condition-declares-discovery-ownership.md)). `PairFinalBuilder`
  told the dead-glob gate to stand down for _every_ cross-layer condition, on the strength of a
  docstring claiming all three self-report. At v0.45.0 that claim was false —
  `haveMatchingCounterpart` missed a dead final layer — so the gate stood down for exactly the case
  its declared owner did not handle, and the reader got silence instead of a message
  ([bug 0040](bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md)).

  A condition now tags itself with a module-private symbol, and the builder reads the tag. **An
  untagged condition is covered by the gate**, which is the recoverable direction: a generic "this
  glob matched nothing" beats silence. The symbol is not exported — asserted, not asserted-in-prose —
  because `PairCondition` is public and an importable key would be a one-line silent opt-out of a
  gate on any user condition.

  No behaviour change for the three shipped conditions; they are tagged and their layer-naming
  findings survive exactly as before.

## [0.45.6] - 2026-08-03

### Fixed

- **This project's own type-assertion rule was pointed at the wrong element kind**
  ([bug 0049](bugs/fixed/0049-the-type-assertion-self-check-selected-classes.md)). We ship
  `noTypeAssertions()` as a guardrail and enforce it against our own source — with a rule that
  selected **classes**, in a codebase with 19 files containing a class and 128 containing a
  function. Every `as` cast we shipped was in a function, so the guard never fired on any of them.
  Not a glob-scope problem: no widening of the paths would have found it.

  The bug was filed at "four casts", from a grep. The whole-file rule found **22**, in 8 files.

  **18 removed, 4 waived.** Ten were one variadic-overload dispatch written five times, whose stated
  justification was true and whose casts were still avoidable — a type-predicate filter narrows a
  tuple-union rest parameter without one, and the five copies are now a single `splitGlobArgs`. Five
  sat directly after the `in`/`typeof` check that made them unnecessary. Three were unvalidated CLI
  input, including a `JSON.parse` cast that would have thrown on a malformed `package.json` during
  `--version`. The remaining four are genuine JS-interop boundaries — ts-morph's private
  `compilerSymbol` internals and an optional peer dependency loaded via `createRequire` — and they
  are waived **in place**, with `// ts-archunit-exclude` directives naming the boundary, rather than
  by narrowing the rule so the exemption becomes invisible.

- **`isRecord` had two verbatim copies and a third site that cast instead of calling either.** Now
  one owner. Consolidating caught a live drift: both copies excluded arrays, the first shared draft
  did not, and shipping that would have widened two callers to accept an array as a record.

### Internal

- No behaviour change for users. `getVersion()` now returns `0.0.0-unknown` instead of throwing if
  `package.json` is unreadable, and an unrecognised `--format` falls back to `auto` instead of being
  asserted into the union.

## [0.45.5] - 2026-08-03

Test-quality only, closing what a testing review raised after v0.45.4 was tagged.

### Internal

- **The guard against cardinality-only assertions was itself a cardinality-only assertion.** It
  compared a population total against a ceiling, so adding a count-only block while deleting an
  unrelated one nets to zero and passes silently — the exact substitution the guard exists to catch.
  It is now keyed on the **set of contributing files**, with the total demoted to a vacuity band.
  File granularity rather than `file:line` on purpose: line numbers shift on unrelated edits, and a
  roster that reds constantly teaches the next author to update it without reading it.

- **Three assertions that could pass over nothing, or claimed more than they checked.**
  `glob-declaration.test.ts` asserted four spellings agreed via `new Set(...).size === 1` — which
  four _empty_ results also satisfy, so it passed if the glob machinery returned nothing; it pins the
  value now. `call.test.ts`'s "ignores non-function arguments" could not distinguish "skipped" from
  "searched and found nothing", since the condition emits at most one violation per call; it asserts
  the outcome by identity, and the skipping property is covered where it actually lives. And the two
  basename projections now state why they are unambiguous and when that would stop being true.

## [0.45.4] - 2026-08-03

Test-quality only. No source changes, no API changes, no behaviour changes.

### Fixed

- **An `as` cast in shipped source, and the guard it was duplicating** ([ADR-005](adr/005-no-any-no-type-assertions.md)).
  `cli/commands/explain.ts` narrowed a value with `(value as Record<string, unknown>)['describeRule']`
  — a type assertion in published code with no `eslint-disable` and no interop boundary to justify it,
  and unnecessary: once the value is narrowed to `object`, `'describeRule' in value` narrows enough.
  Two test files had already written the cast-free version of the same guard. All three now use one
  owner, `isDescribable` in `src/core/rule-description.ts`. Found by an architecture review asking
  about the **duplication**, not about the cast — and grepping for siblings of the pattern found four
  more, filed as [bug 0049](bugs/fixed/0049-the-type-assertion-self-check-selected-classes.md),
  whose real question is why this project's own `noTypeAssertions()` rule does not fire on its own
  source.

### Internal

- **45 test assertions that counted now name what they expect** ([plan 0079](plans/completed/0079-triage-the-cardinality-only-assertions.md)).
  [ADR-008](adr/008-agent-first-failure-surfaces.md) rule 5's third corollary — _counting is the
  shortcut; compare identities_ — was the one corollary with no guard. A scan found 143 `it()` blocks
  asserting a non-zero count with nothing pinning which elements; a seeded sample of 30, classified
  by reading every one, put **27% in the class where a swap passes** — one element lost and another
  gained, assertion still green. Above the plan's ~15% stop rule, so all 45 were converted.

  Six of the eight sampled cases carried a **comment naming the identity the assertion omitted** —
  `// Only DomainError fails`, `// handler + hooks.onRequest`, `// UserService and OrderService match
both predicates`. The reader knew; the test did not.

  Two were reclassified the other way by measurement: `preset-fanout-is-one-finding.test.ts`
  produces violations that are identical on ruleId, file, line, element and message _by design_,
  because the claim is that alike violations are not collapsed. There is no identity to assert, so
  the count is the value — both reverted, with the reason recorded.

  Two things fell out. `matchers.test.ts` asserted two sibling matches; naming them showed the
  matcher returns the **identifier** nodes, not the call expressions. And
  `callback-extractor.test.ts` could not express its identity at all through the public shape —
  filed as [plan 0082](plans/completed/0082-an-object-literal-callback-keeps-its-name.md), since two
  callbacks on one object literal are indistinguishable to a rule author.

- **Two tests were passing on a false green of the kind they existed to prevent.** A testing review
  found the class-B rule used to triage this work had an unstated premise: that only the subject can
  fill the violations array. It cannot — when a selector matches nothing, the dead-glob gate emits
  **exactly one** configuration finding, so `toHaveLength(1)` accepts it and the condition never
  runs. Measured on `widened-module-edges.test.ts`: delete the two fixtures and both blocks exit 0,
  "2 passed". One of them carries the comment _"The false green this release must not create"_. Both
  now assert identities and exit 1 under the same swap. Three further count-only blocks were
  converted alongside them.

- **The scan that found them was itself a hand-maintained list, twice over.** Its first identity
  signal counted `toBeTruthy`/`toThrow`/`toBeGreaterThan`, none of which survive a swap. Its second
  missed five element-boolean idioms like `.some((m) => m.includes('"offset"'))`. And its third —
  found by an architecture review asking the one question the earlier checks could not answer — was
  **over-broad in the other direction**: a bare `expect(violations[0]).toBeTruthy()` counted as an
  identity assertion, though it pins nothing about which element is there. Correcting it put six
  blocks back into the population, one of which was a genuine case the over-exclusion had hidden
  (`callback-extractor.test.ts` respecting its depth limit — the comment named which callback, the
  count could not).

  The scan is now **committed** at `tests/tools/scan-cardinality-assertions.ts` with a ratchet test.
  The first version of the write-up cited a script in a scratch directory that was never committed,
  while this changelog claimed a script had been recorded — which left every number exactly as
  unauditable as the 215 it replaced.

## [0.45.3] - 2026-08-03

Everything here came out of an architecture review of v0.44.0/v0.45.0. No user-facing behaviour
changes except the cross-layer fix below, which is only reachable by calling a condition's
`evaluate()` directly.

### Fixed

- **A cross-layer condition handed fewer than two layers returned nothing, silently.** All three
  conditions did — the exact false green this library exists to remove, inside the library. Not
  reachable through the DSL (`.mapping()` throws below two layers), but `PairCondition` is an
  exported interface and the conditions are exported, so the direct-`evaluate()` path is public —
  the same reachability as the defect fixed in v0.43.1. They now produce an unsuppressable
  configuration finding naming what to supply. Found as a _divergence_: with an empty
  `context.layers` and a two-layer argument, `haveMatchingCounterpart` reported two findings and
  its siblings reported none, and chasing why the numbers differed showed all three were wrong in
  the same direction on a neighbouring input.

- **`isFaultPosition` decided a new glob position by default.** A fifth `GlobPosition` compiled
  clean and left the suite green, silently a non-fault in all three consumers — a dead glob written
  at it would have been invisible to both `doctor` and the build, which is the original divergence's
  failure direction inside the predicate written to remove it. It is now an exhaustive `switch`, so
  a new position is a compile error.

- **The census's helper call-site check could not fail** ([plan 0078](plans/completed/0078-derive-the-configuration-finding-census.md)).
  It asserted the second argument's source text contained `remedy` — a **mandatory property key**,
  so the assertion was satisfied by the shape of the call rather than the value of the remedy. A
  third `assertDiscovered` call site with `remedy: ''`, a configuration finding shipping no remedy
  at all, passed `tsc` and the full suite unchanged. It now resolves the property and judges its
  value.

### Documented

- **`deadSelectorFindings()`'s return type changed in v0.44.0** from `ArchViolation[]` to
  `{ selector; discovery }`, and that is a break on a **documented** extension point —
  `docs/api-reference.md` states external `TerminalBuilder` subclasses are supported. It is not
  silent (a TS override stops compiling; a JS override throws), but neither the v0.44.0 changelog
  entry nor its upgrade row said so. Both `deadSelectorFindings()` and `ownsDiscoveryDiagnosis()`
  are now in the API reference — the latter matters because an external subclass that already
  self-diagnoses an empty discovery glob is otherwise preempted by the gate with a generic message,
  and overriding it is the remedy.

### Internal

- A classification citing a test file that no longer exists now fails, rather than pointing at
  nothing. Ten citations were verified by hand during review, which is a measurement with a shelf
  life; this gives it one that does not expire.
- `doctor` and the build are now asserted to agree about a dead **discovery** glob. The parity row
  existed only for `selector` — the position that never diverged — while `discovery`, the position
  the whole fix was about, had a single-surface test on each side.
- A test docstring still asserted that a dead `discovery` glob "already failed", the precise false
  premise plan 0080 was filed to correct, in the one place a reader checks the premise.

## [0.45.2] - 2026-08-03

No behaviour changes. Two internal guards were found to be weaker than they claimed, and the
correction is recorded here because the claim was published in the previous release notes.

### Fixed

- **The configuration-finding census checked remedies by spelling, not by meaning** ([plan 0078](plans/completed/0078-derive-the-configuration-finding-census.md)). v0.45.0 shipped a detector for "this finding prints the rule author's remedy instead of its own" — the shape of [bug 0042](bugs/fixed/0042-cross-layers-empty-layer-finding-inherits-the-authors-remedy.md) — and it matched a hand-written list of strings. Probed afterwards, **three producers defeated it while the whole file stayed green**: a destructured `const { suggestion } = context`, a parameter aliased to `c`, and a read through a helper. A hand-maintained list of spellings, inside the census built to replace hand-maintained lists.

  It now resolves each identifier's symbol through ts-morph and follows it one hop through a local or into a helper's `return` — a different kind of evidence than text, which is what [ADR-008](adr/008-agent-first-failure-surfaces.md) rule 5 asks for. Eight reverts, all caught, baseline asserted green before each.

- **A shorthand property escaped symbol resolution too.** `getSymbol()` on the identifier in `suggestion,` resolves to the _property_, not the local — so destructuring survived the first fix for destructuring. `getValueSymbol()` is the accessor that answers the question actually being asked.

- **Two producers in one function collapsed into one census entry.** The live set is a `Set` keyed on `path::function`, so a second configuration finding added inside an already-classified function inherited its classification and became invisible to every check in the file. No collision exists today; that is now a measured fact rather than an assumption, and the census fails if one appears.

- **Four comments stated populations that had grown.** `diagnose.ts` named `crossLayer()` and `resolvers()` as builders that cannot identify their project — both had been given `getProject()` by the commit that fixed exactly that false green, so the comment named as examples the two shapes the fix repaired, and contradicted a passing test. `violation.ts` said "three of the four suppression paths" while the roster stood at six, and "five of the six producers" while the census held fifteen. `disk-set.ts` counted eight test doubles where the suite has 114. The counts are gone rather than refreshed — the values are named where they are derived, so there is nothing left to go stale.

## [0.45.1] - 2026-08-03

### Fixed

- **A cross-layer rule whose FINAL layer matched no files reported the wrong thing** ([bug 0040](bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md)). `haveMatchingCounterpart` checked for empty layers inside its pair loop, which never reaches the last layer — so instead of reporting the mis-globbed layer it reported every file in the preceding one as _"has no matching counterpart"_. Measured: 0 configuration findings and 2 ordinary violations, where the truth was one dead glob.

  That advice is actively harmful: following it means writing files into a layer whose glob is wrong, where they still will not match. `haveConsistentExports` and `satisfyPairCondition` were guarded correctly in v0.44.0, so the three conditions disagreed about the same input. All three now share one check over every layer.

## [0.45.0] - 2026-08-03

### Added

- **The configuration-finding census** ([plan 0078](plans/completed/0078-derive-the-configuration-finding-census.md)). A finding carrying `bypassFilters: true` reports that a rule enforces nothing; there are **15 producers** of them, and the guard that was meant to hold them to a standard enumerated **three by hand** and asserted only that a remedy was present. It could not have caught [bug 0042](bugs/fixed/0042-cross-layers-empty-layer-finding-inherits-the-authors-remedy.md), which shipped a producer printing the rule author's unrelated `Fix:` on a finding about a mis-globbed layer.

  The census is derived from source, keyed on each producer's enclosing function, and asserts statically that every one sets its **own** remedy and never reads the author's. A new producer fails the suite until it is classified, and must declare whether its remedy has been **proven to remediate** — 11 of 15 name the test that applies the fix; the other four carry why applying it is not possible.

  Internal only: no API or behaviour change. It is a guard against a class of defect this project has shipped twice.

## [0.44.0] - 2026-08-03

### Fixed

- **A cross-layer condition over an empty layer reported nothing** ([bug 0040](bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md), silence half — [plan 0080](plans/completed/0080-admit-discovery-globs-to-the-dead-glob-gate.md)). Measured: `satisfyPairCondition` and `haveConsistentExports` both went **4 violations → 0** when a layer's glob matched no files. `haveMatchingCounterpart` was already guarded; all three now share one check, so a fourth condition cannot arrive without it.

- **A dead `discovery` glob now fails the build, everywhere it is written** — `smells.*.inFolder()`, `resolvers()`, `crossLayer().layer()`. `doctor` reported these already and the check did not, because the two consulted **inverse hand-maintained position lists** that disagreed about exactly `discovery`. One shared `isFaultPosition` predicate now. Measured: a dead resolver discovery glob goes from 0 findings to 1.

- The finding's message is position-aware in **both** clauses. _"This rule's selector … so it has no subjects"_ was wrong twice for a discovery glob: it is not a selector, and the rule may have plenty of subjects — nothing was discovered to compare.

### Changed

- Slice rules and cross-layer rules **declare** that they diagnose their own empty discovery, so the gate stays out and their more specific messages survive. Slice's discovery is not per-tree — one empty slice among populated ones is legitimate, and that remains true.

### Upgrade note

**A rule whose `inFolder()`, `resolvers()` or `.layer()` glob matches nothing will now fail** where it previously passed in silence. That is the fix: such a rule was checking nothing. `doctor` has reported these for several releases, so running it first will show you the list before you upgrade.

No change to rules whose globs match. Slice rules are unaffected, including the case of one empty entry among populated ones.

## [0.43.3] - 2026-08-03

### Fixed

- The `orphanExclusions` JSDoc had become attached to an internal helper rather than the exported function, so editors showed no documentation for it.

### Changed

- Internal only: the orphan check's cheap file reject is now one shared predicate rather than two identical inline checks, and is guarded by counting parsed files. No behaviour change.

  Worth recording why, since the code comments now carry it: the duplication caused a real measurement error. An attempt to time the reject's saving patched one of the two copies, so both arms ran the same path and a **3.0x** `doctor` regression measured as ~1.0x. Removing the reject changes cost and not behaviour, so no functional test could have caught it — hence the counter.

## [0.43.2] - 2026-08-03

### Fixed

- **`doctor <one-rule-file>` reported working exclusion comments as orphans, and told you to delete them.** The v0.43.0 orphan check compares directives against the ids of the rules it was handed, and the single-file `doctor` form sees only part of a multi-file project — so a comment naming a rule declared elsewhere looked stale, with "delete the comment" as its remedy. Deleting it un-waives a real violation. The advice now leads with what was actually checked when the view is partial, and stays quiet when it is complete.

- **The orphan check silently found nothing on an in-memory project, or on a file it could not read.** It read each file from disk and swallowed the failure. It now uses the text ts-morph already holds, so there is no second read to fail.

- **When no rule declares an id, the check said nothing** — while in that state _every_ inline exclusion in the project is inert, so all of them were real orphans. It now reports one aggregate finding naming the cause, rather than silence or one finding per comment.

- `doctor`'s terminal output prints the source file and line for these findings. v0.43.0's release note claimed it did; it printed neither.

- The finding carries the source location in a new `sourceFile` field rather than reusing `ruleFile`, which is documented as naming a _rule_ file. JSON consumers were getting two different things under one name depending on `kind`.

## [0.43.1] - 2026-08-03

### Fixed

- **A pair-condition context carrying fewer than two layers silently passed.** Introduced in v0.42.0 and found by probing the new precedence rather than by review. The threshold was "the context wins if it has _any_ layers", so a context with **one** layer beat a usable two-layer argument — and `haveMatchingCounterpart` then returned nothing at its own `layers.length < 2` guard. Measured: context 1 layer + argument 2 layers → **0 findings**, a vacuous pass.

  The threshold is now "two or more", which is what a pair condition needs to mean anything. Every builder path is unchanged: the builder cannot produce fewer than two layers, because `.mapping()` throws below that — so this cannot restore the defect v0.42.0 fixed, where a hand-built argument beat the builder's real resolution.

  Only reachable by calling a pair condition's `evaluate()` directly. If you do that, a context you build yourself must carry both layers or the argument is used instead.

## [0.43.0] - 2026-08-03

### Added

- **`doctor` now reports exclusion comments that name a rule nobody declares** ([bug 0044](bugs/fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md)). `.excluding()` warns when a pattern matches nothing; an inline `// ts-archunit-exclude` comment could not, and structurally cannot on the enforcement path — comments are read only in files that already produced a violation for that rule. So **rename a rule and every comment naming the old id goes inert, silently and permanently.**

  `doctor` finds them, names the file and line, and exits non-zero. v0.37.0 disclosed what a comment _did_ suppress; this is the other direction — a comment that suppresses nothing.

- `orphanExclusions(rules)` is exported for the vitest audience, alongside `diagnose()`. **It needs every rule at once**: the declared-id set is the union across rule files, so calling it with a subset reports directives from sibling files as orphans. `doctor` calls it once, after loading everything.

### Known gap

- A comment whose rule id is **correct** but whose placement is wrong is still silent. Catching that means parsing every file in scope on every run, which is the cost the current gate exists to avoid; the trade is argued in the bug. The placement rules themselves are documented (`docs/violation-reporting.md`, v0.37.0).

## [0.42.1] - 2026-08-03

### Fixed

- **On a project that loaded no source files, the assertion gate blamed the glob** ([bug 0048](bugs/fixed/0048-the-dead-glob-gate-blames-the-glob-when-the-project-is-empty.md)). It reported every selector glob dead and told the reader to _"Correct the glob, or remove the rule"_ — a remedy for a fault that was not theirs. Measured on an empty tsconfig: the glob was correct and the project had loaded 0 files. `diagnose()`/`doctor` short-circuited on this (v0.33.0) and the slice builders had their own branch; the gate had neither, so the wrong remedy sat on the path **every `modules()`, `classes()`, `functions()` and `types()` rule takes**. All three surfaces now report the same thing, from one owner, as one finding per project rather than one per glob.

This is a diagnostic-quality fix: it changes what a finding says, never whether one fires. No enforcement, exit-code or baseline change.

## [0.42.0] - 2026-08-03

### Fixed

- **`haveMatchingCounterpart` required a `Layer[]` no public API could produce** ([bug 0040](bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md), API half). `PairFinalBuilder`'s layers are private at every stage and `resolveLayer` is not exported, so every caller had to hand-build the array — and the condition then judged **that copy** rather than the builder's resolution. Measured: with the builder's glob dead and a hand-built array populated, it reported two counterpart violations and no configuration finding, describing a layer set the library never resolved.

  The builder now supplies its own resolved layers, so **`haveMatchingCounterpart()` takes no argument**. The optional `Layer[]` parameter is retained for compatibility and ignored when the builder provides them.

- The empty-layer finding's remedy pointed at the array that this change removes. It now names the `.layer("name", "glob")` call — the line you actually edit.

### Changed

- `PairCondition.evaluate` receives a **`PairConditionContext`**, which extends `ConditionContext` with the resolved `layers`. Additive: a condition declaring `ConditionContext` still satisfies `PairCondition`, so `haveConsistentExports`, `satisfyPairCondition` and any condition outside this package compile unchanged.

### Upgrade note

**No action required, and nothing breaks at compile time.** `haveMatchingCounterpart(layers)` still compiles; you can drop the argument whenever convenient.

One behaviour change worth knowing if you hand-built the array deliberately: **the builder's layers now win.** If you passed a deliberately _narrower_ set, the condition now uses what the builder resolved. That is the fix — the hand-built copy was the defect — but it is silent, so check any call site where the array was not simply mirroring your `.layer()` declarations.

The remaining half of bug 0040 — two of three cross-layer conditions reporting nothing when a layer resolves to nothing — is [plan 0080](plans/completed/0080-admit-discovery-globs-to-the-dead-glob-gate.md). A design review measured that the obvious one-line fix would make the dead-glob gate **replace** the slice builders' own findings rather than add to them, costing 13 tests of a remedy corpus whose subject is that each branch's advice is true. It is not shipping until that is solved properly.

## [0.41.0] - 2026-08-01

### Fixed

- **A typo in a preset override key silently did nothing** ([bug 0038](bugs/fixed/0038-a-typo-in-a-preset-override-key-is-a-silent-false-green.md)). Measured: `overrides: { 'preset/recommended/no-silent-cach': 'error' }` left the rule at `warn` and the build **green** — the escalation the author asked for never happened, and the only trace was a line on stderr that never reaches the exit code. Five rules ship with a `warn` default, so turning one _off_ by a misspelled key was equally silent.

### Added

- **Override keys are typed.** Each preset's `overrides` map is now keyed by that preset's own rule ids as a literal union, so a misspelled key is a **compile error in the editor** — before any run, at no CI cost. The unions are derived from each preset's existing rule list rather than restated, so they cannot drift when a rule is added.

  One deliberate exception: `agentGuardrails`' `preset/agent/no-inline-logic/${api}` ids are built from your own `noInlineLogic` entries, so that arm is a template literal and a typo in the API segment still compiles. The runtime finding below covers it.

- **An unknown override key is now a configuration finding** that fails the build, for the paths a type cannot reach: JavaScript consumers, a dynamically-built overrides object, config read from disk. It names the preset's real rule ids, because the usual cause is a near-miss you cannot spot by staring. `validateOverrides` is **unchanged** — its published `void` signature is documented, so the new behaviour lives in a sibling rather than a breaking change.

### Upgrade note

**A build carrying a typo'd override key will now go red**, having previously passed. That is the bug: the override was doing nothing. Two ways it surfaces — as a compile error if you use TypeScript and a literal key, or as a configuration finding at run time otherwise.

The fix is to correct the key. The finding lists the preset's valid ids; if you meant to remove the override, delete it.

No other behaviour changes: rules that were being enforced are enforced identically, and baselines are unaffected.

## [0.40.0] - 2026-08-01

### Fixed

- **A `// ts-archunit-exclude` directive counts only where it really is a directive** ([bug 0043](bugs/fixed/0043-an-exclusion-directive-inside-a-string-literal-suppresses.md)). The parser split the source on newlines and matched each line, with no idea what was code, what was a string and what was a comment — so the characters alone were enough. Measured: the directive text inside `"…"`, `'…'`, a template literal, a regex literal or JSX text produced a **live exclusion that silenced a real finding**, and silently, because a directive carrying a reason never triggers the undocumented-exclusion warning. Literals are now parsed and blanked before the scan.

- **A comment that mentions the syntax is no longer treated as the syntax.** Once comments were being read correctly, any comment _about_ a directive became one — the first casualty was this parser's own grammar documentation, which declared a reason-less exclusion against whatever rule was running. A directive must now **begin its comment**, and block comments are excluded (the grammar is `//`-only; a `/* … */` directive never worked). The documented trailing form is unaffected: `const a = 1 // ts-archunit-exclude rule/id: why` still works, because there the comment begins with the directive.

### Upgrade note

**Some exclusions will stop applying, and that is the fix.** If a finding reappears after upgrading, the comment that was silencing it was one of:

- inside a string, template, regex or JSX text — it was never a comment;
- prose inside a larger comment, e.g. `// see // ts-archunit-exclude foo` or a JSDoc block explaining the feature;
- inside a `/* … */` block, which never created an exclusion but could contribute a _warning_.

None of those were intended as exemptions. If you did intend one, write it as its own line comment: `// ts-archunit-exclude rule/id: why`.

Most affected are projects whose source discusses this library — its own tests, documentation examples embedded as template literals, or tooling that generates exclusion comments.

## [0.39.1] - 2026-08-01

### Fixed

- **A symlinked `node_modules` was not pruned from the disk walk, so globs beneath it were misdiagnosed** ([bug 0045](bugs/fixed/0045-two-tests-fail-by-environment-and-corrupt-sabotage-verdicts.md)). `Dirent.isDirectory()` is `false` for a symlink, and the prune check sat inside that branch — so the directory was recorded as a _file_, and a glob under it classified `absent` ("no such path exists") instead of `not-determined` ("this walk cannot tell"). Those carry different advice, and `absent` is the one that asserts something false. **`pnpm` builds `node_modules` out of symlinks and `git worktree add` leaves a symlinked one behind**, so this reached real projects, not just CI. Pruning now happens by name, before the directory test; no symlink is followed, so the loop-safety argument is unchanged.

This is a diagnostic-quality fix: it changes the advice attached to a finding, never whether one fires. No enforcement, exit-code or baseline change.

## [0.39.0] - 2026-08-01

### Fixed

- **A finding with no source location no longer invents one** ([bug 0047](bugs/fixed/0047-a-fileless-finding-renders-a-meaningless-location.md)). A configuration finding reports that a _rule_ enforces nothing, not that a line of code is wrong, so it has no location. Two of the four renderers said so already — the rich terminal format omits it, and the GitHub formatter special-cases it because `::error file=,line=0` is not a valid annotation and GitHub silently drops it. The plain format emitted a bare `(:1)`, and `--format json` emitted `"file": "", "line": 1`. Both now render nothing and `null` respectively.

### Added

- **`kind` on every JSON violation**, `"violation"` or `"configuration"`. The payload previously carried **no field at all** distinguishing a finding about your code from a finding about a rule that enforces nothing — a consumer could only infer it from an empty `file`, which is exactly the misleading signal being removed. The distinction is the one that changes what you do: for a configuration finding, editing the named source cannot clear it. Treat an unrecognised `kind` as `"violation"`, so future values are non-breaking.

- **The JSON document is now a type.** `ArchJsonReport`, `ArchJsonViolation`, `ArchJsonSuppression` and `ArchJsonUntestedAllowlist` are exported. An unexported contract is one a consumer discovers by breaking; TypeScript consumers now get a compile error instead of a runtime one. The type is pinned against the emitter, so it cannot drift from what is actually produced.

- `commentSuppressed` is documented (`docs/cli.md`). It shipped in v0.37.0 and was described only in that release note, never in the payload reference.

### Changed

- `docs/ai-agents.md` gains a section on `kind`, including the part that is easy to get wrong: **detect a configuration finding by `kind`, never by an empty `file`.** The CLI attributes these findings to the **rule file** that declared them before rendering, so most carry a real, useful path — open it, find the rule by `ruleId`, and edit the declaration. Only the baseline meta-findings, produced after attribution, arrive with `file: null`.

### Upgrade note

**`--format json` only. No enforcement, exit-code or baseline change** — a baseline generated on 0.38.0 still matches, measured.

`file` and `line` are now `null` instead of `""` and a meaningless number, on findings that have no location. If you consume the JSON, the failure you _want_ is the loud one: `v.file.endsWith('.ts')` throws immediately and takes five minutes to fix. Look for the quiet ones first:

| Pattern                     | Was           | Now                              |
| --------------------------- | ------------- | -------------------------------- |
| `` `${v.file}:${v.line}` `` | `":1"`        | the literal string `"null:null"` |
| `byFile[v.file] ??= []`     | a `""` bucket | a `"null"` bucket                |
| `v.file?.length > 0`        | `false`       | `false` — unchanged, so it hides |

The direct fix is to branch on `v.kind === 'configuration'` before touching the location at all, which is what the field is for.

## [0.38.0] - 2026-08-01

### Fixed

- **An undocumented exclusion comment now fails the build** ([bug 0039](bugs/fixed/0039-an-undocumented-exclusion-comment-suppresses-and-only-warns.md)). `// ts-archunit-exclude arch/no-cycles` with no reason silenced a finding and printed a warning nobody had to act on. Since v0.37.0 made inline comments work for every condition family, one un-reasoned line was a build-green kill switch for any rule id anywhere. It is now an unsuppressable configuration finding. **The exemption still applies** — what fails is the missing justification, so adding a reason clears the finding and keeps the exclusion working. Stated honestly on the finding itself: a reason is prose and nothing verifies it, so this raises the cost of a suppression rather than preventing one. The audience is the reviewer reading the diff.

- **Nested exclusion blocks now nest** (same bug, second half). The parser refused _any_ nested `// ts-archunit-exclude-start`, including one naming a different rule, and then let the inner `-end` close the outer block. So exempting one rule across a module and another across a function inside it produced two wrong results at once: the inner exemption never applied, and the outer stopped early. Block state is now a stack — one `-start` opens a frame, one `-end` closes the innermost. Every previously-valid input behaves identically. Re-opening a rule that is already open still warns, since the likeliest cause is a missing `-end`, but now applies.

### Upgrade note

**Any exclusion comment without a reason will fail your build.** Find them with
`grep -rn "ts-archunit-exclude" src/` — anything lacking a `:` needs one:

```ts
// ts-archunit-exclude arch/no-cycles: legacy gateway, tracked in TICKET-123
```

Adding the reason clears the finding and leaves the exemption in place; nothing else changes. If an exemption cannot be justified in a sentence, that is the signal to delete it and fix the finding instead.

The finding cannot be suppressed — not by `.warn()`, `.asSeverity('warn')`, `.excluding()`, another exclusion comment, a baseline, or diff-aware mode. A suppression mechanism that can suppress the complaint about itself is not a mechanism.

If you rely on nested exclusion blocks, re-check them: the previous behaviour silently ended the outer block at the inner `-end`, so regions you believed were exempt may not have been, and will now report findings that were always there.

## [0.37.0] - 2026-08-01

### Fixed

- **Inline `// ts-archunit-exclude` comments now work for every condition** ([bug 0041](bugs/fixed/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md)). They previously did nothing unless the producing condition stamped `ruleId` itself — so they worked for `classes()` and were **silently inert** for the dependency, exports, slice, reverse-dependency and module-body families, which is most of them. No error, no warning: the comment was ignored. `applyFilters` stamped the rule id _after_ running the comment filter, and `isExcludedByComment` opens by bailing on a missing id. The suite could not see it because its only end-to-end test used a helper that stamped the field itself — test and code written from one understanding, agreeing while the feature did not work.

- **The empty-layer finding carries its own remedy, and the remedy is now true** ([bug 0042](bugs/fixed/0042-cross-layers-empty-layer-finding-inherits-the-authors-remedy.md)). `crossLayer`'s "Layer X matched 0 files" finding copied the rule author's `suggestion`, so a configuration finding printed a `Fix:` for an unrelated problem — measured, an empty-layer finding advising "Split the cycle by extracting a shared module." With no author metadata it shipped with **no remedy at all**, the only configuration finding of the twelve that could. Its remedy is now its own, names the offending glob, and its removal clause is computed from the chain length rather than stated flat — because "remove the layer from the chain" throws `RangeError` on a two-layer chain, which is the only shape that produces the finding.

- **Three published `haveMatchingCounterpart()` examples did not compile**, two of them JSDoc on the public `crossLayer()` and `CrossLayerBuilder`, so every user saw them on IDE hover. Part of [bug 0040](bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md), fixed ahead of the runtime work.

### Added

- **Inline exclusion comments now say what they suppressed.** Every other filter in the pipeline discloses itself — `.excluding()` warns on an unused pattern, diff-aware has a suppression notice, the baseline reports unmatched entries. The comment filter dropped findings and printed nothing, and the fix above made it the widest filter we ship. A run that suppresses anything now prints the **rule and file** for each (identities, not a bare count, per ADR-008 rule 4), capped with the remainder stated rather than truncated silently. `check --format json` carries the same list as `commentSuppressed`, always present so a consumer can tell "nothing suppressed" from "this version does not report it".

- The "this finding cannot be suppressed" sentence named **five** suppression surfaces where the code refuses **six** — the omission being the inline exclusion comment, which the fix above made reachable everywhere. An agent reading a five-item list infers exhaustiveness. It is now sourced from one place and guarded by a set comparison: each mechanism probed behaviourally, compared against the names parsed from the sentence, failing on over-claim and under-claim alike.

### Changed

- `docs/violation-reporting.md` documents **where an exclusion comment has to go**, which was written down nowhere: a single-line directive covers exactly the line below it, and the line that counts is the one the _finding_ reports. A class-level condition reports at the class declaration, not the offending statement; a file-level condition reports at line 1, which **no single-line comment can cover** — use the block form. It also retracts the claim that inline comments "survive renames": they have no staleness signal and structurally cannot have one, which is the opposite of the advantage that was advertised.

### Upgrade note

**Your report may shrink, and the exit code may drop.** Exemptions you wrote and believed had failed are now honoured. A comment matches by rule id, file, and the line immediately below it — nothing else — so a comment left in place after the code beneath it changed will suppress whatever violation of that rule now lands there.

The sharpest case: the `Undocumented exclusion` warning is **unchanged in wording**, and on the previous release it accompanied a red build because the exclusion did not apply. It now accompanies a green one. If you learned that warning was noise, that heuristic has inverted.

Before upgrading, audit with `grep -rn "ts-archunit-exclude" src/`. After upgrading, `check --format json` → `commentSuppressed` lists every suppression by rule and file.

Baselines are unaffected: identity hashing does not incorporate the fields involved, and a baseline generated on 0.36.3 matches on 0.37.0 — measured.

## [0.36.3] - 2026-08-01

### Fixed

- **The relative-glob audit is complete, and the census that proves it is derived from source** ([bug 0036](bugs/fixed/0036-the-relative-glob-audit-is-incomplete.md)). v0.36.2 shipped with three path-glob surfaces unaudited and a uniformity guard whose surface list was written by hand — so it could not fail when a new surface was added, which is the one thing it existed for. The census now reads `src/` and fails until every file declaring a `file-path` or `parent-dir` glob is classified. It found **four** unclassified surfaces, three of them broken: `importFrom`/`notImportFrom` selected **0 subjects where the anchored spelling selected 5**, `onlyBeImportedVia` reported **5 violations against 0 anchored** — a false red on correct code — and `crossLayer().layer()` resolved nothing. All four normalize now, so a relative glob means the project root at every entry point.

### Known gap

- `crossLayer()`'s runtime half is not observable through the public API: a pair rule reports nothing whether its layer resolves three files or none. Its declaration half — what `doctor` and `diagnose()` say about the glob — **is** guarded. This is [plan 0067-D](plans/completed/0067-empty-selector-safety.md)'s shape at an entry point [0069](plans/completed/0069-no-rule-may-certify-nothing.md) R3b never reached, and it is recorded as a follow-up on the bug rather than left to be rediscovered.

## [0.36.2] - 2026-08-01

### Fixed

- **A workspace has no single root** ([bug 0035](bugs/fixed/0035-a-workspace-has-no-single-root.md)). `workspace([a, b])` sets its `tsConfigPath` to the alphabetically first config — a tie-breaker chosen so compiler options are deterministic — and v0.35.0/v0.36.1 promoted that into meaning: a project-relative glob silently meant _that one package_. Measured on a two-package workspace, `'src/api/**'` matched one and not the other, green, with a silent `doctor`; adding a package named `aaa` would have re-pointed every relative glob in the suite. Each file now resolves against the root that **contains** it, longest match first so a nested package's tsconfig wins.

- **An import glob rejected the relative spelling, and `layeredArchitecture` reported a false red** ([bug 0037](bugs/fixed/0037-an-import-glob-rejects-the-relative-spelling.md)). `shared: ['src/shared/**']` reported a violation on a correct architecture, because `shared` also reaches `onlyImportFrom(...)` — matched against the absolute resolved path. Import globs now accept the relative form too. Bare specifiers are unaffected (`notImportFrom('fastify')`), and the primary candidate is unchanged, so no baselined dependency finding moves.

- A tsconfig at the filesystem root produced `''`, which one derivation read as "the root is `/`" and another as "no root known" — the rule discovered its file while `diagnose()` called the same glob dead. And `isProjectRelative` disagreed with `isAnchored` on a drive-absolute `C:/x/**`.

### Known gap

- ~~Three path-glob surfaces are not audited for relative globs.~~ **Closed in 0.36.3** — all four (there were four) normalize.

## [0.36.1] - 2026-08-01

### Fixed

- **`slices().assignedFrom()` accepts a project-relative glob** ([bug 0033](bugs/fixed/0033-assignedFrom-does-not-accept-a-project-relative-glob.md)), resolving it against the project root like every other surface. It was the one holdout after 0.35.0, so `layers: { api: 'src/api/**' }` failed beside a `shared: ['src/shared/**']` that worked — in the same `layeredArchitecture()` call. Purely additive: an anchored glob still means "anywhere", and a relative glob naming a folder that genuinely does not exist still matches nothing.

  The failure message moved with it. A relative glob naming a missing folder is no longer told to "prefix these with `**/`" — advice that would change a spelling which is already correct and leave the rule just as empty.

## [0.36.0] - 2026-08-01

### Fixed

- **`comment()` missed comments, and named the wrong line** ([bug 0034](bugs/fixed/0034-comment-matcher-underreports-and-goes-silent-on-re-evaluation.md)). Three defects with one root cause: a comment is not the node it is attached to. The broad traversal keeps only the deepest matching node — right for `expression()`, which matches at every ancestor level, wrong for a comment, whose node is where it is _attached_. Measured on a corpus with **9** `TODO` comments: `noStubComments()` reported **5**, and now reports **9**.

  The miss scaled with nesting rather than with comment count, so the worst cases are the longest functions. Stacked comments were the sharpest: several `// TODO` lines leading one statement collapsed to a single finding, so appending more to an already-accepted one never turned a build red — in the rule `agentGuardrails` ships to catch exactly that.

  Findings also name the **comment's** line now rather than the line of the statement it leads, including the opening line of a multi-line block or JSDoc comment. At function scope the `line` field remains the function's, as it is for every function-body finding; the per-hit line is in the message.

- **A rule object evaluated twice returned nothing the second time.** `comment()` held a dedup `Set` that was never reset. It now holds no state at all. This did **not** affect `check --watch`, which re-imports rule files on every run. It affected any process evaluating one builder more than once — including the hoisted-builder shape [running in tests](docs/running-in-tests.md) recommends so `diagnose()` and `.check()` share one object. If you use that shape with a `comment()` rule, your second assertion has been passing vacuously.

### Changed

- `ExpressionMatcher` gains one optional member, `matchedTriviaPositions`, whose presence marks a matcher as matching comment trivia. Additive; existing matchers are unaffected.

## [0.35.0] - 2026-08-01

Plan 0067 part C — the second leg of the 1.0 path, and the root-cause fix for the mistake 0.34.0 started failing on.

### Added

- **A project-relative path glob works.** `resideInFolder('src/domain/**')`, `resideInFile()` and `havePathMatching()` now resolve an unanchored glob against the directory holding your `tsconfig.json`, in addition to the absolute path. It means **that folder at the project root** — narrower, and usually more accurate, than the `'**/src/domain/**'` the old advice prescribed, which also matches a `src/domain` inside `vendor/` or a nested package. Both spellings keep working and mean different things.

  Skipped when the project was not loaded from a tsconfig — an in-memory project has no root to be relative to, and inventing one would match against something you never named.

  A `./` segment is still an error. It never occurs in an absolute path and adds nothing to a relative one, and normalizing it would have made the rule _match_ while the gate still reported it dead.

### Changed

- **The `unanchored` diagnostic no longer fires for those three predicates.** A glob stops being reported dead for being unanchored exactly when it starts working, so `doctor` and `check` continue to agree.

### Known gap

- **`slices().assignedFrom()` still requires an anchored glob**, and the layer options that discover through it do too — [bug 0033](bugs/fixed/0033-assignedFrom-does-not-accept-a-project-relative-glob.md). `docs/slices.md` carries the table of which surfaces accept which spelling.

## [0.34.0] - 2026-08-01

**Breaking.** Plan 0074 (R3b) completes [plan 0069](plans/completed/0069-no-rule-may-certify-nothing.md): a rule that cannot enforce anything now fails instead of passing. It reds on globs and selectors the adopting team wrote, and every one it reds on was already enforcing nothing.

**Run `ts-archunit doctor` on 0.33.x before upgrading** — it reports the dead-glob half of what this release will fail on, without a red build.

### Changed

- **A selector glob that can never match is a configuration finding.** Unsatisfiable in the project — a typo, a stale path — so the rule can never have subjects. `condition` and `exclusion` globs are unaffected: a condition glob matching nothing is indistinguishable from an armed tripwire that has not fired, and banning a folder before it exists stays legitimate.
- **An empty selection fails.** A condition reports a violation when _some_ subject fails; over an empty set that is vacuously false, so the rule passed. Exempt: a rule whose conditions **all** assert cardinality (`.notExist()`), where zero subjects is the assertion being satisfied.
- **One bad preset option is one finding.** A preset generates rules combinatorially, so one wrong character produced a finding per generated rule — measured at **83 findings from one bad `shared` glob** on this repository. They now collapse to one finding naming the option you wrote, with the affected rule count as context.
- Configuration findings from all three are **unsuppressable** — not by `.warn()`, `.asSeverity('warn')`, `.excluding()`, a baseline, or `--changed`.

### Added

- **`.expectEmpty()`** — assert a selector matches nothing, and fail the day it matches something. The escape hatch for a legitimately-empty selection, and an assertion rather than a silencer: an intent that expires reports itself. Declaring it with `.expectNonEmpty()` throws a `TypeError` when the rule is built.

### Deprecated in effect

- **`.expectNonEmpty()` is redundant.** It asks for what is now the default. Still legal, still reads as intent, no behaviour of its own.

## [0.33.0] - 2026-07-31

Both fixes came out of [plan 0074](plans/completed/0074-r3b-the-selector-glob-flip.md)'s gate run against a
real adopting codebase, and both were verified against that same input rather than against a
fixture.

### Fixed

- **`doctor` no longer blames the glob when the project loaded nothing** (bug 0031). A
  solution-style `tsconfig.json` — `"files": []` plus `"references"`, the usual monorepo root —
  loads no sources, so every glob is dead and none of them is the reason. Each one used to be
  reported with advice suggesting a misspelling, about correctly spelled globs, while `check`
  named the real cause in the same run. `doctor` now reports it **once per project**, names the
  config, and leaves the globs undiagnosed until something loads. A rule that asserts nothing is
  still reported alongside it, and a **syntactic** fault (`'./src/**'`) is still reported too,
  because no project could fix it.
- **A path that is absent gets its own advice** (bug 0032), instead of falling through to a
  three-cause list of which two are refuted by the absence. The text is scoped to what was
  actually searched — a bounded walk that skips build and vendor directories — rather than
  asserting a universal about the disk, and it names the glob-metacharacter cause (`(`, `)`, `{`,
  `}`, `!` in a folder name) that `check` already stated.
- **One text for "this project loaded nothing"**, shared by `diagnose()` and the slice builder's
  failing-`check` message. They were written separately and had already diverged, with the weaker
  wording on the surface that fails builds.

### Changed

- **`DiagnosticFinding['kind']` gains `'project-empty'`.** Source-breaking for TypeScript
  consumers with an exhaustive `switch` over the union, and it is part of `doctor --format json`'s
  contract. No enforcement change: `check` reports the same violations it did before.

## [0.32.0] - 2026-07-31

### Changed

- **`ts-archunit doctor` is a supported command, not a hidden experiment.** It is listed in
  `--help`, and the docs drop "experimental" for a stated scope. What it earns its slot for is a
  **dead glob**: a rule whose selector can never match certifies nothing, and `check` never calls
  `diagnose()` — measured, `check` exits 0 with no output on such a rule while `doctor` exits 1 and
  names the site. It remains a diagnostic you invoke, **not a build gate**; `check` is the gate.
  Rules hosted in a vitest or jest file cannot be loaded by the CLI — `diagnose()` reports the same
  findings there.
- **`doctor --format` is validated.** It accepted anything while the command was hidden, so
  `--format github` ran silently as terminal. It now takes `terminal` (default) or `json`, and
  rejects anything else the way `check` and `explain` do.

## [0.31.1] - 2026-07-31

Internal performance only — no API change, no baseline impact, no finding changes.

### Fixed

- **A body is walked once per kind, not once per matcher.** `notContain(call(x))` and its
  siblings walked a function body, then filtered the result with the matcher; the walk is a
  function of the node and the kind and only the filter differs, so N matchers over one body did
  N identical traversals. `agentGuardrails` pays for it directly — it emits one rule per banned
  API. Measured on a 530-file project: eight banned APIs **88 ms → 16 ms**, identical findings.
- **The same for the broad walk**, which `expression()` and `comment()` take because they have no
  syntax kinds to narrow by. The marginal broad rule goes from **~57 ms to ~17 ms**. Measured
  before deciding: of that cost the walk is roughly three quarters and the per-matcher filter is
  the rest, which is why only the walk is shared.
- Both caches invalidate per source file on modification, and `resetProjectCache()` clears them —
  a node's identity survives an edit to its own body, so keying on the node alone would have
  served pre-edit descendants.

## [0.31.0] - 2026-07-31

Two false greens closed, plus two internal caches. **Metric baselines are invalidated**;
everything else keeps matching. Read
[Upgrading](https://nielspeter.github.io/ts-archunit/upgrading) first.

### Fixed

- **Improving a metric no longer turns the build red**
  ([bug 0012](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0012-metric-findings-have-no-usable-ratchet.md)).
  Metric messages embed the measured value and a finding was identified by its message, so a
  class going from 10 methods to 8 was reported as **new** — paying down debt failed CI on every
  incremental step, which is why the size and concentration family sat at zero uses. Metric
  findings now carry a stable identity and the baseline records the accepted measurement:
  improving stays green, and only a regression past the accepted value fails. Ten conditions,
  including the two complexity ones whose message shape hid them from the original enumeration.
  - **The accepted value tightens only when you regenerate.** A class baselined at 10 that
    improves to 8 may regrow to 10 without failing. A `check` run is read-only and must not
    rewrite its own baseline.
  - **The identity carries the file path**, so two same-named classes in different files — or two
    `index.ts` barrels, or a `save` method on two repositories — do not share one entry.
  - The measurement is on the wire as `measured` in `--format json`.
- **An allowlist that tested no edges now says so**
  ([bug 0015](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md)).
  The `only*` family constrains edges, so a subject with none passes however broken the
  allowlist — and in a layered architecture the innermost layer is both the one an allowlist
  protects and the one most likely to have no outbound imports. Reported, never failed: for that
  family zero edges is maximal compliance, and every remedy failing could offer makes something
  worse. `--format json` gains a top-level `untestedAllowlists`; other formats get a stderr
  footnote naming the rules **and the cause** — "no imports at all", "excluded by
  `ignoreTypeImports`" and "none matched the allowlist glob" are three different situations, and
  only the first means the module is dependency-free.
- **Two published builder docstrings** were corrupted by a bad edit and shipped as fragments in
  `dist/*.d.ts` — the IDE hover for `modules()` and `calls()`. Restored, and guarded by a test
  that parses the JSDoc this package publishes.
- **The baseline-ratchet CI recipe in the docs could not work.** The published form compared the
  working tree to the index, so it exited 0 on every CI checkout regardless of what the PR did.
  Corrected, with the `fetch-depth` prerequisite it needs, and verified by running it.

### Added

- **Element collections and module edges are cached per project**
  ([plan 0075](https://github.com/nielspeter/ts-archunit/blob/main/plans/completed/0075-collect-elements-once-per-project.md),
  [plan 0076](https://github.com/nielspeter/ts-archunit/blob/main/plans/completed/0076-resolve-module-edges-once-per-file.md)).
  Measured on a 520-file project: five `calls()` rules went from 2,600 AST descendant queries in
  692 ms to 0 in 3 ms, and five whole-project `notImportFrom` rules from 10,545 symbol lookups in
  46 ms to 0 in 2 ms. The win tracks how much your rules overlap — many rules over the same
  subjects benefit, disjoint per-folder rules barely do. No verdict changes.
- `resetProjectCache()` clears those caches, which is the escape hatch if you build an
  `ArchProject` yourself and mutate the underlying ts-morph project between rules.
- `BaselineDelta` is exported, so `generateBaseline`'s return type has a name.

### Changed

- `formatViolationsJson` takes an optional third argument (the untested allowlists). Existing
  two-argument calls are unaffected.
- **`HASH_VERSION` 3 → 4.** Metric findings only; every other baseline entry is byte-identical
  and keeps matching. See [Upgrading](https://nielspeter.github.io/ts-archunit/upgrading).

## [0.30.0] - 2026-07-30

A custom predicate can finally tell `doctor` what glob it matches against. Additive and
opt-in — **no baseline impact, no enforcement change** unless you declare something.

### Added

- **`definePredicate` and `defineCondition` accept an optional `globs` argument**
  ([bug 0030](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0030-user-defined-predicates-and-conditions-cannot-declare-globs.md)).
  Both factories returned only the fields they were handed, so a custom path-matching
  predicate's glob never reached `globs()`, `doctor` or `diagnose()` — a typo narrowed the
  selection to nothing, the rule passed, and `doctor` exited **0** on it. Declare the glob and
  the same mistake is reported and exits **1**:

  ```ts
  const inGenerated = definePredicate<SourceFile>(
    "reside in '**/generated/**'",
    (file) => picomatch('**/generated/**')(file.getFilePath()),
    globNode({ glob: '**/generated/**', kind: 'file-path' }), // <- the new argument
  )
  ```

  The `kind` is **believed**, so it has to be right: `file-path` and `parent-dir` are checked
  against the project's paths, while `import-target` deliberately is not, because a bare
  specifier legitimately matches no path. A bare specifier declared `file-path` earns a false
  dead-glob report; a real path declared `import-target` is silently exempt. Declaring nothing
  is the honest choice when unsure — it is exactly the prior behaviour. Kinds and costs are
  tabulated in [Custom rules](https://nielspeter.github.io/ts-archunit/custom-rules#declaring-a-glob).
  - `defineCondition` takes the same argument, with one difference: a **condition** glob that
    matches nothing is deliberately not reported, because a denylist glob matching nothing is
    indistinguishable from a ban being respected. Declaring it makes it visible, not a finding.

### Fixed

- **A guard shipped in 0.29.0 could not fail.** The test asserting that a condition glob
  matching nothing produces no finding used an `import-target` glob — which has no path
  universe, so it was exempt by **kind** before position was ever consulted. Measured: removing
  the condition-position skip from `diagnose.ts` left that test green, so it proved an exemption
  it was not testing. Now also covered with `onlyBeImportedVia`, which declares `file-path` and
  is genuinely checkable, so the position is what does the work. No shipped behaviour was wrong;
  the guard for it was.
- **The `doctor` output in the docs is now the output `doctor` actually prints.** The first
  version was written from the formatter's source rather than captured from a run, and was wrong.

## [0.29.0] - 2026-07-30

Two fixes and one piece of plumbing. **This release invalidates dependency baselines** and no
printed text moves, which is exactly why it says so loudly. Read
[Upgrading](https://nielspeter.github.io/ts-archunit/upgrading) first.

**Before upgrading:** refresh the baseline on your current version and commit it separately.
If you are still on 0.27.x, come **straight here** — going by way of 0.28.0 costs you two
refreshes for one outcome.

```bash
npx ts-archunit baseline --output arch-baseline.json   # prints the delta it accepted
git commit -am 'chore: refresh arch baseline before upgrade'
```

### Fixed

- **Two dependency findings in one file can no longer share a baseline identity**
  ([bug 0028](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md)).
  A finding's identity was `element::message`, and a dependency message carries the element
  basename and the resolved target and nothing else — no line, no imported names, no edge kind.
  So `export { a } from './banned.js'` and `export { b } from './banned.js'` in one barrel hashed
  identically: one baseline entry accepted both, and fixing one left the other silently accepted.
  Dependency findings now carry a distinct `identity` built from the edge's imported names and
  line. **`HASH_VERSION` moves 2 → 3 and every dependency entry changes hash**, including ones
  that never collided. A 0.28.x baseline matches nothing, and a non-empty baseline that matches
  nothing at all now emits a diagnostic rather than reading as a clean run.
  - **A residual, stated:** for a static `import`, the recorded name is the _inward_ one, so
    `import { X } from 'm'` and `import { X as Y } from 'm'` in one file still share an identity.
    The barrel case this fixes uses outward names, which differ.
- **A rule file that stops evaluating partway now says so**
  ([bug 0029](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0029-a-throwing-warn-truncates-the-rest-of-the-rule-file.md)).
  Since 0.23.0 `.warn()` throws on a configuration finding. In a **self-executing** rule file —
  the shape `init` scaffolds — a throw at module scope aborts the module, so every rule declared
  after it was never evaluated while the output looked entirely ordinary. Measured on 0.28.0, the
  same two rules: the array-export shape reported **5** findings, the self-executing shape
  reported **1**, with four violations silently absent. The lost findings stay lost — nothing can
  recover them in that run — but the report now names the truncation and the rule file, because
  "fewer findings than yesterday" is the one outcome you must not read as progress.
- **Three `@example` blocks in `src/core/combinators.ts` did not compile.** They showed
  `.that(not(...))`; the working form is `.that().satisfy(not(...))`.
- **A documented example failed its own assertion.** `docs/running-in-tests.md` — the page that
  teaches you to check your rules enforce something — used `resideInFolder('src/domain/**')`
  under `expect(diagnose(rules)).toEqual([])`. Unanchored, that selects **0** modules where the
  anchored form selects 40, so `diagnose()` returned a finding and the example was red as
  written.

### Added

- **Conditions declare the globs they match against**
  ([plan 0073](https://github.com/nielspeter/ts-archunit/blob/main/plans/completed/0073-conditions-declare-their-globs.md)).
  Twelve conditions — the four dependency conditions, `onlyBeImportedVia`, both
  `resideInFile` / `resideInFolder` pairs, and three delegating aliases in the standard rules —
  now populate `Condition.globs`, so a rule's condition globs reach `globs()` stamped
  `position: 'condition'`. A `notImportFrom` rule exposed **zero** glob trees before this and now
  exposes its own. **No verdict changes**: `diagnose()` skips condition-position globs by
  decision, because a denylist glob matching nothing is indistinguishable from a ban being
  respected. This is the visibility half only.
- **A docs guard for glob syntax.** Every TypeScript fence in `docs/` is parsed, and a glob
  matched against an absolute path must be anchored. Parsing rather than line-matching is the
  mechanism, not a refinement of it: a line regex found 467 glob-ish literals and called 224
  unanchored, almost all falsely — import specifiers and rule ids. Parsing found the real
  population of **132** path-glob arguments, of which 9 were unanchored, 8 of those legitimately
  so, and 1 was the `running-in-tests.md` bug above.

### Changed

- `elementCondition` and `functionCondition` take an optional `globs` argument. Internal, but
  named here because the **public** `definePredicate` / `defineCondition` did **not** get one —
  see [bug 0030](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0030-user-defined-predicates-and-conditions-cannot-declare-globs.md).
  A custom path-matching predicate's glob is still invisible to `doctor`, which is a
  present-tense detection gap rather than a latent one.

## [0.28.0] - 2026-07-30

The second of [plan 0071](https://github.com/nielspeter/ts-archunit/blob/main/plans/completed/0071-one-definition-of-a-module-edge.md)'s two releases: **one definition of a module edge**, closing [bug 0022](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0022-forward-import-conditions-are-blind-to-reexports-and-dynamic-imports.md). This release **changes enforcement**. Read [Upgrading](https://nielspeter.github.io/ts-archunit/upgrading) first.

**Before upgrading, on 0.27.x:** refresh the baseline, commit it separately, and record your finding count.

```bash
npx ts-archunit baseline --output arch-baseline.json   # prints the delta it accepted
npx ts-archunit check 'rules/**/*.rules.ts' --format json > before-upgrade.json
git commit -am 'chore: refresh arch baseline before upgrade'
```

### Changed

- **Dependency conditions see every kind of module edge**, not just static `import` declarations. `notImportFrom`, `onlyImportFrom`, `dependOn` and `onlyHaveTypeImportsFrom` now also see `export … from`, `import()` and `type X = import('…').Y`. Before this, `export { x } from './banned.js'` crossed a banned boundary unflagged while the reverse graph saw it — one library, two definitions of "an import". Measured on this repository: **662 import declarations → 835 edges (+26%)**.
- **Barrels become dependency-bearing.** This repo's own `src/index.ts` went from **0 to 114** dependencies. That is the sentence that lets you predict your own diff: if you have barrels, they are where the new findings are.
- **`notImportFrom` / `importFrom` in _predicate_ position** (`.that().notImportFrom(…)`) see the same widened edge set, and they move subject sets in **opposite** directions. `notImportFrom` selects **fewer** subjects — a file whose only matching edge is a re-export now fails the predicate and drops out — so some rules quietly check less. `importFrom` selects more.
- **The reverse graph shares the same walk**, and counts `require` and type-only references as references. So `beImported()` / `noDeadModules()` report **fewer** orphans, and `.excluding()` entries you carry for modules only reachable via `require()` or a re-export are no longer needed.
- **`onlyBeImportedVia` no longer double-reports.** One importer with two edges to one target produced two byte-identical violations at the same `file:line`, and therefore two identical baseline hashes for one fact.
- Each new kind names itself in its message — `re-exports`, `dynamically imports`, `references the type from`. **`import` messages are byte-identical**, so existing baselined findings survive; the new kinds get distinct verbs precisely so they are reported as new rather than absorbed by an existing entry for the same module.
- `onlyHaveTypeImportsFrom` carries a **per-kind remedy** for the new kinds. A re-export's fix erases the dependency _and removes a runtime export_, so the remedy says to check consumers; for `export *` it is `export type * from`, the one-token form.

### Fixed

- Blinding the two main conditions now fails **110 tests across 25 files**, up from 38 across 12. Re-run per the plan's own instruction, because a release that added visibility without coverage would leave that number where it was.
- The dynamic-import resolver in the reverse graph was hand-rolled and skipped every non-relative specifier — bug 0014 in the reverse direction, so a module reachable only via `import('some-installed-pkg')` looked dead.

### ⚠️ Reversals — things that used to fail and now pass

- **`dependOn` is the one _guarantee_ reversal.** A runtime re-export or dynamic import now **satisfies** it, where before neither did. A **type-only** re-export still does not — `export type { X } from` is erased, so the module it claims to depend on never loads. Its JSDoc carries the per-kind table.
- `noDeadModules()` / `beImported()` report fewer orphans (above). One caveat in the other direction: resolution is now uniform through the compiler, which drops the old resolver's filename guessing — a module imported as `import('./foo')` **without** an extension now resolves to nothing and may be reported as dead. That only happens on code that already fails `tsc` (TS2835/2834).

### ⚠️ Do not baseline a barrel

Measured on this repo's `src/index.ts`: **114 findings, 87 distinct identities — 46.5% share an identity with a sibling.** A barrel re-exports many names from the same module, and a dependency message carries the basename and the resolved target only, so those findings are byte-identical and hash the same. Accept one entry and you accept its siblings, and a re-export added later is silently pre-accepted. Exclude the barrel by path — `.excluding()` matches `element` as a **basename**, so `.excluding('index.ts')` silences every `index.ts` in the project at once — or downgrade it with `.asSeverity('warn')`, which keeps printing. This is [bug 0028](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md); the release does not create it, but it moves its incidence from "uncommon" to "every barrel".

### What this release does NOT widen

Stated by name, because a partial widening that reads as complete is the same defect class it closes.

- **The slice graph** — `beFreeOfCycles()`, `notDependOn()`, `respectLayerOrder()` are still static-import-only. A barrel re-export is _the_ classic cycle, so `strictBoundaries` will report a barrel as a cross-boundary violation and the cycle it creates as absent, **in the same run**. Both `no-cycles` rules and `beFreeOfCycles()`'s JSDoc say so on every failure.
- **`require`** — classified and enforced by no dependency condition. `notContain(call('require'))` is the alternative, and it cannot express a path glob and does not match `import x = require('s')` at all. For that one form there is no way to ban a path.
- **`declare module './rel.js'`** — the compiler routes it away from the module-specifier list, so the walk structurally cannot see it.
- **Conditions you wrote with `defineCondition()`** — they still see whatever they ask for. If yours calls `getImportDeclarations()`, it reproduces bug 0022 inside your repository. `ModuleEdge` is not exported yet; say so on the issue tracker if you need it.
- **`import()` has no opt-out.** There is no `ignoreDynamicImports`, so "no static dependency on X, lazy loading allowed" is not expressible. If you rely on `import()` as a decoupling mechanism (`React.lazy`, route splitting, plugin registries), open an issue — that is the signal that decides whether the option ships.

### Performance

The walk is uncached. Measured **25–29%** over a preset run (34–40ms on a 137ms baseline), because the incremental cost over the old mechanism is near-zero — both pay the same checker warm-up. Two shapes cost more: a selector spanning the whole project (`modules(p).should().notImportFrom(…)` with no `.that()`), up to **4.8×**; and `.that().notImportFrom(…)` in predicate position, which walks every file one at a time. If a run got noticeably slower, that is where the time went, and the fix is a cache of resolution rather than of the walk.

### Re-run `explain --format agent`

Preset `imperative` strings now mean something wider. If you paste that output into a `CLAUDE.md` or similar, regenerate it — there is no refresh mechanism.

## [0.27.0] - 2026-07-30

The first of [plan 0071](https://github.com/nielspeter/ts-archunit/blob/main/plans/completed/0071-one-definition-of-a-module-edge.md)'s two releases: the instruments an adopter needs **before** 0.28.0 widens what counts as a module edge. Nothing here changes which findings a rule reports.

### Added

- **`docs/upgrading.md`** — one row per released version: does it change enforcement, and what must you do. Written because the per-release notes in this file, followed in release order, produce the wrong outcome: 0.19.0 says regenerate the baseline, 0.23.0 says regenerate, 0.24.0 says regenerate when convenient, and 0.28.0 will say regenerate **before** upgrading. Someone on 0.18.1 reading them in order regenerates last — after every widening — and silently accepts everything the newer releases added.
- **`BaselineDelta` and `formatBaselineDelta`** — what a `generateBaseline` call changed. `generateBaseline` now returns it instead of `void`, which is additive for existing callers.
- **`suppressionNotice` / `activeNotice`** in `core/diff-disclosure.ts`, and `size` / `baseBranch` on the `DiffFilterLike` interface (both optional, so a caller-supplied filter still satisfies it).

### Changed

- **`--changed` now says how many findings it suppressed.** It filters _reporting_, not evaluation, so a run with every finding suppressed was byte-identical to a clean run — exit 0, no output, `total: 0` — and the reader chose the flag once, in CI config. The count reaches stderr and `summary.reason` in `--format json`, because stdout and stderr are different streams and an agent piping one would otherwise read `total: 0` and stop. The count is derived by the caller as `before - after` rather than self-reported by the filter, so it holds for a caller-supplied `DiffFilterLike` too.
- **`.check({ diff })` and `.warn({ diff })` state the configuration once per process** rather than counting. `filterToChanged` runs once per rule there, so no call site knows the run total, and a diff-aware suite with 79 rules would print 79 lines on the channel 0.26.0 made unconditionally visible. A configuration statement cannot be wrong; a per-rule count presented as a run total would be.
- **`ts-archunit baseline` prints the delta it applied** — `41 → 78 entries (+37, −0)` — with distinct sentences for a first run, for a prior file that could not be read as a baseline, and for a refresh where no prior identity survived. That last case keys on the **measured overlap**, not on the hash version: v2 identities are byte-identical to v1 for any violation whose fields hold no path, so a version-keyed message would assert "none of its identities could be compared" beside `(+0, −0)`.

### Fixed

- **A run-level notice no longer becomes a violation's `Why:` line.** `writeReport`'s `reason` parameter is rendered per violation (`v.because ?? reason`), so routing the suppression notice through it both duplicated the line and attributed it to a finding it had nothing to do with. Found by the sabotage matrix, in this release's own code, before it shipped.

### Upgrading — 0.27.0

No action required. Two output changes:

- A `--changed` run that hides findings prints one extra stderr line, and `--format json` sets `summary.reason` where it was previously always `null`. Anything asserting `reason === null` on a diff-aware run needs updating.
- `ts-archunit baseline`'s first stdout line changed from `Baseline generated: N violations recorded` to one of the delta sentences above. Anything grepping that exact string needs updating.

## [0.26.0] - 2026-07-29

**An advisory rule in a passing test printed nothing at all** ([bug 0024](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0024-warn-terminal-is-invisible-inside-a-test-runner.md)). `.warn()` is the documented way to run a rule advisorily, and vitest's default reporter intercepts console output and replays it only for **failing** tests — so a rule with real violations in a passing test produced **zero** output. Measured on a real child `vitest run`: 4 violations, nothing printed. A team adopting the warn-then-ratchet path saw silence and concluded there was nothing to fix.

A minor rather than a patch: output that did not exist now exists, and anything parsing this library's stderr sees more of it.

### Fixed

- **Every library-originated message now goes through one stderr channel that survives a test runner.** Ten call sites across five files — wider than the reported `.warn()` case. The exclusion-comment parse warnings, `expression()`'s escape-hatch warning, the diff-aware git-fallback warning and the invalid-baseline warning were all invisible in a passing test too. **A stale `.excluding()` said nothing** — the one signal that an exclusion has rotted after a rename, unreachable in the runner where rules are written.

- **A piped run no longer dies of EPIPE.** This was a live defect before the fix, not a hazard introduced by it: `writeReport` already wrote to `process.stderr` unguarded, so `ts-archunit check 2>&1 | head` could fail from an uncaught EPIPE rather than from findings — and the exit code cannot tell those apart. Node's `Console` is built with `ignoreErrors: true`; a bare write is not, and the error arrives **asynchronously**, so neither `try`/`catch` nor the write callback can see it. Measured over 20 000 lines: bare write exits 1, guarded exits 0.

### Changed

- **`.warn()` output loses its vitest test attribution.** vitest annotates intercepted console output with the test that produced it (`stderr | file > test name`); a direct stderr write does not. For a violation report the rule's own identity is in the message, so the trade is small — and being attributed to a test that never printed would be worse than being unattributed. This is the accepted cost of the fix, stated rather than discovered.

- **`doctor`'s output and the violation report share that channel**, so both are EPIPE-safe. `console.error` in the CLI is deliberately left alone: `Console` is EPIPE-safe by construction and a terminal command is not running inside a test runner.

### Upgrading — 0.26.0

**Expect output where there was none.** Any `.warn()` in a passing test, and any stale-exclusion or diff-aware warning, now prints to stderr. If a CI job asserted on empty stderr, it will see content — that content is findings you already had.

If you assert on warnings in your own tests, they arrive on `process.stderr.write` rather than `console.warn`. Spying on `console.warn` will no longer see them, which is the point: a spy on the old channel proved the call and never the delivery, and 57 tests in this repository were doing exactly that.

## [0.25.0] - 2026-07-29

**Two defects in `strictBoundaries()` — one that told you the wrong fix, one that told you nothing at all.** A minor rather than a patch: the second adds an error-severity finding that can turn a currently-green run red, and `^0.24.0` would have resolved a patch silently into every consumer's CI.

**A preset's sanctioned `Fix:` line reproduced the violation it claimed to fix** ([bug 0017](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0017-boundaries-no-cross-boundary-message-overclaims-entry-point-enforcement.md)). `strictBoundaries()`'s `no-cross-boundary` rule is folder-level — a boundary may import itself plus the configured `shared` globs, so **any** import from another boundary violates it, whichever file it names. Its metadata described entry-point-mediated access, a looser policy the rule does not implement, and told the reader to "import from the other boundary's entry point instead of reaching into its internals".

Measured: `reporting → billing/index.ts` and `reporting → billing/internal.ts` fail **identically**. Applying the fix exactly produces the same violation with the same `Fix:` line, so an agent obeying it loops — edit, re-check, same failure — and its only exits are unsanctioned (baseline, exclude, disable).

### Fixed

- **The three strings on `no-cross-boundary` now describe the rule that exists.** The `suggestion` is **computed**, because no fixed text is right in both configurations: `shared` defaults to `[]`, which is legal, and there the old "move the shared piece into the shared module" named somewhere unreachable — measured, a boundary importing `src/shared/**` with `shared` unconfigured is itself a violation of this rule, so the sanctioned fix produced a _third_ finding. With `shared` configured the remedy now names the actual globs; with it empty it says so and points at `strictBoundaries({ shared })`.

  **Behaviour is unchanged and this is baseline-free.** `hashViolation` is `rule::element::message`; `because` and `suggestion` are not hashed. Verified by replaying an old-text baseline against the new text: **0** new findings.

- **A `strictBoundaries({ shared })` glob that matches nothing now says so** ([bug 0023](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0023-strictboundaries-shared-globs-are-raw-and-unguarded.md)). `shared` globs go into `no-cross-boundary`'s allow list and are matched against absolute resolved file paths, so a spelling that matches no file creates **no allowance** — and reported nothing about it. The user found out through false reds on the exact code the preset's own docs tell them to write, carrying the `no-cross-boundary` remedy above, which told them to move into the shared module they were already importing from.

  Measured, and note the middle two rows are indistinguishable from outside — same violation count, same silence:

  | option                          | shared import | config findings               |
  | ------------------------------- | ------------- | ----------------------------- |
  | `shared: ['**/src/shared/**']`  | passes        | 0                             |
  | `shared: ['src/shared/**']`     | **flagged**   | 0 → **1**                     |
  | `shared: ['**/no-such-dir/**']` | **flagged**   | 0 → **1**                     |
  | `folders: 'src/features/*'`     | —             | 1 (the guard `shared` lacked) |

  New finding id: `preset/boundaries/shared-discovery`, error severity, unsuppressable — the same treatment `folders` has had since plan 0067. **This can turn a currently-green run red**, and when it does, that run was enforcing something other than what its config said: the allowance never existed. The finding names the glob and the spelling that works.

  **Deliberately a guard and not normalization.** `folders` is not normalized either — its remedy states the absolute-path contract — and `atPath` (bug 0018) is about file-vs-folder globs, not relative-vs-absolute. Rewriting `shared` globs would have made one option on this preset accept a spelling the other rejects, which is a worse asymmetry than the one being fixed.

- **`explain --format agent` printed an identical bullet once per boundary.** A preset generates one rule per configured folder with identical metadata, so six boundaries put the same line into your agent's system prompt six times — tokens on every request, and it reads as six different rules. Deduplicated on the bullet **text**, not the rule id: two rules can share an id and differ in imperative, and dropping one of those would silently delete a rule from the instructions.

- **A docstring that would have made the above a breaking change.** `src/helpers/baseline.ts` claimed violation identity does not survive "rewording `.because()`". Measured false — two violations differing only in `because` hash identically, and so do two differing only in `suggestion`. It is the same defect shape as the bug itself (a claim about a mechanism that does not do what it says), sitting in exactly the place someone would check to decide whether this fix invalidates their baseline.

### Changed

- **`CHANGELOG.md` now ships inside the npm package.** Several releases require an action rather than merely describing one — 0.23.0 fails builds by design, 0.24.0 asks you to regenerate baselines — and those instructions were reachable only from GitHub. It is now readable at `node_modules/@nielspeter/ts-archunit/CHANGELOG.md`, which is where an agent inspecting the installed package looks. Adds ~30 kB to the tarball.

### Upgrading — 0.25.0

**If you committed `explain --format agent` output into an agent's system prompt, re-run it and replace the block.** `init` instructs users to do exactly that, so the old text is sitting in adopters' repositories as a _standing, proactive_ instruction:

```
- Do NOT import another boundary's internals — go through its entry point
```

An agent following it writes `import { x } from '../billing/index.js'`, and `check` then fails on the code the system prompt sanctioned — the guidance surface manufacturing the violations the enforcement surface reports. **Upgrading the package does not fix this on its own**: the committed block is a copy, and only re-running `explain` replaces it. The sentinel markers (`<!-- ts-archunit:start -->` / `<!-- ts-archunit:end -->`) delimit what to swap.

**If you use `strictBoundaries({ shared })`, check your run.** A `shared` glob that never matched anything is now reported instead of silently creating no allowance, so a green run can go red here. That is the allowance having never existed rather than anything new in your code — the finding names the glob and the spelling that works (`'**/'`-prefixed, ending in `/**`).

Nothing else to do. No enforcement changes, and existing baselines keep matching.

## [0.24.0] - 2026-07-29

**Three bugs in how a finding is located and diagnosed, bundled** — 0025, 0026 and 0027 are one subsystem, and releasing them separately would have cost consumers three version bumps for one area.

**One malformed rule no longer silences the run.** [Bug 0025](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0025-a-non-archruleerror-from-one-rule-file-drops-every-other-finding.md): `ts-archunit check` caught `ArchRuleError` and re-threw everything else, so any other error escaped the per-file loop and terminated the process — no report written, no exit code returned, and every finding already collected discarded. Measured on the real CLI: two rule files, the first holding a one-sided `correspondence()` with `.beComplete()`, the second holding four real violations. Before, a raw Node stack trace with `node_modules` paths and **zero** findings. After, five findings and exit 1.

A minor rather than a patch: a run that used to crash now reports, and `^0.23.0` would have resolved a patch silently into every consumer's CI.

### Changed

- **A rule file that cannot be evaluated is a configuration finding, not a crash.** It names the file, carries the error text as evidence, and the rest of the run still reports. Caught at the **two** boundaries that fail independently — loading (per file, the only attribution there is) and evaluating (per **builder**, so one malformed rule does not take its nineteen siblings in the same file down with it). Like every configuration finding it is `error` severity whatever the rule asked for, refused by `.excluding()`, and skipped by baseline and diff: a rule file that could not run enforced nothing, and that is not something to accept into a baseline.

  Its remedy is deliberately **conditional** — this fires for a syntax error, a missing dependency or a misconfigured builder alike, and asserting one cause for all of them is the ADR-008 rule 2 defect. The error message is the evidence; the builder sentence is offered as the common case.

  If you relied on `runCheck` rejecting so a wrapper script could catch it, it now resolves with a non-zero count instead. `ts-archunit baseline` gains the same treatment, where it matters twice over: a re-throw left **no baseline file at all**, so one malformed rule made the command unusable rather than producing a partial baseline you could finish.

- **A finding with no source location of its own now names the rule file it came from** ([bug 0026](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0026-a-location-less-finding-does-not-say-which-rule-file-it-came-from.md)). A configuration finding carries no location, because it reports a fault in the rule rather than in the code — so two identical vacuous rules in two rule files rendered as two identical paragraphs with nothing saying which to open. In a test the frame comes free from vitest; in the CLI, the golden-path default, nothing supplied it although the per-file loop knew and was discarding it.

  Stamped at that loop, with `line: 1` — the same choice `tsconfig()` makes for a fault belonging to a file rather than to a position in it. A violation that already has a location is untouched. `--format github` consequently emits a **file-level** annotation for these instead of one run-level line for the whole run.

  `doctor` gains the same attribution and prints the rule file first. It now diagnoses per rule file rather than flattening every file's rules into one array, which is what discarded the mapping. `DiagnosticFinding` gains an optional `ruleFile`; `diagnose()` never sets it, because it is handed rules rather than files and must not invent a path it cannot verify.

- **An unmatched baseline entry can be diagnosed** ([bug 0027](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0027-an-unmatched-baseline-entry-cannot-be-diagnosed.md)). A violation's identity includes the rule description, so editing a rule — or accumulating its conditions, which v0.23.0 made happen for a rule derived off a held rule — changes the identity of violations that did not change at all. Those entries stopped matching and their accepted violations reported as **new**, reading like fresh rot in application code, and the finding whose whole purpose is to explain this could not fire: it is gated on `matched === 0`, and this produces a partial miss.

  Baseline entries now record a `subject` hash — identity **without** the rule description — which is what separates the two cases that look identical from the outside:

  | the entry stopped matching because… | subject still in the run? | what you get                     |
  | ----------------------------------- | ------------------------- | -------------------------------- |
  | the violation was fixed             | no                        | silence — this is success        |
  | the rule's description changed      | yes                       | both spellings named; regenerate |

  `subject` is optional, so a baseline written before 0.24.0 still loads and simply cannot be diagnosed — honest degradation rather than a guessed cause. **Regenerate to get the diagnosis**; nothing else requires it.

  The specific diagnosis supersedes the generic `matched === 0` finding, and disproves it: that finding blames a differently-resolved repository root, and a matched subject proves the root is resolving consistently.

- **`correspondence()` with the wrong number of sides is a finding whether or not an assertion was chosen.** `.beComplete()` on a one-sided correspondence cannot assert anything — there is no second side to compare against — so `assertsSomething()` now returns `false` for wrong arity regardless, and the fault reports through the assertion gate with the remedy it already had (another `.side(...)`, never `.beComplete()`). v0.23.0 fixed only the no-assertion branch and disclosed this one as still throwing; that asymmetry is gone. **If you catch `RangeError` around `correspondence()`, it now arrives as an `ArchRuleError` configuration finding.**

### Fixed

Three output defects, each found by running the real CLI while fixing the above rather than by reading the code:

- **The default terminal format never printed a located violation's `message`** — for _every_ ordinary violation, not only new findings. The location slot rendered `file:line — element` and the message, the one sentence saying what is actually wrong, was rendered nowhere. `formatViolationsPlain` had always printed it, so the two formatters disagreed about what a violation is. Output gains one line per violation; nothing failed when this was fixed, because nothing pinned it either way.
- **`--format github` doubled the period** between a message ending in punctuation and its `Fix:` clause (`…(reading 'config').. Fix: …`). This is the one format that concatenates the parts onto a single line, so it owns the punctuation between them.
- **A configuration finding whose remedy IS its message printed it twice again.** Third occurrence in two releases, and this one was introduced _by_ the located-message fix above: the dedupe was conditioned on `!v.file`, which was correct only while located violations did not render their message. Removing that premise made the condition a defect. The guard now counts occurrences in **both** shapes — the previous version asserted the `Fix:` line was _present_ for the located shape, which a duplicate satisfies.

- **`ts-archunit baseline` printed refused findings without their rule file**, so attributing them there would have been invisible.

- **A rule-file failure named its own path four times** — in `rule`, in `element`, in the location line and in the remedy — and the location line runs it through `path.relative(cwd, …)`, so a rule file outside the cwd printed as `../../../../../../private/tmp/…`.

### Upgrading — 0.24.0

Nothing is required. A run that previously crashed now reports and exits non-zero; a run that was already green stays green.

**Regenerate your baseline when convenient.** Entries written before 0.24.0 carry no `subject`, so if a rule's description changes later, the re-reported violations cannot be explained — you get the bare re-report, which is what bug 0027 was about. Existing baselines keep matching either way: the hash function is unchanged and the identity format version is still 2.

Three behaviours to know about if you script around the CLI:

- `runCheck` / `runBaseline` no longer reject on an unexpected error from a rule file — they resolve with a non-zero count.
- Violation output is one line longer per violation (the message is now printed for located violations).
- `--format github` emits a **file-level** annotation for configuration findings from a rule file, where it previously emitted one run-level line.

## [0.23.0] - 2026-07-29

The flip [plan 0070](https://github.com/nielspeter/ts-archunit/blob/main/plans/completed/0070-a-rule-must-assert-something.md) measured for: **a rule that asserts nothing now fails.** 0.22.0 gave you the instrument to find these; this release stops them from certifying anything.

A rule with no condition selects some code and then asserts nothing about it, so it can never fail — and it is counted as a passing test. A suite of them reports coverage that does not exist, which is worse than no rule at all: nobody goes looking for a guard they believe they already have. That is [ADR-008](https://github.com/nielspeter/ts-archunit/blob/main/adr/008-agent-first-failure-surfaces.md) rule 1 applied to the library's own output.

### Changed

- **All seven assertion-less shapes are now configuration findings and fail on every terminal** ([bug 0019](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0019-a-rule-with-no-condition-passes-in-total-silence.md)). The finding carries the remedy for the shape you actually wrote — the table in 0.22.0's entry lists all seven — and there is **no way to downgrade it**: not `.warn()`, not `.asSeverity('warn')`, not `.excluding()`, not baseline, not diff-aware mode. Five of these were green before:

  | Shape                                                                | Before                                                    | Now                                               |
  | -------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------- |
  | `.should()` reached, no condition                                    | passed silently                                           | fails — add a condition                           |
  | a predicate after `.should()` (`areAsync()` filters, it asserts not) | passed silently                                           | fails — the misplaced predicate is named          |
  | a predicate after `.should()` **alongside a real condition**         | passed silently, having narrowed the selection to nothing | fails — move the predicate                        |
  | never reached `.should()`                                            | passed silently                                           | fails — add `.should()` and a condition           |
  | `tsconfig(p)` with no `.requires()`                                  | passed silently (**pinned by a test**)                    | fails — add `.requires({...})`                    |
  | `smells.inconsistentSiblings()` with no `.forPattern()`              | passed silently (**pinned by a test**)                    | fails — add `.forPattern(...)`                    |
  | `correspondence()` with two sides and no assertion                   | threw `RangeError`                                        | fails as an `ArchRuleError` configuration finding |
  | `correspondence()` with the wrong number of sides, no assertion      | threw `RangeError`                                        | configuration finding naming `.side(...)`         |

  The two rows marked **pinned by a test** were reversals of a documented, tested contract, not bug fixes: a test in this repo asserted that each of those produced no violations. Both are retired, and this row is the notice.

  Wrong arity **with** an assertion chosen still throws `RangeError` — measured. Adding `.beComplete()` does not fix a one-sided correspondence, so that fault keeps its own error and its own remedy. If you catch `RangeError` around `correspondence()`, the no-assertion cases now arrive as `ArchRuleError` instead.

  **The row in bold is the one that was not in the plan, and it is the worst of the eight.** Every other assertion-less shape looks unfinished; this one reads as deliberate:

  ```typescript
  functions(p)
    .that()
    .haveNameMatching(/^parse/)
    .should()
    .notExist()
    .areAsync()
  //   before: subjects 4 -> 0, violations 4 -> 0, diagnose() [], check() passed
  ```

  `areAsync()` after `.should()` is a predicate, so it retroactively narrows the set the rule's **conditions** are evaluated over — here to nothing, so `notExist` held vacuously and the rule went green. Its description even reads as intentional (`that have name matching /^parse/ and are async should not exist`), so nobody had a reason to look. `assertsSomething()` consulted the misplaced-predicate list only when there were **zero** conditions, so the release caught this shape in its harmless variant and missed it in the dangerous one. Found by a review of the release branch, measured, fixed there. Its remedy is "move it before `.should()`" and explicitly **not** "add a condition" — it has one.

  The finding is raised **before** the rule runs. A rule with both a dead glob and no condition now reports the missing assertion only — the right root cause, since no selector makes an assertion-less rule capable of failing. The selector fault resurfaces on the next run, once there is something to assert.

- **Conditions accumulate instead of clearing** ([bug 0020](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0020-should-twice-silently-drops-the-first-assertion.md)). A rule derived from a held rule kept the parent's predicates but silently dropped its conditions, so `parent.should().beExported()` followed by a derived `.should().notContain(...)` asserted only the second. Both are asserted now, and a second `.should()` on one chain behaves like `.andShould()`. A `satisfy(condition)` written **before** `.should()` is also retained rather than dropped. If you built rules this way expecting the reset, those rules now report violations they previously discarded.

- **Some baseline entries stop matching — the ones for rules whose description changed.** A violation's identity is a hash of `rule::element::message`, and `rule` is the rule's description. Accumulate lengthens that description for the two shapes it changes: a rule derived off a held rule that already carried a condition, and a `satisfy(condition)` written **before** `.should()` (previously dropped, now retained and fired). Those entries hash differently, so an already-accepted violation is reported as new.

  Regenerate with `npx ts-archunit baseline <rules> --output arch-baseline.json` (the `arch:baseline` script `init` scaffolds), or `generateBaseline(...)` in-process, and **review the diff** — the entries that vanish are exactly the rules whose descriptions changed. Every other entry still matches; the hash function is unchanged.

  The identity format version stays at **2** on purpose. An earlier cut of this release bumped it to 3 to signal the change, and two independent reviews measured that as a mistake worth naming here: `hashViolation()` never reads the version, so the bump changed no hash and matched no entry differently — while making the unmatched-baseline finding tell every user with a pre-0.23.0 file that the format was "the likely cause", which cannot be true, and burying the branch that names the cause that usually is (a differently-resolved repository root). A remedy that cannot remediate is precisely what this release exists to stop shipping (ADR-008 rule 2), including when we are the ones shipping it.

### Added

- **`remedyRepeatsMessage` and `severityFor` are exported.** Violation semantics an external renderer or aggregator cannot re-derive from the `ArchViolation` type alone: without the first it reprints a remedy already in the message (the defect fixed below, in our own three renderers), and without the second it grades a configuration finding by the severity the rule asked for, which `severityFor` exists to refuse.

### Fixed

- **The finding says there is no escape hatch, and links the rule.** It now ends with "This finding cannot be suppressed: not by `.warn()`, `.asSeverity('warn')`, `.excluding()`, a baseline, or diff-aware mode", and carries a `Docs:` link to the section stating the grammar. Measured before it was added: a reader given only the remedy tries `.asSeverity('warn')`, then `.excluding()`, then the baseline, then `--changed` — four CI cycles — because nothing told them those were refused. ADR-008 rule 3 requires saying so, and the release was shipping that rule while not obeying it.

- **`ts-archunit baseline` exits non-zero when a finding could not be baselined.** Configuration findings are deliberately not baselineable, and the command already said so clearly — then exited 0. `doctor` exits non-zero for exactly this reason ("an agent reads `exit 0` as nothing to do"), and this command sits on the documented upgrade path above: the blocker was printed, the baseline was committed, and the next `arch` job failed on findings the baseline was supposed to cover. The file is still written with everything that _could_ be baselined, so re-running after the fix is cheap.

- **The unmatched-baseline finding's own remedy now runs.** It printed `npx ts-archunit baseline --output <file>`, which exits 1 with "No rule files specified" unless a config supplies them — a remedy that cannot remediate, measured. It now names the rule-files argument.

- **`doctor` and the failure no longer print an empty rule name for a bare entry point.** `describeRule()` returns `''` for an entry point with no predicates and no conditions, and `''` is not nullish, so the `?? 'unnamed rule'` fallback was dead code — for precisely the shape the diagnostic exists to report.

- **A remedy identical to its message is no longer printed twice.** A configuration finding's fault and its remedy are one sentence, carried in both `message` and `suggestion` on purpose — a tool reads `suggestion`, a human reads the body. Every renderer printed the paragraph, then printed it again as `Fix:`. All three formatters (terminal, plain, GitHub annotations) now show it once; the fields are unchanged, so nothing a tool reads has moved. A located violation's `Fix:` line always prints, because that format never renders `message` for those.

### Upgrading — 0.23.0

**Silence → failure. Nobody had a runtime signal before**, so the safe order is to measure first:

```bash
npx ts-archunit doctor <your rule files>   # exits non-zero if it reports anything
```

Every remedy `doctor` prints is backward-compatible with 0.22.0, so the whole migration can land **before** you upgrade.

**If your rules live inside test bodies, do not use the pre-flight — upgrade on a scratch branch and run your suite.** `doctor` cannot load a file that imports vitest/jest, and on 0.22.0 the message it prints for that case says to "run your test suite instead; the runtime writes the same diagnostics to stderr" — which is **not true on 0.22.0**, whose whole contract is that no rule behaves differently. That text is already published and cannot be recalled; it becomes true on 0.23.0, where the gate does fail at runtime. So for this population: install 0.23.0 on a throwaway branch, run the suite, and every offender fails in its own test with its own file, line and code frame — better attribution than any diagnostic gives you.

The `diagnose([...])` array documented in [running in tests](https://nielspeter.github.io/ts-archunit/running-in-tests) still works, but note what it is: a second, hand-copied list beside the rules your tests actually run. It is green for every rule you forget to copy. Prefer the scratch-branch run, which cannot miss one.

If a reported rule is a deliberate placeholder, delete it or comment it out. If it is generated from configuration, skip generating it when there is nothing to assert.

If it comes from a **third-party preset** (`ruleId "preset/..."`), that is a bug in the preset and it needs reporting upstream — but you should not have to hold CI open until someone else cuts a release. Drop the broken rule by construction, using the same predicate the gate uses:

```typescript
// One rule in this preset asserts nothing — reported upstream at <issue link>.
// This drops that rule and keeps the other twelve.
export default acmePreset(p).filter((r) => r.assertsSomething())
```

That is exclusion by construction, not a suppression flag: it is visible in the rule file, it names nothing it cannot verify, and it keeps every other rule in the preset enforcing. **Scope it to third-party presets, with the upstream issue linked.** Applied to your own rule array it silently reinstates the exact false coverage this release removes — which is why there is no flag for it.

Then regenerate baselines (above), and expect new violations from any rule that was silently dropping its parent's conditions.

## [0.22.0] - 2026-07-29

The measuring instrument for [plan 0070](https://github.com/nielspeter/ts-archunit/blob/main/plans/completed/0070-a-rule-must-assert-something.md) is now complete: **`doctor` and `diagnose()` can see every rule that asserts nothing, and each one carries the remedy for its own shape.** No rule behaves differently in this release — 0.23.0 is the flip, and this is the release you measure on first.

### Added

- **`assertsSomething()` and `assertionAdvice()` on every builder**, so the diagnostic covers every family. Previously only the six `RuleBuilder` entry points were visible: slices, schemas, resolvers, `tsconfig()`, `correspondence()` and `smells.inconsistentSiblings()` all reported clean while asserting nothing. Seven assertion-less states are now distinguished, each with its own executable remedy:

  | Shape                                                                             | Fix it names                                            |
  | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
  | `.should()` with no condition                                                     | add a condition                                         |
  | a **predicate** used after `.should()` (`areAsync()` filters, it does not assert) | move it before `.should()` — the predicate is named     |
  | a rule that never reached `.should()`                                             | add `.should()` and a condition                         |
  | `tsconfig()` with no `.requires()`                                                | add `.requires({...})`                                  |
  | `smells.inconsistentSiblings()` with no `.forPattern()`                           | add `.forPattern(...)`                                  |
  | `correspondence()` with two sides and no assertion                                | `.beComplete()` / `.haveNoOrphans()` / `.beBijective()` |
  | `correspondence()` with the wrong number of sides                                 | add the missing `.side(...)` — **not** an assertion     |

  The advice comes from one method per builder, and `doctor` reports it verbatim, so the diagnostic and the eventual failure message cannot drift.

- **`describeRule()` on six more builders** (slices, schema, resolver, tsconfig, correspondence, inconsistentSiblings), so their findings are named by rule id or description instead of `unnamed`.

### Fixed

- **`doctor` no longer crashes on a file it cannot load** (a vitest test file, a syntax error, a missing dependency) — it reports the file with the error as evidence and continues with the rest. The remedy is offered conditionally rather than asserted, because the same branch fires for causes that have nothing to do with test runners.
- **`doctor` no longer exits 0 after reporting a problem.** With one unloadable file and one clean one it printed the error and then a clean bill of health, exit 0 — shipped in 0.21.0. Every exit path now folds the load failures in, and `--format json` emits its document on every path (it previously produced zero bytes on the commonest single-file failure, so `JSON.parse` threw).
- **`--format github` emits valid annotations for findings with no source location.** A configuration finding has no file, and `::error file=,line=0` is not a valid annotation — GitHub dropped or misplaced it. Those are now run-level annotations that render on the workflow summary. Property values (`file=`, `title=`) are also escaped per the workflow-command spec, so a path or rule name containing `,` or `:` no longer truncates the annotation.
- The old `console.warn(...) + return []` sites for condition-less rules are **removed** (proposal 019's ask). The `RuleBuilder` one could never fire for the commonest shape anyway — it was gated on a phase `.should()` had already left ([bug 0019](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0019-a-rule-with-no-condition-passes-in-total-silence.md), which 0.23.0 closes).

### Upgrading — 0.22.0

No rule changes behaviour, and nothing new throws. Two tool outputs change:

1. **`diagnose()` reports more.** Rules from the slice/schema/resolver/tsconfig/correspondence/smell builders that assert nothing now produce `no-condition` findings. If you pin `diagnose()` output in tests, those pins change (two of this repo's own did).
2. **`explain` names change** for the six builders that gained `describeRule()` — output that said `unnamed` now carries the rule id or description. And `doctor`'s exit code covers the newly visible states, for anyone who wired the experimental command into a pipeline despite the docs.

**To find what 0.23.0 will fail:** run `npx ts-archunit doctor <your rule files>`, or call `diagnose(rules)` in-process. For rules written inside a test body, `doctor` cannot load the file — pass the builders to `diagnose([...])` directly, or collect them into an array and use `checkAll`. Every remedy is backward-compatible on this version, so the whole migration can land before you upgrade again.

`assertsSomething()` and `assertionAdvice()` are new public methods on the exported base classes. An external subclass already declaring either name with an incompatible signature gets a compile error on this minor; one declaring neither is **exempt by default** (`assertsSomething()` returns `true`) — override it if your builder has an assertion-less state.

## [0.21.0] - 2026-07-28

A behaviour change, so a minor rather than a patch — `^0.20.0` would have
resolved a patch silently into every consumer's CI, and this one changes what
your rules **select**.

### Fixed

- **A configuration finding now carries its own remedy, not the rule author's** ([bug 0021](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0021-a-config-finding-prints-the-rule-authors-unrelated-remedy.md)). A finding reading `matching("src/nowhere/") resolved no slices` printed **`Fix: Split the cycle by extracting a shared module.`** — your remedy for a real violation of the rule, attached to a finding reporting that the rule never ran. `suggestion` renders as `Fix:`, which is the line an agent obeys, so this was a failure asserting a cause it could not verify.

  Every configuration finding — empty selector, empty slice discovery, empty correspondence side — now states the fix for _its own_ fault. Your `.rule({ suggestion, docs })` still reaches every real violation, unchanged; `id` and `because` still reach configuration findings too, because neither claims to be a remedy.

  If you parse `check --format json` and rely on `suggestion` being present and equal to your own text on **every** finding, it is now the finding's own text on the configuration ones.

- **A held builder is immutable** ([bug 0016](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0016-narrowing-a-named-selection-mutates-it.md)). Every chain method now returns a copy instead of editing the builder in place, so holding a selection in a variable and deriving several rules from it does what it reads like:

  ```typescript
  const repositories = classes(p).that().extend('BaseRepository')
  repositories.that().haveNameEndingWith('Legacy').should().notExist().check()
  repositories.should().beExported().check() // still ALL repositories
  ```

  Before this, the second rule silently inherited the first rule's narrowing and reported on a subset — or, when the two narrowings were disjoint, on nothing, and then **passed**.

  The same leak applied to `.excluding()` (a suppression leaked into every later rule off the same selection), `.rule()` (a leaked rule id, which makes an inline `// ts-archunit-exclude <id>` comment suppress a rule that never declared that id, and changes which preset `overrides` entry applies), `.expectNonEmpty()` (a leaked non-vacuity opt-in), `smells.*.ignorePaths()` / `.ignoreTests()` / `.withMinSimilarity()` / `.forPattern()` (an inherited _ignore_ or threshold is invisible and turns a later detector green), `calls().identifiedByArg()` (leaked call-identity folding), `correspondence().allowEmpty()` (a leaked opt-out from the empty-side guard) and `crossLayer().layer()` (an extra layer changes which pairs `mapping()` compares).

  The bug was reported against `RuleBuilder.that()`. Measured by a source sweep — now a test — it was **40 methods across 12 classes**, and **9 of those classes are outside `RuleBuilder`'s hierarchy**, so a fix there could not have reached them: `SliceRuleBuilder`, `SmellBuilder`, `DuplicateBodiesBuilder`, `InconsistentSiblingsBuilder`, `CorrespondenceBuilder`, `TsconfigBuilder`, `CrossLayerBuilder`, and both GraphQL builders — which forked in neither `that()` nor `should()`, and so accumulated every predicate _and_ condition of every rule derived from one held schema.

### Upgrading — your rules may now select different subjects

This release changes what some rules **check**, in both directions, with no code change on your part.

1. **Regenerate your baseline.** Baseline identity is a hash of the rule's _description_ — its predicate and condition text ([`hashViolation`](https://github.com/nielspeter/ts-archunit/blob/main/src/helpers/baseline.ts)) — not of `.rule({ id })`. A rule that was inheriting a leaked predicate had that predicate in its description, so its hash changes here and previously-baselined findings resurface as **new**. Delete and re-record the baseline as your first step, before reading any new findings. If your baseline stops matching entirely, the "unmatched baseline" finding will suggest a repository-root mismatch; on this upgrade that advice is wrong, and the cause is this change.

2. **Expect new findings — that is the fix working.** Any rule that was silently narrowed by a leak now evaluates its full selection. A rule that had been narrowed to nothing was passing while checking nothing; it now checks something and may fail. Those failures are real violations you have not seen before, not regressions in your code.

3. **If you use the GraphQL entry point, re-run and read both directions.** `docs/graphql.md` teaches deriving several rules from one held `schemaFromSDL()` / `resolvers()` result, and that hierarchy forked nowhere — so the second and third rule off a held schema received the intersection of every earlier predicate (usually empty, therefore passing) _and_ every earlier condition. Violation counts can now go **up** (rules that were selecting nothing) or **down** (rules that were red because of a neighbouring rule's condition). A count dropping there is not a fix; it means that rule was previously reporting someone else's finding.

4. **Find the one shape that breaks: a discarded return value.** The fluent form is unaffected, and so is the repeated-`.should()` reuse the docs already taught. What no longer works is discarding a chain method's result and expecting the change to have stuck:

   ```typescript
   const b = classes(p).that()
   b.extend('BaseRepository') // return value discarded — now a no-op
   b.should().beExported().check() // applies to ALL classes
   ```

   TypeScript will not flag this, so run `npx ts-archunit doctor <your rule files>` after upgrading. It reports rules that select elements but assert nothing, and rules whose globs cannot match — which is what a dropped `.should()...` or a dropped predicate turns into. One production site in this repo depended on that idiom (`src/presets/layered.ts`); `grep` found none in the docs.

## [0.20.0] - 2026-07-28

### Added

- **`ts-archunit doctor <rule-files>`** — reports which of your rules cannot enforce anything, without running them: a glob that can never match, and a rule that selects elements but asserts nothing about them. Exits non-zero when it reports anything, because an agent reads `exit 0` as "nothing to do". **Experimental**, and deliberately absent from `--help` — removing a documented command later is its own breaking change, and its future is undecided. Do not wire it into a pipeline.
- **`diagnose(rules)`** — the same thing in-process, for rules written inside vitest, which is a co-equal documented path. **Experimental**, and the shape may change: `diagnose(rules: RuleBuilderLike[]): DiagnosticFinding[]`, with `DiagnosticFinding` carrying `{ kind, rule, origin, glob, position, fault, onDisk?, advice }`. It reports identities, never totals.
- **The glob declaration model** — `DeclaredGlob`, `GlobKind`, `GlobNode`, `globAnyOf`, `negateGlobs`, `stampGlobs` and friends. Exported so a **custom predicate can declare the globs it matches against**, which is what makes it visible to `doctor`. A predicate that declares nothing is simply invisible; nothing breaks. Also experimental.

  Together these are the measuring instrument for a future release that will make a rule which can never match **fail**. Nothing fails yet. Run `doctor` now to find out what that release will cost you.

### Changed

- **A finding that a rule enforces nothing can no longer be downgraded or silenced.** These are _configuration_ findings — an empty selector, an empty slice discovery, an empty correspondence side, an empty layer, a baseline that matched nothing — and they report that the rule is not checking anything. They now always report at `error`, and `.warn()` throws for them.

  Three of the four ways to quiet a finding already refused: `.excluding()` says so out loud, baseline and diff skip them. `.warn()` was the gap, and five of the six producers set no severity at all, so on that path every one resolved to `warn` — a finding saying "this rule can never fire", reported as advice, on the surface the docs recommend for gradual adoption. An inline `// ts-archunit-exclude` comment cannot suppress one either; that was true only by accident before, because these findings carry no file path.

### Fixed

- **`notImportFrom('fastify')` now matches an installed fastify** ([bug 0014](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0014-bare-package-import-globs-match-nothing.md)). Import globs were matched against the resolved path **or** the raw specifier, never both — so a package that resolves, which is every package you actually depend on, could only be matched by its `node_modules` path. The documented way to ban a dependency worked exclusively on dependencies you had not installed. Measured against this repo's own source: `notImportFrom('picomatch')` reported **0** violations while 15 files imported it. It now reports 15, the same as the path-glob form `'**/picomatch/**'`.

  Each import now contributes **both** its resolved absolute path and — for non-relative specifiers only — the specifier as written; a glob matches the import if it matches either. Relative specifiers are deliberately excluded: `'../services/*'` is an unanchored glob that correctly matches nothing against an absolute path, and matching it against the raw string would make relative globs silently half-work.

  This unblocks `layeredArchitecture({ restrictedPackages })`, whose whole documented purpose — "glob → list of npm package name patterns" — was inoperable for installed packages.

- **A preset no longer silently enforces nothing when you name a file instead of a folder** ([bug 0018](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0018-data-layer-preset-silently-enforces-nothing-for-a-file-glob.md)). `repositories`, `shared` and the layer globs were matched against the file's **parent directory**, so a glob naming a file could never match — the preset generated its rules and checked nothing. Measured: `dataLayerIsolation({ repositories: '**/repositories/bad-repo.ts' })` reported **0** violations on a file that violates both its rules. It now reports 2. Directory globs are unchanged.

### Upgrading — `.warn()` can now throw

**`.warn()` can now throw.** Only for a configuration finding, never for an ordinary violation, and the thrown error carries **only** those findings — your ordinary violations are still logged exactly as before. `.severity('warn')` and `.asSeverity('warn')` reach the same place. `.violations()` remains the non-throwing programmatic surface.

There are five findings that trigger it, all pre-existing: empty selector (`.expectNonEmpty()`), empty slice discovery, empty correspondence side, empty cross-layer layer, and a baseline entry that matched nothing. If a rule of yours was warning about one of these, it was telling you the rule does not work — and now it fails instead.

**One hazard worth knowing** if you have a self-executing rule file: `rule1.warn(); rule2.check()` used to evaluate both, because `.warn()` could not throw. If `rule1` now throws, module evaluation stops and `rule2` is never registered. The `export default [rule1, rule2]` shape is unaffected, and the CLI reports the truncation rather than absorbing it.

### Upgrading — import globs now match bare package names

This changes results in **two directions**, and the second is easy to miss.

**Bans get louder (green → red).** `notImportFrom`, `notImportFromCondition` and `onlyHaveTypeImportsFrom` now match bare package names, so a ban you wrote against an installed package starts reporting. Those findings are real: the rule was enforcing nothing before.

**Allowlists get quieter (red → green).** `onlyImportFrom`, `dependOn` and the `importFrom`/`notImportFrom` **predicates** violate when _no_ matcher matches, so extra candidates can only reduce violations. If you worked around this bug by allowlisting `'**/node_modules/fastify/**'`, that keeps working — both candidates are tested — but an allowlist that was red purely because a bare name could not match is now green. Check any `onlyImportFrom` whose violation count drops.

**Baselines are unaffected.** Violation messages interpolate the resolved path first and fall back to the specifier only when the resolved path did not match, so every finding that existed before this release keeps its message and therefore its `hashViolation` identity. A test asserts that equivalence across this repo's whole import corpus.

**Docs corrected.** `docs/slices.md` and `docs/troubleshooting.md` described the old fallback accurately and drew the wrong conclusion from it — that a bare package name "works as written". It did not, unless the package was absent. The 0.18.1 entry below contains the same error; it is left as written, since it was true of that release's behaviour in the same misleading way.

## [0.19.0] - 2026-07-25

Makes `withBaseline()` work across machines, and makes three collectors see the
handler-map idiom they were blind to. Both were found by adopting 0.18.x on a
real codebase; see [bug 0010](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0010-violation-identity-embeds-absolute-paths.md)
and [bug 0013](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0013-resolvers-cannot-see-resolvers.md). Pre-1.0, so the
behavioural changes ship in a minor.

### Fixed

- **A baseline generated on your machine now matches in CI.** Violation identity is `rule::element::message`, and several producers interpolate **absolute file paths** into those fields, so the hash encoded the checkout directory. Measured across two checkouts of one commit: 1006 findings on each side, **0 shared identities**. `generateBaseline` had always relativised the stored `file` field "so they're portable across machines" and the hash defeated it on the next line. The repository root is now normalised out of all three fields before hashing.
- **Three further ways identity moved without the code changing.** A duplicate pair reported `A → B` or `B → A` depending on the order the filesystem enumerated the files; `"3 of 5 files in X use Y"` changed for every accepted finding in a folder when one unrelated sibling was added; and a cycle was reported as `c -> b -> a` or `b -> a -> c` depending on the traversal start. Pairs are now canonicalised, populations are out of identity, and cycles are rotated to a fixed starting point (rotation only — `a -> b -> c` and `a -> c -> b` traverse different edges and remain different findings).
- **`at line N` no longer decides identity, at any of the eight sites that emit one finding per match.** This was worse than a lost baseline entry: with matches at lines 2 and 4, inserting two lines above made the entry recorded for line 4 match the violation that used to be at line 2 — the baseline **accepted the wrong finding**, keeping a genuinely new violation green. Occurrences are now identified by their enclosing declaration plus an ordinal within it, so adding a match renumbers only that declaration rather than everything below it in the file.
- **`resolvers()` selects resolvers.** A resolver map is an object literal, so its resolvers are property values; the GraphQL entry point collected only named declarations. On a real 38-file resolver layer it selected **60 subjects, none of which was a resolver** — they were the mapping helpers beside them. Every rule written with it, including the DataLoader example in our own docs, was evaluating the wrong functions and reporting green.
- **The smell detectors and the presets see handler maps.** `duplicateBodies` returned **0** on two byte-identical object-literal handlers; `inconsistentSiblings` was blind to the same shape; and `agentGuardrails` / `recommended` — reaching functions through the `functions()` selector — missed every stub, generic error and empty body written as `{ POST: () => {} }`. That is the shape agents generate most, in the preset named for the mistakes agents make.
- **Object-literal functions are named by the binding that owns them** — `app.routes["/x"].GET`, not `routes["/x"].GET`. Two literals in one file that share a key name were both reported as the bare key: ambiguous in the output, ambiguous to `.excluding()`, and merged in duplicate-pair identity so accepting one finding silently accepted the other.

- **Every preset rule now fails with a remedy.** `collectRule` attached `{ id }` and nothing else, so all 37 rules `strictBoundaries` emits — and every rule in `layeredArchitecture` and `dataLayerIsolation` — reported a bare message with no `because` and no `suggestion`. ADR-008 requires a failure to carry its sanctioned fix, and a preset is the one place a user cannot supply one themselves: they did not write the rule. The empty-discovery meta-finding gained a `because` for the same reason.

### Added

- **`ArchViolation.identity`** — an optional canonical form that replaces `element` and `message` in the baseline hash, leaving rendered output untouched. Set it in a custom condition whose message names a population, an ordering or a coordinate; see [Custom rules](https://nielspeter.github.io/ts-archunit/custom-rules). It must be unique per finding within a rule: two findings sharing an identity are one violation to the baseline.
- **`withBaseline(path, { root })` and `generateBaseline(violations, path, { root })`** — override the repository root used for portable identity. You should not normally need it. The root is discovered from the nearest `.git`, then a monorepo marker (`pnpm-workspace.yaml`, `nx.json`, `lerna.json`, `rush.json`) or a `package.json` declaring `workspaces`, then the nearest `package.json` — and `generateBaseline` records where that root sat **relative to the baseline file**, which `withBaseline` then reuses, so the two ends cannot silently disagree. Note the CLI (`ts-archunit baseline` / `check`) does not expose `root`; use the programmatic API if the default is wrong for you.
- **`hashVersion` in the baseline file**, and a finding when a baseline matches nothing. If a non-empty baseline matches **zero** of a run's findings, that is reported as what it is, with the counts, rather than silently presenting every accepted violation as a regression.

### Upgrading

**Most baselines keep working. Regenerate if yours contains findings from the affected rules.**

v2 hashing is byte-identical to v1 for any finding whose fields contain no path, so the majority of baselines — `notContain(call('parseInt'))` and everything shaped like it — match exactly as before, and nothing will tell you to regenerate them. The families whose identity changes, and which therefore need one regeneration:

- `smells.duplicateBodies()` and `smells.inconsistentSiblings()`
- `strictBoundaries` (its discovered boundary folders are absolute, and reach identity through the rule description)
- module-, class- and function-level body analysis — `notContain()`, `useInsteadOf()`, `notHaveCallbackContaining()`, `notHaveArgumentContaining()`
- `slices().should().beFreeOfCycles()`

If a baseline stops matching entirely you will get a finding saying so, with the counts and the likely cause, instead of a wall of "new" violations.

**Not fixed: the size and complexity metrics.** `maxMethods`, `maxClassLines`, `maxParameters`, `haveMaxExports` and their siblings put the measured value in the message, so a class going from 10 methods to 8 is reported as a new finding — improving the code turns the build red. Regenerating does not help, and this release does not change it ([bug 0012](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0012-metric-findings-have-no-usable-ratchet.md)). Those rules remain effectively unbaselineable.

**Green → red, on unchanged code.** Three collectors now see functions they previously could not, so rules that were quietly passing may start reporting:

- `resolvers()` gains every resolver in a resolver map. Its findings are **real and previously unchecked** — no baseline absorbs them, and regenerating hides a layer that was never enforced. Read them before you accept them.
- `duplicateBodies` and `inconsistentSiblings` gain object-literal functions. Measured on a class-heavy codebase this was +3% (1019 → 1049 findings); on a project written in the handler-map style — Hono/Elysia route maps, `Bun.serve`, GraphQL resolvers, reducer maps — the detectors were previously blind to that code entirely, so expect a much larger jump. `duplicateBodies` is pairwise, so its cost rises with the square of the functions it can see: measured on this repository's own source, 267 findings in 609ms became 328 in 901ms.
- `agentGuardrails` and `recommended` gain handler-map functions, so stubs and generic errors written as object-literal properties now fail.

**Element names changed for object-literal functions.** They are now prefixed with the owning binding (`app.routes["/x"].GET`). If you `.excluding()` one by name, update the pattern.

## [0.18.1] - 2026-07-25

Fixes a family of glob defects in `slices()` and the agent-facing messages around
them, found by adopting 0.18.0 on a real codebase. See [bug 0009](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0009-slice-glob-conventions-diverge-and-remedy-misleads.md).

### Fixed

- **`slices().matching()` now resolves every spelling of the same intent.** Its glob was parsed twice, inconsistently: the picomatch pattern accepted a leading `**/`, while the slice-name step took everything up to the _last_ `/` and located it with a literal `indexOf`. Any glob with a leading globstar or a trailing/interior wildcard therefore matched files and then silently discarded all of them — 0 slices. `'src/features/*'`, `'src/features/*/'`, `'**/src/features/*'` and `'**/src/features/*/'` are now equivalent, from a single parse. **This makes the form used throughout the docs, the examples and `ts-archunit init` (`matching('src/features/*/')`) work for the first time.**
- **Empty-discovery remedies are derived from the actual globs, not one hardcoded string (ADR-008).** 0.18.0 told every caller to _"use `**/src/*`"_ — right for `assignedFrom()`, wrong for `matching()`, where following it turned a working rule into a silently empty one. Each branch now states only what it can verify: an unanchored `assignedFrom()` glob or a `./` segment (both named individually with their slice keys, and both a transformation you can check), an empty `assignedFrom({})`, a project that loaded 0 source files, a `matching()` glob with no directory prefix, and calling neither source at all. Anything else lands on a clause that lists likely causes **without asserting one** — asserting "the directory does not exist" or "append `/**`" was false for globs targeting a file and for directory names ending in `]` or `}`.
- **Config-level meta-findings are now visible in the default output.** The rich formatter never printed `violation.message`, so an empty-selector/discovery failure rendered as `:0 — <ruleId>` with the entire remedy invisible unless you used `--format json`. Findings with no source location now show their message in the location's place (and no misleading `:0`).
- **`.excluding()` can no longer silence a meta-finding.** Exclusions match against the violation message, which now quotes the user's own globs — so an unrelated path exclusion could incidentally suppress the guard that reports a rule enforcing nothing. `applyFilters` now honors `bypassFilters`, consistent with baseline and diff-aware.
- **Docs, examples and `init` templates now anchor their globs.** Every `assignedFrom()` / `layers` / `folders` / `shared` / `src` example used the project-relative form that matches nothing (`'src/services/**'`), including the code `ts-archunit init` scaffolds. New [Glob conventions](https://nielspeter.github.io/ts-archunit/slices) section and a troubleshooting entry for "Slice discovery matched no files"; `matching()`'s doc now states that the captured segment may be a **file** (a flat folder yields one slice per file, not one slice for the folder).

### Deferred

Two guards were prototyped for this release and withdrawn: failing when discovery yields exactly one non-empty slice (every inter-slice condition is then unfalsifiable), and failing when one slice is empty among populated siblings. Both catch real false-greens. Both fired on legitimate projects — a one-feature repo, a layer not created yet, and the `strict-boundaries` scaffold itself — with no opt-out, and their remedies were written for one input and emitted for all of them. They return once each remedy is executable data and an opt-out exists, mirroring `correspondence().allowEmpty(name)`.

### Upgrading

**Anchor your globs.** The single instruction that matters: every file-path glob needs `**/` (`'**/src/services/**'`, not `'src/services/**'`). That applies to `assignedFrom()`; every glob-valued preset option (`layers`, `folders`, `shared`, `src`, `include`, `repositories`, `typeImportsAllowed`, and the **keys** of `restrictedPackages`); path predicates like `resideInFolder()` / `resideInFile()`; and path-shaped import globs (`notImportFrom('**/src/repositories/**')` — a bare package name like `importFrom('fastify')` is fine, because unresolvable imports fall back to the raw specifier).

Fix them **all at once**: anchoring `layers` while leaving `shared` relative turns a silent no-op into a **false positive** on imports your own config permits. `matching()` accepts either spelling, and GraphQL's `schema()` / `resolvers()` globs are relative to the tsconfig directory. See [Glob conventions](https://nielspeter.github.io/ts-archunit/slices).

From **0.18.0**, two things can change a build's colour:

- Red → green: `matching()` globs that resolve for the first time now produce real slices. A rule whose glob had been mis-parsed may now legitimately pass.
- Green → red: an `.excluding()` that happened to match a discovery finding's text used to silence it and no longer can. The warning in that case now says the exclusion was refused rather than claiming it is stale.

From **0.17.x or earlier**, a mis-anchored slice rule used to pass _vacuously_. It will now either fail with the discovery guard (naming the glob at fault) or — if this release makes its glob resolve — start reporting **real** cycle/layer violations it never checked before. That is the intended outcome, but budget for it.

Note when baselining: discovery/empty-selector findings are deliberately **not** baselineable (they report that a rule enforces nothing), so `ts-archunit baseline` will not silence them — fix the glob instead. `baseline` now reports the count it actually wrote and lists each finding it refused, with the reason.

## [0.18.0] - 2026-07-24

Roadmap foundations F1–F4 and proposals 017/016/014 (see `plans/ai-era-product-direction.md`). All new/changed public API is additive except the ⚠️ breaking behavior changes noted below. Pre-1.0, so these ship in a minor.

### Added

- **`correspondence(p)`** — a coverage/relation primitive: `.side(name, selection, keyFn)` | `.side(name, keys)`, then `.beComplete()` / `.haveNoOrphans()` / `.beBijective()` (+ `.allowEmpty()`, `.distinctKeysOn()`). Compares two independently-derived key sets by identity (never count); an empty side fails (ADR-008). keyFn vocabulary `byName` / `byArg` / `byPropertyNames`; low-level `setCorrespondence()` core. (Proposal 017, plans 0064/0065.)
- **`RuleBuilder.subjects()`** — materialize the post-`.that()` filtered subject set (F1); **`.expectNonEmpty()`** — opt-in non-vacuity guard: an empty selector fails instead of passing vacuously. (Plans 0064/0067.)
- **`functions(p, { includeObjectLiteralFunctions })`** — opt-in (default off) collection of object-literal function values (`{ GET: () => {} }`), named by qualified key path; shared `collectObjectLiteralFunctions` traversal. First options object on `functions()`. (Proposal 016, plan 0066.)
- **`ArchViolation.bypassFilters`** — config-level meta-findings (empty selector/discovery) now survive diff-aware and baseline filtering. (Plan 0067.)

### Changed (⚠️ BREAKING — empty discovery now fails instead of passing)

- **`slices().matching()` / `.assignedFrom()`** that resolve to no slices (or slices with no files) now **fail** with a discovery meta-finding, where they previously passed vacuously. Fix the glob (globs match absolute paths — use `**/src/*`, not `src/*`).
- **`crossLayer` `haveMatchingCounterpart`** now **fails** when the left layer matched zero files (was a vacuous pass). Reconciled onto the shared `setCorrespondence` core; non-empty behavior is unchanged.
- **`strictBoundaries`** now emits a `preset/boundaries/discovery` failure when the `folders` glob matches no boundaries, instead of silently generating zero rules.

Migration: a mis-globbed layer/boundary/slice that was silently green will now go red — correct the glob (usually add the `**/` prefix). These findings bypass diff/baseline, so they surface even in PR-only CI.

### Fixed

- `docs/functions.md` overclaimed "every function shape"; corrected to "every _named_ function shape" (a live zero-subject false-green for object-literal handler maps).

## [0.17.0] - 2026-07-14

### Added

- **`ts-archunit init` scaffolds the shape presets** — `--preset layered` | `strict-boundaries` | `data-layer` now generate an `arch.rules.ts` that spreads the `recommended` floor **plus** the chosen shape preset, pre-filled with folder globs (derived from your source root) and a one-line "edit these to your project" note. Unblocked by the returning-form migration (0062); completes the preset family on the `init` golden path. (Plan 0062, Phase 5.)

## [0.16.0] - 2026-07-14

### Changed

- **⚠️ ACTION REQUIRED (BREAKING) — shape presets now RETURN rules instead of throwing.** `layeredArchitecture`, `strictBoundaries`, and `dataLayerIsolation` now return `RuleBuilderLike[]` (like `recommended` / `agentGuardrails`) instead of `void`-and-throwing. **A bare `layeredArchitecture(p, {...})` call no longer fails your test — it silently enforces nothing. You must update every call.** Migrate: spread into a rule file (`export default [...layeredArchitecture(p, opts)]`), or in a test add `import { checkAll } from '@nielspeter/ts-archunit'` and wrap it: `checkAll(layeredArchitecture(p, opts))` (see [Running Rules in Tests](https://nielspeter.github.io/ts-archunit/running-in-tests)). This makes every preset composable on the CLI golden path, fixes `arch:baseline` crashing on a shape preset, and routes their `warn`-default rules (`type-imports-only`, `no-duplicate-bodies`) through the severity pipeline instead of dropping them to `console.warn`. `dispatchRule` and `throwIfViolations` are removed from `@nielspeter/ts-archunit/presets`.

### Added

- **`checkAll(rules, options?)`** — a test-file terminal for an array of rules (e.g. a spread preset): runs them all and throws one aggregated `ArchRuleError` on any error-severity violation; warns are reported but never fail. Exported from `@nielspeter/ts-archunit`. (Plan 0062.)

### Docs

- **Documentation restructured around a golden path** — one reconciled workflow (CLI rule file as the default, test files as a co-equal alternative with a conversion guide), a new Getting Started, Setup & Best Practices, Running Rules in Tests, and Troubleshooting, a four-tier IA (Introduction / Guide / Rule Catalog / Reference), and the galleries merged. (Plan 0061.)

## [0.15.0] - 2026-07-13

### Added

- **`tsconfig(p)` config-assertion rule** — assert a project's resolved TypeScript compiler options with `.requires(spec: Partial<CompilerOptions>)`. A flat top-level entry point (like `project` / `smells`) returning a `TerminalBuilder`, so it composes with `.because()` / `.rule()` / `.excluding()` / `.asSeverity()` / `.check()` / `.warn()` / baseline / diff. Mirrors tsc's strict-family resolution (`strict: true` implies its nine sub-flags — `strictNullChecks`, `strictBuiltinIteratorReturn`, etc. — with explicit overrides winning), resolves `extends`, deep-compares array/object options, and renders enum-backed options (`target`, `module`, `moduleResolution`) by name in messages. One violation per mismatched flag (flag name is the `element`). Exported from `@nielspeter/ts-archunit`. (Plan 0055.)

## [0.14.0] - 2026-07-13

### Added

- **`ts-archunit init` CLI scaffolder** — one command generates a working setup: a discoverable `ts-archunit.config.ts`, an `arch.rules.ts` that spreads a returning-form preset (`--preset recommended` (default) | `agent-guardrails`), an empty `arch-baseline.json`, and `arch` / `arch:baseline` npm scripts. Detects the source root from tsconfig `include`/`rootDir` and threads it into the preset `include`. Non-destructive by default (`--force` to overwrite, `--dry-run` to preview); `--tsconfig` and `--no-baseline` supported. Shape presets are excluded from v1 (no returning form). Brownfield-aware closing message (errors fail CI, warnings don't; baseline before gating CI). (Plan 0050.)

## [0.13.0] - 2026-07-13

### Added

- **`recommended(p, options?)` preset** — a deliberately thin, universal safety floor for any TypeScript project: `functionNoEval` + `functionNoFunctionConstructor` (error), `functionNoSilentCatch` + `noEmptyBodies` (warn). Returns severity-carrying builders (`export default [...recommended(p)]`); ids `preset/recommended/*`; opt-in-ladder severity via `overrides`. Exported from `@nielspeter/ts-archunit/presets`. Overlaps `agentGuardrails` on empty-bodies + eval. (Plan 0049.)
- **`agentGuardrails(p, options)` preset** — a one-liner bundling the mistakes AI coding agents make most often (inline logic, generic errors, stub comments, empty bodies, copy-paste). Returns severity-carrying builders (`export default [...agentGuardrails(p, { … })]`); each rule carries agent-facing `because` / `suggestion` / `imperative` metadata. Exported from `@nielspeter/ts-archunit/presets`. (Plan 0044.)
- **`explain --format agent`** — emits an imperative "Do NOT … / MUST …" markdown block for AI-agent system prompts / project instructions, with a check-in-loop preamble and `<!-- ts-archunit:start/end -->` sentinel markers for idempotent updates. Backed by a new optional `imperative` field on `RuleMetadata` / `RuleDescription` (with a heuristic fallback). See the new **AI Agents** guide.
- **`codeFrame` in `check --format json`** — each violation now includes the source snippet, so an agent can locate it without re-reading the file.
- **Rule severity in the CLI** — `.asSeverity('error' | 'warn')`, a non-terminal builder method that marks a rule's severity _without_ executing it, so severity-carrying builders can be collected into a rule file's `export default` array. `check` reports **warn**-severity violations but they never fail the run; only **error**-severity violations set a non-zero exit. `ArchViolation` gains an optional `severity` field. (Plan 0060.)
- **Single-document, severity-aware `check --format json`** — the JSON output is now one document for the whole run (previously one blob per rule, which was not valid JSON for multi-rule files), and it is **always emitted, even on a clean run** (`{ "summary": { "total": 0, … }, "violations": [] }`) so consumers can parse the success case. Each violation carries `severity`; the summary reports `{ total, errors, warnings, reason }`. Intended for CI tooling and AI coding agents that consume the JSON to self-correct.
- **`check --format github` respects severity** — warn-severity violations render as `::warning` annotations (previously every violation was emitted as `::error`).
- **`check` runs preset-returning rule files** — a rule file can `export default [...myPreset(p)]` where the preset returns severity-carrying builders. A file that instead self-executes a throwing preset at import is handled by a best-effort catch (error-severity only).

### Fixed

- **Rule metadata now reaches per-violation output** — `.because()` and `.rule({ because, suggestion, docs })` previously flowed only to `explain` and the error header, never to individual violations, so `check --format json` returned `suggestion: null` even when the author set one. Per-violation `because` / `suggestion` / `docs` now fall back to the rule metadata when the condition sets none (per-violation values still take precedence). This affects **all** output formats — terminal, `github`, and `json` — and in-test `.check()` / `.warn()`, not only the CLI: violation output now includes the author's `Fix:` / `Docs:` lines where it didn't before. Snapshot tests or log-parsers keyed on the old violation text may need updating.

### Changed

- **`check` collects `.violations()` instead of calling `.check()` per builder** — it gathers every builder's violations into one unified list, then filters / formats / exits once. Single-rule behavior is unchanged; multi-rule `--format json` is now a single valid document. `collectViolations()` (used by `baseline`) likewise switched to `.violations()`.

## [0.12.0] - 2026-07-03

### Added

- **`jsxText()` matcher** — detects hardcoded JSX text content: `JsxText` children of JSX elements (`<button>Save</button>`), plus expression-wrapped literals (`<div>{"Save"}</div>` and ``<div>{`Save`}</div>``). Skips inter-element whitespace, dynamic expressions (`{count}`, `{t("save")}`), templates with substitution, and attribute values (braced or quoted) — those remain the domain of the `jsxElements()` entry point. Composes with `notContain()` for i18n enforcement. Takes no options and bakes in no letter filter — scope with folder/file predicates or `.excluding(...)`. Complements the existing `jsxElement()` matcher.

## [0.11.0] - 2026-06-13

### Added

- **`calls().identifiedByArg(index)`** — opt-in builder method that folds a string-literal argument into the violation `element` and `message`, so identity-keyed registrations (HTTP routes, event handlers, command names, registry entries, DI tokens, migration ids, etc.) can be excluded individually rather than only by file. Default behavior unchanged. The element field preserves the literal verbatim (exclusion stability); rendered violation messages elide the middle of literals longer than 80 characters. Predicates continue to see the bare callee — use `withStringArg(i, glob)` or `withArgMatching(i, pattern)` to filter by argument value. See proposal 011 / plan 0057 for the design, the 8-case generic-pattern table, and the edge-case behavior matrix.

## [0.10.0] - 2026-04-17

### Added

- **`typeAssertion()` and `nonNullAssertion()` matchers** — compose with any body-analysis entry point (`classes`, `functions`, `modules`, `within()`). `typeAssertion()` matches both `as Type` AND `<Type>value` angle-bracket forms. `typeAssertion({ allowConst: false })` bans `as const` too; default `true` allows `as const` as idiomatic literal preservation.
- **Function and module variants of the TypeScript rules** — `functionNoTypeAssertions()`, `functionNoNonNullAssertions()`, `moduleNoTypeAssertions()`, `moduleNoNonNullAssertions()` exported from `@nielspeter/ts-archunit/rules/typescript`. Mirror the class/function/module family pattern used by `rules/security.ts` and `rules/errors.ts`.

### Breaking

Two user-visible behavior changes to `noTypeAssertions()` / `noNonNullAssertions()`:

- **Scope widened** — they now scan constructors, getters, and setters in addition to methods. This is a bug fix (matches the scope of `noSilentCatch()`), but existing codebases with a clean baseline will see new violations for assertions inside ctors/getters/setters. **Action:** regenerate your baseline (`npx ts-archunit baseline`) before upgrading to absorb the new coverage.
- **Violation message format changed** — from `${Class}.${method} uses type assertion — use type guards instead` to `${Class} contains type assertion at line N`. Consistent with every other rule in `rules/security.ts` and `rules/errors.ts`.
  - If you use `.excluding('UserService.load')` with the `Class.method` format, those exclusions will no longer match. Migration options:
    - **Class-wide (over-broad):** `.excluding('UserService')` — exempts every method in the class
    - **Method-precise:** use inline `// ts-archunit-exclude` comments on the specific lines, OR file+line-based exclusion patterns
  - Add `.because('use type guards instead')` to restore the actionable hint in violation output.
  - Snapshot tests and log-parsers keyed to the old message format will need updates.

### Changed

- `rules/typescript.ts` refactored from custom `evaluate()` logic to matcher composition — ~60 LOC removed, aligns with the pattern used across the rest of `rules/`.

## [0.9.0] - 2026-04-12

### Added

- **`jsxElements(p)` entry point** — new rule builder for JSX element architecture rules. Operates on `JsxElement` and `JsxSelfClosingElement` nodes across all `.tsx`/`.jsx` files. Enforces design system compliance, accessibility attributes, and structural JSX conventions.
- **`ArchJsxElement` model** — wraps JSX elements with `getName()`, `isHtmlElement()`, `isComponent()`, `hasAttribute()`, `getAttribute()`, `getAttributeNames()`, `hasChildren()`. Dot-notation tags (`motion.div`, `Icons.Check`) are always classified as components. Spread attributes safely skipped via `Node.isJsxAttribute()` type predicate.
- **`STANDARD_HTML_TAGS` constant** — array of all standard HTML tag names per the WHATWG HTML Living Standard. Use with `areHtmlElements(...STANDARD_HTML_TAGS)` for unambiguous "all standard HTML" matching that excludes custom elements and dot-notation components.
- **JSX predicates:** `areHtmlElements(...tags)` (requires at least one tag), `areComponents(...names?)`, `withAttribute(name)`, `withAttributeMatching(name, value)`. Distinct `with*` naming for predicates avoids dual-use confusion with conditions.
- **JSX conditions:** `notExist()`, `haveAttribute(name)`, `notHaveAttribute(name)`, `haveAttributeMatching(name, value)`, `notHaveAttributeMatching(name, value)`. Violations delegate to core `createViolation()` for code frames. Distinguishes absent, valueless, and wrong-value attributes in messages.
- **`jsxElement(tag)` body-analysis matcher** — `ExpressionMatcher` targeting JSX elements by tag name (string or regex). Integrates with existing `notContain()`/`contain()` on `functions()`, `modules()`, `classes()` entry points.
- **`JsxRuleBuilder`** — extends `RuleBuilder<ArchJsxElement>` with identity predicates (`haveNameMatching`, `resideInFile`, `resideInFolder` — predicate-only, following `CallRuleBuilder` pattern), JSX-specific predicates, and JSX conditions.
- **Documentation:** `docs/jsx.md` (full JSX rules page with tag classification, attribute access, predicate/condition naming rationale, `jsxElement()` matcher, `STANDARD_HTML_TAGS`, `.excluding()` incremental adoption, known limitations). Updated `getting-started.md`, `what-to-check.md`, `api-reference.md`, `recipes.md` (Design System Compliance recipe).

## [0.8.0] - 2026-04-12

### Added

- **`workspace(tsConfigPaths)`** — load multiple tsconfigs into a unified project for monorepo-aware dead-code and unused-export detection. Returns a standard `ArchProject` so all existing entry points and conditions work unchanged. Paths are sorted for deterministic compiler-option selection. Cached per unique set of tsconfigs; `resetProjectCache()` clears both caches.
- **`dependOn(...globs)`** — new condition asserting a module imports from at least one path matching the given globs. Completes the import-condition family alongside `onlyImportFrom` (all) and `notImportFrom` (none). Supports `{ ignoreTypeImports }` for consistency with the family.
- **`silent(pattern)`** — wrapper for `.excluding()` patterns that suppresses the "unused exclusion" warning. Designed for intentionally broad patterns shared across monorepo workspaces where not every workspace triggers every pattern.
- **Dynamic `import()` detection** — `beImported()` and `noDeadModules()` now resolve dynamic `import()` expressions with string-literal and no-substitution template-literal specifiers. Handles `.js→.ts`, `.jsx→.tsx`, `.mjs→.mts` ESM extension mapping and `/index.ts` directory imports.

### Fixed

- ESLint config now ignores `dist/`, `coverage/`, and `docs/.vitepress/` build artifacts, preventing `npx eslint .` failures on generated files.

### Changed

- Reduced cognitive complexity in 7 functions by extracting helpers: `indexStaticImports`, `indexReExports`, `indexDynamicImports` (reverse-dependency), `formatSingleViolation` (format), `handleBlockEnd`, `handleBlockStart`, `handleSingleLine` (exclusion-comments), `passesFileFilters`, `meetsMinLines` (duplicate-bodies), `partitionByPattern`, `buildFolderViolations` (inconsistent-siblings), `handleCheck`, `handleBaseline`, `handleExplain` (CLI).
- Removed 23 unnecessary non-null assertions (`!`) across the codebase, replaced with proper narrowing guards and `?? default` patterns (ADR-005 compliance).
- Merged duplicate imports in `fingerprint.ts`, `schema-rule-builder.ts`.
- Added `readonly` to `_predicates`/`_conditions` in GraphQL rule builders.
- Replaced `localeCompare` sort with locale-independent codepoint ordering where determinism across OS locales matters.
- Added `noSilentCatch` documentation to `standard-rules.md` and `api-reference.md` (was missing since v0.7.2).

## [0.7.2] - 2026-04-02

### Added

- **`noSilentCatch()`, `functionNoSilentCatch()`, `moduleNoSilentCatch()`** (plan 0045) — detect catch blocks that don't reference the caught error variable. Catches silent error swallowing: `catch { return fallback }`, `catch (err) { throw new AppError('failed') }`. Handles simple bindings, object/array destructured bindings. Class variant scans methods, constructors, getters, and setters. New `src/conditions/catch-analysis.ts` with `findSilentCatches()` core detection.

### Fixed

- **BUG-0008: `.excluding()` now works with `satisfy()` conditions.** `getElementName()` resolves inner AST nodes (e.g., `AsExpression`, `CallExpression`) to their nearest enclosing class/method/function, producing qualified names like `MyService.doWork` instead of raw AST kind names. This makes `.excluding('MyService')` and `.excluding('MyService.doWork')` work as expected for all conditions, including `noTypeAssertions()`, `noNonNullAssertions()`, and custom `createViolation()` calls.
- **Element names now include constructors, getters, setters, and property initializers.** `getElementName()` handles `ConstructorDeclaration` (→ `ClassName.constructor`), `GetAccessorDeclaration`, `SetAccessorDeclaration`, and `PropertyDeclaration` (→ `ClassName.propName`). Arrow functions and function expressions assigned to variables are also resolved (→ `handlerName`).

### Changed

- Refactored `getElementName()` into three focused helpers: `getNodeName()` (direct name extraction), `getStructuralName()` (member-level identity for ancestor walking), `isTopLevelDeclaration()` (walk boundary detection). No public API changes.

## [0.7.1] - 2026-03-30

### Changed

- Reduced cognitive complexity in 8 functions by extracting helpers: `applyTypeImportRules`, `applyRestrictedPackages`, `applySharedIsolation`, `applyTestIsolation`, `addToGraph`, `findUnusedExportsInFile`, `matchPropertyValue`, `matchPropertyName`, `collectEdgesFromFile`, `scanParametersForType`, `collectByKind`, `collectBroad`, `collectModuleScopeMatches`
- Eliminated nested template literals in `call.ts`, `dependency.ts`, `members.ts`, `reverse-dependency.ts` by extracting to variables
- Merged duplicate imports in `cross-layer.ts`, `function-rule-builder.ts`
- Added `readonly` to `_exclusions` in `TerminalBuilder` and `_conditions` in `SliceRuleBuilder`
- Used `this` return type in `CrossLayerBuilder.layer()`
- Reworded JSDoc in `matchers.ts` and `hygiene.ts` to avoid false-positive SonarLint stub-comment warnings

## [0.7.0] - 2026-03-30

### Added

- **Architecture rule primitives** (plan 0041) — phase-aware builders with dual-use predicate/condition dispatch based on `.that()` / `.should()` context. Methods `notImportFrom`, `resideInFile`, `resideInFolder`, `haveNameMatching`, `extend`, `implement`, `haveMethodNamed` now work in both phases across 4 builders.
- **Module body analysis** — `modules().should().notContain()` / `contain()` / `useInsteadOf()` with `{ scopeToModule: true }` option for top-level-only scanning.
- **Export conditions** — `notHaveDefaultExport()`, `haveDefaultExport()`, `haveMaxExports(n)` on module builder.
- **Reverse dependency conditions** — `onlyBeImportedVia(...globs)`, `beImported()`, `haveNoUnusedExports()` with cached reverse import graph.
- **Stub detection** — `comment()` matcher, `STUB_PATTERNS` constant, `notHaveEmptyBody()` on functions and classes.
- **19 standard rule variants** (plan 0042):
  - Function variants: `functionNoEval`, `functionNoFunctionConstructor`, `functionNoProcessEnv`, `functionNoConsoleLog`, `functionNoConsole`, `functionNoJsonParse`, `functionNoGenericErrors`, `functionNoTypeErrors`
  - Module variants: `moduleNoEval`, `moduleNoProcessEnv`, `moduleNoConsoleLog`
  - New class rules: `noConsole` (all console methods), `noJsonParse`
  - Architecture primitives: `mustCall(pattern)`, `classMustCall(pattern)` — positive body assertion
  - Hygiene rules: `noDeadModules()`, `noUnusedExports()`, `noStubComments(pattern?)`, `noEmptyBodies()`
  - Sub-path exports: `./rules/architecture`, `./rules/hygiene`
- **3 architecture presets** (plan 0040):
  - `layeredArchitecture(p, options)` — layer ordering, cycle detection, innermost isolation, type-import enforcement, restricted packages
  - `dataLayerIsolation(p, options)` — base class extension, typed error enforcement
  - `strictBoundaries(p, options)` — no cycles, no cross-boundary imports, shared isolation, test isolation, copy-paste detection
  - Override system: per-rule severity (`'error'`, `'warn'`, `'off'`)
  - Sub-path export: `./presets`
- **`.violations()` terminal** on `RuleBuilder` and `TerminalBuilder` — returns violations without throwing for programmatic access and preset aggregation.
- **`dispatchRule()` + `throwIfViolations()`** — aggregated error reporting across multiple preset rules.
- **`ts-archunit explain` CLI subcommand** (plan 0043) — dumps active rules as JSON or markdown table via `.describeRule()` without executing them. Supports `--markdown` flag.
- **`.describeRule()` method** on `RuleBuilder` and `TerminalBuilder` — metadata extraction without rule execution.
- **3 new VitePress doc pages** — presets guide, architecture recipes, explain command reference.
- **Comprehensive documentation overhaul** — added explanatory descriptions to 45+ sections across 18 doc files. Every section now explains what the feature does and why before showing code.
- **36 dogfooding rules** — ts-archunit enforces its own architecture with function/module security rules, hygiene checks, preset isolation, and export hygiene.
- 7 deprecated aliases for backwards compatibility: `notImportFromCondition`, `shouldResideInFile`, `shouldResideInFolder`, `conditionHaveNameMatching`, `shouldExtend`, `shouldImplement`, `shouldHaveMethodNamed`.

## [0.6.0] - 2026-03-28

### Added

- **Type-import awareness** (plan 0038) — `notImportFrom`, `onlyImportFrom`, `importFrom`, and `notImportFrom` predicates now accept `{ ignoreTypeImports: true }` via `ImportOptions`. Type-only imports (`import type { X }` and `import { type X, type Y }`) are excluded from violation checks. Builder methods: `notImportFromConditionWithOptions`, `onlyImportFromWithOptions`, `importFromWithOptions`, `notImportFromWithOptions`.
- **`within()` object literal callback extraction** (plan 0039) — `extractCallbacks()` now searches object literal arguments for function-valued properties (arrow functions, function expressions, method shorthands). Depth-limited to 3 levels. Enables `within(routes).functions()` for Fastify-style `{ handler: (req) => { ... } }` patterns.
- **`isTypeOnlyImport(decl)`** utility — shared helper for checking if an import is purely type-only. Exported for custom condition authors.
- **`ImportOptions`** type — exported for custom condition/predicate authors.

### Fixed

- **`expression()` ancestor deduplication** (plan 0037) — `expression()` matcher no longer reports violations for every ancestor node whose `getText()` contains the pattern. Only the deepest matching node is reported. **Note:** existing rules using `expression()` will see lower violation counts (e.g., 189 → 13 for a real-world case). Update baseline files or count assertions accordingly.
- **`onlyHaveTypeImportsFrom` now handles `import { type X, type Y }`** — previously only checked declaration-level `import type`, now uses the shared `isTypeOnlyImport` helper for consistent behavior.

## [0.5.0] - 2026-03-28

### Added

- **`property()` ExpressionMatcher** (plan 0036) — match `PropertyAssignment` nodes by name (`string | RegExp`) and optional value (`boolean | number | string | RegExp`). Semantic comparison for primitives via `getLiteralValue()`, `RegExp` escape hatch for raw text. Handles quoted property keys, guards against computed property names.
- **`haveArgumentContaining(matcher)` / `notHaveArgumentContaining(matcher)`** (plan 0036) — 2 new conditions on `calls()` that recursively search all argument subtrees with any `ExpressionMatcher`. Superset of `haveCallbackContaining` — searches object literals, callbacks, and nested expressions at any depth.
- Builder methods `haveArgumentContaining()` / `notHaveArgumentContaining()` on `CallRuleBuilder`
- Standalone exports `callHaveArgumentContaining` / `callNotHaveArgumentContaining` for advanced composition

## [0.4.0] - 2026-03-27

### Added

- **Unified combinators** — `not()`, `and()`, `or()` now accept both `Predicate<T>` objects and `TypeMatcher` functions, dispatching based on input type
- **Aliased import condition** (plan 0035) — 1 new condition on `modules()`:
  - `notHaveAliasedImports()` — detect `import { x as y }` aliased named imports
- Architecture rule: `core must not import from helpers`

### Removed

- `notType` export — use `not()` directly, which now handles both predicates and type matchers

### Fixed

- BUG-0007: `not(matching(...))` now works with `haveReturnTypeMatching()` and all TypeMatcher-accepting conditions

## [0.3.0] - 2026-03-27

### Added

- **Member property conditions** (plan 0030) — 6 new conditions on `types()` and `classes()`:
  - `havePropertyNamed(...names)` / `notHavePropertyNamed(...names)` — assert property name existence
  - `havePropertyMatching(pattern)` / `notHavePropertyMatching(pattern)` — assert property names by regex
  - `haveOnlyReadonlyProperties()` — assert all properties are readonly (supports `Readonly<T>` mapped types)
  - `maxProperties(n)` — assert property count limit
- **Parameter type conditions** (plan 0031) — 2 new conditions on `classes()` and `functions()`:
  - `acceptParameterOfType(matcher)` / `notAcceptParameterOfType(matcher)` — assert parameter types using TypeMatcher
  - Class version scans constructor + methods + set accessors
- **Visibility predicates** (plan 0032) — 3 new predicates on `functions()`:
  - `arePublic()` / `areProtected()` / `arePrivate()` — filter by member visibility
  - `getScope()` added to ArchFunction interface
- **Return type condition** (plan 0033) — 1 new condition on `functions()`:
  - `haveReturnTypeMatching(matcher)` — assert return type using TypeMatcher (composable with `isString()`, `matching()`, `not()`, etc.)
- **Call argument conditions** (plan 0034) — 2 new conditions on `calls()`:
  - `haveArgumentWithProperty(...names)` / `notHaveArgumentWithProperty(...names)` — assert object literal argument properties
- `PropertyBearingNode` type exported for custom condition authors

### Changed

- Package renamed from `ts-archunit` to `@nielspeter/ts-archunit` — all import paths updated

### Removed

- `ts-archunit/rules/dependencies` sub-path export — `onlyDependOn`, `mustNotDependOn`, `typeOnlyFrom` were pure aliases of `onlyImportFrom`, `notImportFrom`, `onlyHaveTypeImportsFrom`. Use the core primitives directly.

### Fixed

- BUG-0002: Property name checking no longer requires custom `defineCondition`
- BUG-0003: Constructor/function parameter type checking no longer requires body string matching
- BUG-0004: Multi-tenant method parameter checking composable via `arePublic()` + `acceptParameterOfType()`
- BUG-0005: Method return type checking no longer requires 30-line custom conditions
- BUG-0006: Call argument property checking no longer requires 40-line AST traversal

## [0.2.0] - 2026-03-26

### Added

- Function signature predicates (plan 0029):
  - `haveRestParameter()` — matches functions with `...args` parameters
  - `haveOptionalParameter()` — matches functions with optional or default-valued parameters
  - `haveParameterOfType(index, matcher)` — type-checks parameter at position using TypeMatcher
  - `haveParameterNameMatching(regex)` — matches parameter names by pattern
- Builder methods on `FunctionRuleBuilder` for all 4 new predicates
- Dogfooding architecture rule: module predicates must not accept single `glob` parameter
- `.notImportFrom()` and `.importFrom()` now accept multiple globs (variadic)

### Fixed

- `.excluding()` now matches against `violation.element`, `violation.file`, and `violation.message` (was element-only, BUG-0001)
- `.notImportFrom('fastify', 'knex', 'bullmq')` no longer silently ignores arguments 2+

## [0.1.0] - 2026-03-26

### Added (post-v1: plans 0027, 0028)

- CLI watch mode: `npx ts-archunit check --watch` / `-w` — debounced file watcher with automatic re-run
- `watchDirs` config option for `defineConfig()` — configure which directories to watch
- `resetProjectCache()` — clear the project singleton cache (for watch mode and tests)
- `ts-archunit/rules/metrics` — metric-based standard rules:
  - `maxCyclomaticComplexity(n)`, `maxClassLines(n)`, `maxMethodLines(n)`, `maxMethods(n)`, `maxParameters(n)` (class-level)
  - `maxFunctionComplexity(n)`, `maxFunctionLines(n)`, `maxFunctionParameters(n)` (function-level)
- Metric predicates: `haveCyclomaticComplexity`, `haveComplexity`, `haveMoreLinesThan`, `haveMoreFunctionLinesThan`, `haveMoreMethodsThan`
- `cyclomaticComplexity()` and `linesOfCode()` helpers exported for custom metric rules
- `docs/cli.md` — full CLI documentation page
- `docs/metrics.md` — full metrics documentation page

### Fixed (post-v1)

- `.excluding()` now matches against `violation.element`, `violation.file`, and `violation.message` (was element-only). Fixes BUG-0001: `defineCondition` violations can now be excluded by file path or message content.

### Added

- `project('tsconfig.json')` — load a TypeScript project with singleton caching
- `modules(p)` — module-level rules with dependency conditions (`onlyImportFrom`, `notImportFrom`, `onlyHaveTypeImportsFrom`)
- `classes(p)` — class rules with predicates (`extend`, `implement`, `haveDecorator`, `areAbstract`, etc.) and conditions (`shouldExtend`, `shouldHaveMethodNamed`, etc.)
- `functions(p)` — function rules supporting both `function` declarations and `const` arrow functions, with predicates (`areAsync`, `haveParameterCount`, `haveReturnType`, etc.)
- `types(p)` — type rules for interfaces and type aliases, with type matchers (`isString`, `isUnionOfLiterals`, `not`, etc.) and `havePropertyType` condition
- `slices(p)` — slice-level rules with `matching()` and `assignedFrom()`, conditions: `beFreeOfCycles`, `respectLayerOrder`, `notDependOn`
- Body analysis: `call()`, `newExpr()`, `access()`, `expression()` matchers with `contain()`, `notContain()`, `useInsteadOf()` conditions
- Identity predicates: `haveNameMatching`, `resideInFile`, `resideInFolder`, `areExported`, etc.
- Custom rules: `definePredicate()`, `defineCondition()`, `.satisfy()`
- Violation reporting with code frames, ANSI colors, `.check()` / `.warn()` / `.severity()`
- Named selections for reusable predicate chains

### Fixed

- Runtime warning when `.check()` is called with predicates but no conditions (prevents silent no-op rules)
- `.check()` now honors `format: 'json'` option (previously only `.warn()` did)
- `.check()` now prints rich format (Why/Fix/Docs) to stderr before throwing
- Duplicate Reason/Suggestion lines removed from terminal violation output
- `diffAware()` error fallback no longer silently suppresses all violations
- Inline exclusion comments (`// ts-archunit-exclude`) now work across all builder types
- `.excluding()` API available on all builders (GraphQL, cross-layer, smell detectors)
- Shell injection vulnerability fixed in `diffAware()` — uses `execFileSync` instead of shell interpolation
- `FORCE_COLOR=0` correctly disables color output (previously enabled it)
- `extendType()` predicate uses word-boundary matching to avoid false positives
- Slice violation line numbers now point to the actual import declaration
- Baseline file loading validates JSON structure instead of unsafe cast
- `fork()` preserves `.because()` reason across `.should()` boundary
