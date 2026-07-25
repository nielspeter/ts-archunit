# Proposal 018 — An Adoptable Discovery Surface

**Status:** Draft 1
**Priority:** High — the discovery surface is the largest shipped-but-unused capability in the library, and the reason it is unused is a **fixable defect**, not a philosophical one.
**Affects:** `hashViolation` identity inputs (`src/helpers/baseline.ts`), the message construction in `src/smells/*`, and one new opt-in ratchet terminal. No change to any predicate, condition, or entry point.
**Origin:** A 2026-07 coverage audit of a large adopting codebase, plus the "flip checklist" from that project's earlier (March) rule inventory. Both are external documents; the relevant evidence is reproduced below.

> **The discovery detectors already support `.check()`.** `SmellBuilder extends TerminalBuilder`, so fail-grade is available today and has been all along. "Detectors default to `.warn()`" is a sentence in a comment, not a capability limit. The reason nobody turns them on is that **the ratchet does not work for them** — you cannot accept existing debt and block new debt, so the only options are "red on arrival" or "off".

## Problem

A mature adopting project — 177 enforced rules, 1 warn, agent-first messages throughout, a genuine power user of the enforcement surface — used the discovery surface **zero times**. Pointing `duplicateBodies` at it surfaced **~700 findings that all 177 enforced rules were blind to**, including the exact copy-paste rot the tool exists to prevent.

The obvious diagnosis is severity: advisory findings are invisible to an agent (ADR-008), so promote them to `.check()`. That diagnosis is wrong, and the evidence says so twice.

**1. `.check()` already works.** Nothing has to be built for fail-grade.

**2. The ratchet is structurally broken for smells.** `hashViolation` is
`rule::element::message` and deliberately **excludes** `violation.line`, so a
finding survives edits elsewhere in the file — there is an existing test asserting
exactly that. But `duplicateBodies` writes coordinates _and_ a similarity
percentage into the message:

```
findByIds (a.ts:10) is 94% similar to findAll (b.ts:22)
```

so the excluded line number re-enters the hash through the back door. Measured:

| Change                                       | Baseline entry             |
| -------------------------------------------- | -------------------------- |
| Ordinary rule, same finding twice            | **stable** ✔               |
| Smell, one blank line added above a function | **hash changes** → re-reds |
| Smell, a body edited (94% → 92% similar)     | **hash changes** → re-reds |

A team that baselines 700 duplicate-body findings gets a green build exactly once.
The next unrelated edit near any of those functions re-reds it, with a finding they
already accepted. That is not an adoption speed-bump; it makes the documented
adoption path (`withBaseline()`) non-functional for this entire surface.

### Independent corroboration: why real rules stay advisory

The same project's flip checklist catalogues 25 rules by whether they could be
promoted from `.warn()` to `.check()`. Across the 13 that stay advisory **by
design**, the stated reasons are:

| Blocker                                                        | Count | Example                                              |
| -------------------------------------------------------------- | ----- | ---------------------------------------------------- |
| **Reachability** — the subject cannot be selected              | 4     | "anonymous arrow functions can't be matched by name" |
| **Legitimate exceptions** — the rule is right, the code is too | 3     | 16 valid non-pagination `parseInt` uses              |
| **Debt volume** — needs accept-today/block-new                 | 4     | "~99 — needs large triage"                           |
| **Real design work**                                           | 2     | a genuine circular dependency                        |
| **Severity itself**                                            | **0** | —                                                    |

Nobody's rule is advisory because they wanted a softer signal. They are advisory
because of reachability, exceptions, and volume. Fixing severity addresses the one
column that is empty.

## Proposal

### 1. Ratchet-stable smell identity (the core change)

Findings must be identified by **what** they are, not **where they currently sit**.

Two candidate mechanisms, and this proposal deliberately does not pick one yet:

- **(a) Move coordinates out of `message`.** Keep the human-readable text in the
  rendered output but build it from `file`/`line` fields at format time, leaving
  `message` coordinate-free. Smallest change; relies on every future detector
  remembering the convention.
- **(b) An explicit identity field.** `ArchViolation.identity?: string`, used by
  `hashViolation` when present, falling back to today's triple. A detector states
  its own stable key (for duplicate bodies: the unordered pair of qualified
  names). Slightly larger, but makes the invariant _structural_ rather than a
  convention a future detector can quietly break.

I lean to **(b)** on the grounds that this bug is exactly a convention being broken
silently — but the choice belongs in review.

Either way, the similarity percentage leaves the identity: a pair that drifts from
94% to 92% is the same accepted finding, not a new one.

### 2. A shrink-only ratchet

`withBaseline()` accepts a set and blocks additions. The flip checklist shows what
teams actually need for a 700-finding surface: a count that **may fall, never
rise**, so incidental cleanup is rewarded and regression is blocked without
re-baselining. This is the mechanism the adopting project hand-rolled twice (its
limits catalogue carries an `allowlistBaseline` integer with a shrink-only
assertion) — the same signal that justified the correspondence primitive.

### 3. Agent-first messages on the security-relevant subset

Per ADR-008, for the findings where the remedy is unambiguous (unescaped LIKE
patterns, uncapped pagination, duplicated diverging bodies), the message should
carry the sanctioned fix, not just the observation.

## Out of scope — deliberately

- **Flipping the `.warn()` default.** It is a one-line decision, and it should be
  made _after_ adoption works, not as a substitute for making it work. Shipping a
  fail-grade surface that cannot be ratcheted would be the worst of both.
- **The reachability gap** (factory-returned arrows, computed-key assignments —
  two of the four shapes the audit listed; `0066` shipped the other two). Real, and
  it blocks 4 of the 13 advisory rules, but it is a different mechanism in a
  different file. Bundling a verified fix with speculative extras is precisely the
  pattern that cost five review rounds in 0.18.1.
- **New detectors.** This proposal makes the two existing ones usable.

## Migration

Changing violation identity **invalidates existing baseline files** for any project
that has baselined smell findings. One-time, and today that population is
approximately nobody (the surface is unused, which is the whole premise) — but it
must be stated in the CHANGELOG, and the failure mode should be a loud
"baseline entry no longer matches any finding" rather than silent re-reporting.
This is the main thing review should push on.

## Alternatives considered

- **Do nothing; document `.check()` better.** Rejected: the capability is already
  documented and still unused. The measured blocker is the ratchet, and no amount
  of documentation makes a broken hash stable.
- **Exclude smells from baseline entirely, ship them advisory forever.** Honest,
  and it is the status quo — but it concedes the largest unexploited capability in
  the library, and the audit's central finding is that this surface catches what
  177 enforced rules cannot.
- **Hash on `file` + `element` only (drop `message`).** Rejected: it would collapse
  two genuinely different findings about the same function into one, and it changes
  identity for _every_ rule, not just smells. The blast radius is far larger than
  the bug.

## Evidence index

- Hash instability: `hashViolation` at `src/helpers/baseline.ts:52-54`; message
  construction at `src/smells/duplicate-bodies.ts:160`. Reproduced by hashing three
  messages that differ only in line number and percentage.
- `.check()` already available: `SmellBuilder extends TerminalBuilder`
  (`src/smells/smell-builder.ts:13`).
- The ~700-finding measurement and the flip-checklist taxonomy are from the
  external audit named in **Origin**.
