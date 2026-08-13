# Plan 0090 — a `.warn()` that expires

**Status:** DONE (v0.61.0). Implemented and reviewed 2026-08-13 (architect + testing personas; the
architect's Critical finding — reproduced independently before fixing — and the testing persona's
Important findings are all fixed and sabotage-verified; see **Review findings, fixed** below). Design
settled the same day before implementation — see **Design, resolved** below. Scoped for this pass: Phases
1 and 2 (the primitive itself), plus a Phase 3 proof scoped to `tests/archunit/dogfood.test.ts` only (5
`gate()` sites, self-contained). `tests/archunit/arch-rules.test.ts`'s much larger migration (44 sites,
entangled with its own `PLANTED` ratchet and a source-text terminal-count guard) is deliberately deferred
to a named follow-up rather than attempted in the same change — a decision, not an omission.
**Priority:** Medium-high. It is the generic brick this project found, needed, and then solved only for
itself.
**Effort:** Medium. The mechanism is small; the design question — what makes a warning _accountable_ — is
the work.
**Blast radius:** **Published API, and a gate on the thing that hides regressions.** New surface, so
additive; but if the expiry ever _fails_ a build it becomes a gate, and
[ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 6 already names "a check with a scheduled expiry"
as its own blast-radius row. That row exists in the ADR and nothing in the API implements it.

## Problem

[Plan 0084](./0084-cycle-detection-that-ignores-type-only-imports.md) fixed this, for us:

> `arch/no-cycles` sat at `.warn()` for months behind a comment saying _"switch to .check() when
> beFreeOfCycles ignores import type"_. While it could not fail, it let a **new** cycle in overnight —
> plan 0082's fix added the value edge that closed one, and nothing failed, because nothing could.

The fix was `gate()` returning `{ check }`, making `.warn()` unrepresentable in our own architecture suite.
Good fix. **It does not generalise**: it is a repo-local test-harness type trick that no consumer can reuse.

And the problem is not ours. It is what every adopter does with a rule they cannot turn on yet — and
`docs/upgrading.md` actively teaches it:

> `.asSeverity('warn')` … Then ratchet.

The library ships nothing to make that ratchet visible. No expiry, no required reason, no `doctor` finding
for a long-lived warning, no way to distinguish "warning because the finding needs human judgement" (which
rule 1 permits) from "warning because we have not got round to it" (which is the state that let a cycle in
overnight). Those are different things wearing the same spelling.

## Phase 1 — decide what makes a warning accountable

The design question, and the plan is mostly this. Candidates, none obviously right:

- **An expiry date.** `.asSeverity('warn', { until: '2026-12-01' })` — after which it fails. Honest and
  brutal; the failure mode is a build that reds on a date change with no code change, which teams learn to
  extend rather than fix.
- **A required reason plus a ticket.** `.asSeverity('warn', { because: '…', tracking: 'bugs/0054' })`, with
  `doctor` reporting warnings whose tracking document no longer exists — reusing the machinery that already
  detects an exclusion naming a rule nobody declares.
- **A count ceiling.** Warn while there are ≤ N findings, fail on N+1. Catches the _regression_ case
  specifically — a new cycle arriving overnight — which is the case that actually bit us, and leaves the
  existing debt warning.
- **Reporting only.** `doctor` names every warning, its age (from git blame) and its finding count. No new
  failure mode; relies on someone reading it, which is the thing that failed for months.

**Recommendation: the count ceiling plus reporting.** It targets the measured failure — a warning accepting
something _new_ — rather than the moral failure of having debt, and it needs no dates. The expiry variant is
the one to argue about; do not ship both.

Whatever is chosen, `.warn()`'s current meaning must not change silently. This is additive surface, and the
existing spelling keeps working.

## Phase 2 — distinguish the two kinds of warning

ADR-008 rule 1 permits a warning for _"a finding the reader must judge"_. It forbids one for an actionable
finding. Nothing in the API records which a given warning is, so the ADR's distinction is unenforceable and
in practice unmade.

Give it a spelling. `advisory()` vs `deferred()`, or one method with a discriminated reason. Then:

- an **advisory** warning is permanent and needs no expiry — it is doing its job;
- a **deferred** warning is debt and gets whatever Phase 1 chose.

This is the part that turns the ADR row into API rather than prose.

## Phase 3 — dogfood by deletion

The proof is removing our own local mechanism. `gate()` returning `{ check }` should become unnecessary:
express the same constraint through the shipped API, and delete the trick. If it cannot be expressed, the
API is wrong and Phase 1 has to be revisited — that is the test, and it is worth more than any assertion.

Note what `gate()` gets right and must be preserved: it fails through **two independent channels** (a
typecheck error and a runtime error). A shipped equivalent has only the runtime channel, so it needs to be
correspondingly harder to ignore.

## Design, resolved

**Phase 1's own recommendation (a bare count ceiling) is rejected, and this codebase already argues why.**
`tests/archunit/dogfood.test.ts`'s duplicate-bodies test carries this exact sentence: _"pinning a count
ceiling is exactly ADR-008 rule 5's anti-pattern: a ceiling reads as coverage while a real regression can
still hide under it."_ A bare `≤ N` ceiling is identity-blind: finding A disappears, a genuinely new
finding B appears, the count stays N, the ceiling never trips — which is bug 0084's own regression shape,
reproduced by the mechanism meant to prevent it. **The mechanism is an identity-based accepted list
instead**: `.asSeverity('warn', { accepted: readonly string[] })`. A violation stays at `warn` while its
subject is in `accepted`; anything not in `accepted` — a genuine new finding — escalates to `error`. This
is `Baseline`'s own `isKnown()` idea (warn/accept while known, red the moment something new or regressed
appears), without the ceremony the plan's own Out-of-scope section rules out: no file, no CLI flag, no
generation step — `accepted` is a plain array literal in the same call, checked into the rule file itself
and visible in code review, which a baseline file (often gitignored, machine-regenerated) is not.

**The subject a violation is matched on is `subjectOf(violation)`** (`src/core/violation.ts`, already
exported, already what `Baseline` itself matches on before hashing) — `violation.identity ??
\`${violation.element}::${violation.message}\``. Reusing it rather than inventing a second notion of
"identity" keeps `accepted`in the same vocabulary a baseline file or a printed violation already uses,
and it is never`undefined`, so every violation is matchable.

**Phase 2's spelling: the discriminator is the presence of `accepted`, not a second method name.**
`.asSeverity('warn')` (no options) is unchanged from today — permanent, no ceiling, doing exactly what
ADR-008 rule 1 permits for a finding the reader must judge. `.asSeverity('warn', { accepted })` is the
new, accountable state — debt, with a ceiling. Overloads make `{ accepted }` a compile error on
`.asSeverity('error', …)`, where it would mean nothing:

```ts
asSeverity(level: 'error'): this
asSeverity(level: 'warn', options?: { accepted?: readonly string[] }): this
```

This is additive by construction: every existing `.asSeverity('warn')` call keeps behaving exactly as
today (test inventory #5), because the new field is simply `undefined` unless a caller opts in.

**Where the mechanism lives: `.violations()` only — `.check()`/`.warn()` are untouched.** Measured before
designing this: `TerminalBuilder.check()`/`.warn()` already hardcode their own severity
(`executeCheck`/`executeWarn` stamp `'error'`/`'warn'` directly) and ignore `_severity` entirely — that is
deliberate, existing, heavily-relied-on behavior (a test author can force-`.check()` any rule regardless of
its configured default severity). `.asSeverity()` only ever mattered through the **aggregating** surfaces —
`.violations()`, `checkAll()`, the CLI `check` command — all three of which already call `.violations()`
per rule and read its stamped `severity` field. So the new escalation logic is one change, inside
`TerminalBuilder.violations()`'s existing severity-stamping step, computing a **per-violation** fallback
(`'error'` if `subjectOf(v)` is missing from `accepted`, else `'warn'`) before calling the existing
`severityFor()`. `checkAll()` and the CLI need zero changes — they already read whatever `.violations()`
stamps. `.check()`/`.warn()` need zero changes either, and their existing contract (always error, always
non-throwing-on-ordinary-violations respectively, regardless of any `.asSeverity()` call) is preserved
exactly.

**Reporting (test inventory #3): a new `DiagnosticFinding` kind, `'deferred-warning'`, following the
`inertAdvice()`/`zeroSubjectsAdvice()` recipe exactly** — a public `deferredWarningAdvice(): string` on
`TerminalBuilder`, returning `''` when nothing is wrong, non-empty when at least one current violation's
subject is not in `accepted`. Implemented by calling `this.violations()` (the same pipeline `checkAll`/CLI
check already run) and checking which ones came back `severity === 'error'` — one source of truth, not a
second derivation of "is this accepted" that could drift from the first. Fires **only** when the ceiling is
actually breached, matching every other kind in `diagnose()` (`inert`, `zero-subjects`, `dead-glob`): each
one previews an upcoming `check()`-time failure, none of them report a rule that is currently fine. A
deferred warning with nothing exceeding its accepted list is working as designed, not a problem `doctor`
should nag about — `doctor`'s exit code is `findings.length > 0 ? 1 : 0` with no per-kind severity, so a
kind that fired unconditionally would make `doctor` red forever on a healthy, correctly-configured deferred
warning, which is the "gate that fires on a healthy state" shape this project does not ship.

**Phase 3, scoped: `tests/archunit/dogfood.test.ts` only.** `gate()`'s actual job in that file is narrower
than "make `.warn()` unrepresentable everywhere" — it is "make it impossible for a contributor to this
repo's own suite to accidentally reach an unaccountable `.warn()` on one of our own rules." The
replacement: stop calling `.check()`/`.warn()` per rule at all. Each `it()` block does `BUILT.push(rule)`
(no wrapper, no per-rule terminal call); one `checkAll(BUILT)` call at the end of the file — where the
`diagnose(BUILT)` preflight already runs — enforces all five rules aggregated, reading each one's own
`_severity`. Every one of these five is meant to be a hard gate (none is legitimately warn-worthy today),
so they all stay at default (`error`) severity and `checkAll` throws on any of their violations — the
identical guarantee `gate()` provided, restructured around the surface that actually reads severity.
`gate()`'s own docstring already names why this file does not need a population cross-check the way
`arch-rules.test.ts` does ("Four [now five] rules on one screen do not need it") — that reasoning is
unchanged by this migration.

This does **not** convert any of dogfood's own five rules to the new deferred-with-`accepted` state —
none of them is currently, legitimately warn-severity debt, and inventing one to exercise the feature would
be staged dogfooding, not real dogfooding. The mechanism's own correctness (test inventory #1, #2, #7) is
proven by its dedicated test suite instead, which is the primary evidence Phase 3 asks for; the migration
proves the narrower claim that `gate()` specifically is no longer necessary for this file.

`tests/archunit/arch-rules.test.ts`'s 44-site migration is out of scope here — it carries its own
`PLANTED`/`PLANT_DEFERRED` ratchet (a hand-maintained ADR-008-rule-2 "every gated rule has been planted
against" guard) and a source-text scan counting `.check()|.warn()` terminals, both keyed on the exact
per-rule `gate(rule).check()` shape this migration removes. Adapting both correctly is real, separate work
for a follow-up.

## Review findings, fixed

Two-persona review (architect + testing) after implementation. The architect's Critical finding was
verified independently before any fix was written — reproduced against the actual pre-fix code in a
scratch test, not accepted on the report alone.

**Critical, fixed: identity collisions defeated the whole mechanism, reproducing bug 0084's exact
regression.** `subjectOf()` (`violation.identity ?? \`${element}::${message}\``) is not guaranteed
unique within one rule's own violation batch. Two violations sharing an element+message (no
producer-set `identity`— routine for a rule like`haveNameMatching`whose message doesn't embed a
per-file specific) collide, and`disambiguateIdentities()` (`applyFilters()`'s own first step) repairs
the collision with a **positional** `#1`/`#2`suffix — first occurrence by array order keeps the bare
subject, later ones get numbered. That position is not stable: a fixed violation that held the bare
subject and a genuinely NEW violation that lands on the same position both read as the identical
accepted-list entry. Reproduced directly: two files each exporting a same-named, rule-violating
function; accept both computed subjects; fix one file and add a THIRD, genuinely new violation — it
silently absorbed as accepted,`checkAll`did not throw. Fixed by computing`hasIdentityCollision()`independently (a pure, local recomputation over the raw, pre-disambiguation batch — not reusing the
global`identityCollisions()`disclosure channel, which is a different feature's instrumentation) and
escalating the WHOLE batch to`error`whenever a collision is present, since`accepted`cannot safely
be trusted at all once identity within the batch is not reliably unique.`deferredWarningAdvice()`
reports this case with its own distinct message ("not reliably identifiable"), not the ordinary
"not in that list" text — a different, more urgent cause than a plain new finding.

**Important, fixed: the `accepted`/severity invariant (accepted only means something on `'warn'`) had
no test proving it survives a re-severity.** `asSeverity()`'s own implementation clears
`_acceptedWarnings` whenever level is not `'warn'`, correctly — but nothing exercised a rule detouring
through `.asSeverity('error')` and back to `.asSeverity('warn')` without re-supplying `accepted`. Fixed
by adding that exact test, sabotage-verified (reverting the clearing logic to preserve the prior list
makes the new test fail).

**Important, fixed: a factual error in this plan's own "Design, resolved" section** — it said "7
`gate()` sites" in five places; the actual, both pre- and post-migration count is 5. Corrected
throughout.

**Minor, fixed: Test inventory item 4 was stale** against the design actually implemented (Phase 1 took
the plain-array-literal branch, not the tracking-document branch that item anticipated) — struck and
annotated below.

**Not changed, by design:** `deferredWarningAdvice()`'s CLI-level (`doctor`) integration test coverage,
noted as a gap by the testing persona but consistent with existing precedent — neither `'inert'` nor
`'zero-subjects'` has one either, and closing it for all three together is better scoped as its own
small follow-up than as an inconsistency introduced by this plan alone.

## Test inventory

1. **A deferred warning that accepts a NEW finding fails.** The measured failure from plan 0084, as a test:
   a rule with a ceiling, warning at N, failing at N+1.
2. **An advisory warning never fails**, however long it lives — or Phase 2's distinction is decoration.
3. **`doctor` reports every warning with its finding count**, by identity — narrowed on implementation to
   "every DEFERRED warning currently breaching `accepted`," matching every other `DiagnosableRule` kind's own
   precedent (none fires on a healthy state); doctor's binary exit code can't absorb an always-on kind. See
   the plan's own "Design, resolved" section.
4. ~~`doctor` reports a warning whose tracking document has vanished, if Phase 1 takes that branch~~ — **not
   applicable.** Phase 1 took the plain-array-literal (`accepted`) branch, not the required-reason-plus-ticket
   branch this row anticipated; no tracking document exists to report on.
5. **The existing `.asSeverity('warn')` and `.warn()` behave exactly as today**, so this is additive.
6. **`gate()` is deleted and our own suite still cannot reach `.warn()`.** Phase 3, and the only end-to-end
   proof.
7. **VACUITY: each row's rule really produced findings** — a ceiling test over an empty selection passes for
   the wrong reason, which is this library's own subject.

## Out of scope

- **Baselines.** A baseline records _which_ findings are accepted and is the right tool for existing debt.
  This is about the severity lever, which is used when a baseline is too much ceremony — and that is exactly
  when it goes unwatched.
- **Changing rule 1.** The ADR is right; the API is missing.

## Related

- [Plan 0084](./0084-cycle-detection-that-ignores-type-only-imports.md) — solved this locally, and
  the review's fair criticism that it did not generalise.
- [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rules 1 and 6.
- [Bug 0024](../../bugs/fixed/0024-warn-terminal-is-invisible-inside-a-test-runner.md) — made warnings visible;
  visibility turned out not to be enforcement, which is this plan's premise.
- `src/core/orphan-exclusions.ts` — the machinery Phase 1's tracking variant should reuse.
