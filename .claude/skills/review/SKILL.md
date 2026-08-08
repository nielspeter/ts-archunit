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

5. **Deliverable instruction** (verbatim, every prompt):

> "**How to deliver.** Only your FINAL message reaches the coordinator. Nothing you write mid-run is
> delivered — not a review you emit and then keep working past, not a summary inside your reasoning.
>
> So: the moment your findings are ready, write the complete review as one message and **STOP**. Do not
> call another tool after writing it. Do not verify one more thing, tidy a worktree, or re-read a file
> — a tool call after the review means the review was not your final message and the coordinator
> receives nothing.
>
> Budget your run so this always happens. If you are running long or approaching a limit, stop
> investigating immediately and emit what you have, marking unfinished threads as such. **A partial
> review that arrives beats a thorough one that does not.** Returning nothing is the single worst
> outcome — worse than a shallow review, worse than an abstention.
>
> Your final message is the review itself: the complete findings, not a status note, not a promise, not
> a file path pointing at them."

**IMPORTANT**: If multiple personas are selected, spawn ALL agents in a single message (parallel execution). Do NOT spawn them one at a time.

**Isolation**: reviewers run concurrently against one checkout and several will want to run gates or sabotage patches. Tell each: _"Do not modify the shared working tree. If you need to patch, build or run a sabotage matrix, use `git worktree add` on a temp path and work there; clean it up before you write your review."_ Without this, one reviewer's probe files and sabotage edits land in another's gate run — and in the user's `git status`.

### Recovering a reviewer that returned nothing

A reviewer that goes idle without delivering has usually **already written the review** as an intermediate message and then kept working past it. Do not re-run the review and do not report "no findings" — go read what it wrote:

```
~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<name>-<hash>.jsonl
```

Extract the assistant text blocks (`message.role === 'assistant'`, `content[].type === 'text'`) and take the last substantial one — that is the review. Only if the transcript genuinely contains no findings (the agent was still mid-investigation when it stopped) is the persona "no report received".

**Stub returns**: if a reviewer comes back with a stub — a bare "done"/"review complete", an empty result, or output missing the Critical/Important structure (an explicit one-line abstention is fine) — recover it the same way: read the transcript first, then message the agent asking for the findings verbatim, and only respawn if both fail. Never synthesize around a missing report, and never silently drop the persona: if it stays unrecoverable, the synthesis lists it as "no report received".

## 4. Synthesize

You are the **gatekeeper**, not a relay. Reviewers supply findings; you decide what is real. Before
promoting any finding to Critical or acting on it, verify it against the code yourself — reviewers
report plausible-but-wrong findings, and a persona's confidence is not evidence. Equally, do not demote
a finding because you did not find it first.

Never present a synthesis as though reports arrived when they did not. If you did the analysis yourself
because a persona returned nothing, say so plainly and up front, rather than filing your own work under
a heading that implies a panel agreed.

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
