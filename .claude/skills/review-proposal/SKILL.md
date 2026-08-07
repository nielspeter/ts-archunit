---
name: review-proposal
description: "Review a ts-archunit proposal for framework fitness. Validates that proposals fit a generic tool (like vitest/eslint), don't pollute the architecture, and follow existing patterns. Use this skill whenever: a proposal file is mentioned or opened, someone suggests a new API/feature/primitive for ts-archunit, you're about to write or review a plan that adds API surface, or anyone says 'proposal', 'new feature', 'new API', 'add method', 'add predicate', 'add condition'. Runs architect + product reviews in parallel."
argument-hint: "[path-to-proposal or 'this proposal']"
---

# Proposal Review for ts-archunit

ts-archunit is a **generic testing framework for architecture** — like vitest, eslint, or jest. It ships composable primitives, not opinions. Every API change serves all users across all project types.

This skill reviews proposals through two lenses to catch issues before code is written:

1. **Architect** — does this follow existing patterns, or invent new mechanisms on the side?
2. **Product** — is this generic enough, or is it shaped by one project's specific bug?

## Background: lessons from past proposals

A proposal for "call rule builder exclusions" went through three drafts before we got it right:

- Draft 1 invented a second `.excluding()` method with a different signature — didn't realize the base class already had one that matched file paths.
- Draft 2 proposed a chain `.not()` method with a `_negateNext` state flag — didn't realize a `not()` combinator already existed in `src/core/combinators.ts`, was publicly exported, and was already used in presets.
- Draft 3 (final) was a pure docs fix. Zero code changes.

The root cause in every case: **the proposal was written without surveying existing code.** This skill exists to catch that pattern before two rounds of rework.

## Step 1: Locate the proposal

From `$ARGUMENTS`, find the proposal to review:

- If a file path is given, read it.
- If "this proposal" or similar, check for a recently opened `.md` file in `proposals/` or `.claude/plans/`, or the most recent proposal in the conversation.
- If unclear, ask.

## Step 2: Existing code survey (MUST happen first)

Before evaluating any ask in the proposal, survey the existing codebase for capabilities the proposal might be unaware of. This is the most important step — past proposals have repeatedly invented parallel mechanisms for things that already existed.

For every new method, type, interface, or pattern the proposal wants to add:

1. **Grep for the concept** — search `src/` for the key terms (e.g., if the proposal wants "negation", grep for `not`, `negate`, `exclude`, `invert`).
2. **Check the public API** — read `src/index.ts` exports. Is the capability already shipped?
3. **Check combinators** — read `src/core/combinators.ts`. The `not()`, `and()`, `or()` combinators compose with `satisfy()` on every builder.
4. **Check the base class** — read `src/core/rule-builder.ts`. Methods on the base class are inherited by every builder. The proposal may think a method is missing from one builder when it's actually inherited.
5. **Check presets for precedent** — grep `src/presets/` for usage of the pattern the proposal is trying to add. If a preset already does it, the mechanism exists.

Collect findings into a brief "Existing code survey" section. For each ask in the proposal, state: "Already exists at [file:line]" or "Genuinely new — no existing equivalent found."

## Step 3: Spawn architect + product reviewers

Spawn **both** agents in a **single message** (parallel execution).

### Architect review prompt

Include in the prompt:

- The proposal content (paste or reference)
- The existing code survey findings from Step 2
- These evaluation criteria:

1. DUPLICATION — Does any ask duplicate an existing capability? (This is the #1 failure mode.)
2. PATTERN FIT — Does the proposed API follow existing patterns in the codebase, or invent new mechanisms? Read the files the survey references and compare.
3. LAYERING — Is the implementation at the right layer? Base class vs. per-builder? Predicate vs. condition? Pre-filter vs. post-filter?
4. COMPOSABILITY — Do the proposed primitives compose with existing ones (not/and/or/satisfy)? Or do they create a parallel universe?
5. EDGE CASES — State leakage across fork()? Phase-guard interactions? Dual-use method dispatch?
6. ADR COMPLIANCE — Does it follow all ADRs in /adr/?

Key context to include:

- ts-archunit is a generic framework like vitest/eslint — every change serves all users
- ADRs are binding (especially ADR-003 fluent builder, ADR-005 no any/as)
- The base RuleBuilder class owns shared behavior; builders inherit, not duplicate
- not()/and()/or() combinators exist in src/core/combinators.ts and compose via satisfy()

Structure findings as: Critical / Important / Minor / Praise.

### Product review prompt

Include in the prompt:

- The proposal content (paste or reference)
- The existing code survey findings from Step 2
- These evaluation criteria:

1. GENERIC FITNESS — Would a developer on any TypeScript project understand and use this? Or is it shaped by one project's specific case?
2. NAMING — Are proposed method/type names generic? Would they make sense in a README that thousands of strangers read?
3. EXAMPLES — Do code examples use generic scenarios (repositories, services, handlers) or project-specific terminology?
4. SCOPE — Is the proposal adding the minimum generic primitive, or a narrow convenience layer?
5. EXISTING SOLUTION — Given the code survey, does the user actually need new API, or just better docs for what already exists?
6. BACKWARDS COMPATIBILITY — Does anything break existing rules or lock the API into a shape that prevents future evolution?

Structure findings as: Critical / Important / Minor / Praise.

## Step 4: Synthesize

After both agents return, write a synthesis:

### Verdict

One line: **Ship as-is** / **Ship with changes** / **Rewrite needed** / **Docs-only** / **Reject**

### Existing code survey results

For each ask in the proposal: does it already exist? This is the most actionable section — past proposals have been resolved entirely by this finding.

### Critical issues (must address)

Deduplicated across both reviewers. Lead with duplication findings — they're the most common.

### Important concerns (should address)

Deduplicated list.

### Minor suggestions

Brief list.

### Praise

What the proposal gets right.

### Recommended next step

Concrete action: "Fix the JSDoc and ship", "Rewrite Ask 2 as docs for existing satisfy(not(...))", "Survey src/core/combinators.ts before proceeding", etc.
