---
name: reviewer
description: 'Review code or plans with expert personas. Runs individual or multiple reviewers in parallel. Personas: architect, customer, devops, product, testing.'
argument-hint: '[all | architect | customer | devops | product | testing ...] [--plan | --branch]'
---

# Expert Review

Spawn reviewer agents to evaluate code changes or plans from different expert perspectives.

## 1. Parse Arguments

From `$ARGUMENTS`, extract:

**Personas** (default: `all`):

| Keyword        | Agent                | Short alias  |
| -------------- | -------------------- | ------------ |
| `architect`    | `reviewer-architect` | `arch`       |
| `customer`     | `reviewer-customer`  | `cust`       |
| `devops`       | `reviewer-devops`    | `ops`        |
| `product`      | `reviewer-product`   | `pm`         |
| `testing`      | `reviewer-testing`   | `qa`, `test` |
| `all` or empty | All eight above      |              |

**Review mode** (default: `--diff`):

| Flag                  | What to review                                                                          |
| --------------------- | --------------------------------------------------------------------------------------- |
| `--diff` or (default) | Uncommitted changes (`git diff` + `git diff --cached`)                                  |
| `--branch`            | All commits on current branch vs `main` (`git log main..HEAD` + `git diff main...HEAD`) |
| `--plan`              | The active plan file (from `.claude/plans/`)                                            |

## 2. Gather Context

Run the appropriate git/read commands to collect the review material:

- **`--diff`**: Run `git diff` and `git diff --cached`. If both empty, tell the user there's nothing to review.
- **`--branch`**: Run `git log --oneline main..HEAD` and `git diff main...HEAD`. If empty, tell the user the branch has no changes vs main.
- **`--plan`**: Find the plan file. Check for a `<system-reminder>` referencing a plan path, or glob `.claude/plans/*.md` and pick the most recent. Read it.

Keep the context summary **brief** — file names changed + a high-level description. Each agent will read the actual files themselves.

## 3. Spawn Reviewers

For **each selected persona**, spawn an Agent using the corresponding `subagent_type`:

```
Agent(
  subagent_type: "<agent-name>",   // e.g. "reviewer-architect"
  description: "<Persona> code review",
  prompt: "<review task prompt with context>"
)
```

The prompt to each agent should include:

1. The review mode and what changed (file list, commit summary, or plan reference)
2. Instructions to read the relevant files/diffs themselves
3. Request to structure findings as: **Critical** / **Important** / **Minor** / **Praise**
4. **Abstain instruction**: If the changes are outside the persona's domain and they have nothing meaningful to contribute, they should abstain with a single line (e.g., "No devops concerns — abstaining.") rather than forcing low-value findings

5. **Deliverable instruction** (verbatim, every prompt): "Your final message is the review itself — the complete findings, not a status note or a promise. It is the only thing the coordinator receives."

**IMPORTANT**: If multiple personas are selected, spawn ALL agents in a single message (parallel execution). Do NOT spawn them one at a time.

**Stub returns**: if a reviewer comes back with a stub instead of a review — a bare "done"/"review complete", an empty result, or output missing the Critical/Important structure (an explicit one-line abstention is fine) — recover the review: continue that agent if the harness supports messaging a returned agent, otherwise respawn the persona with the same prompt, and wait for the full review. Never synthesize around a missing report, and never silently drop the persona: if it stays unrecoverable, the synthesis lists it as "no report received".

## 4. Synthesize

After all agents return, write a synthesis:

### Review Summary

For each persona, show a one-line verdict (e.g. "Architect: 0 critical, 2 important, 1 minor"). If a persona abstained, show "Abstained — no relevant concerns". If a persona's report was unrecoverable, show "no report received" — never omit the row.

### Critical Issues (must address)

Deduplicated list of critical findings across all reviewers.

### Important Concerns (should address)

Deduplicated list of important findings.

### Minor Suggestions

Brief list, grouped if overlapping.

### Praise

What the reviewers liked — important for morale and reinforcing good patterns.

Keep the synthesis concise. Don't repeat the full agent outputs — the user already saw them.
