# Explain Command

Dump all active architecture rules as structured JSON. Useful for team onboarding, AI system prompts, and CI auditing.

## Usage

```bash
npx ts-archunit explain arch.rules.ts
npx ts-archunit explain arch.rules.ts --markdown
npx ts-archunit explain arch.rules.ts --config ts-archunit.config.ts
```

## JSON output

The default output is a JSON object containing an array of rule descriptions. Each entry includes the rule's auto-generated description, its ID (if set via `.rule()`), and the `because`, `suggestion`, and `docs` metadata fields. Rules without `.rule()` metadata still appear — they just have empty optional fields.

```json
{
  "rules": [
    {
      "rule": "that reside in folder \"**/services/**\" should not contain call to 'prisma'",
      "id": "arch/no-db-in-services",
      "because": "services must not bypass the repository layer",
      "suggestion": "Move the query to a repository method"
    }
  ],
  "generatedAt": "2026-03-30T12:00:00Z"
}
```

## Markdown output

When you need a human-readable summary (for wiki pages, PR descriptions, or team documentation), use `--markdown`. It outputs the same data as a pipe-separated table:

```
| ID | Rule | Because | Suggestion |
|----|------|---------|------------|
| arch/no-db-in-services | that reside in ... | services must not... | Move the query... |
```

## Use cases

### AI system prompt

Pipe the output into your AI tool's context so it understands the project's constraints:

```bash
npx ts-archunit explain arch.rules.ts > .arch-rules.json
# Add to CLAUDE.md or system prompt
```

### Team onboarding

New developers read the explain output to understand why certain patterns are enforced — the `because` and `suggestion` fields provide the rationale.

### CI audit logging

Log the active rule set alongside test results:

```yaml
- name: Log architecture rules
  run: npx ts-archunit explain arch.rules.ts
```

## How it works

The `explain` command loads your rule files the same way `check` does, but calls `.describeRule()` on each builder instead of `.check()`. No rules are evaluated — metadata is extracted directly from the builder state.

For `explain` to produce useful output, annotate your rules with `.rule()` metadata:

```typescript
functions(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(mustCall(/Repository/))
  .rule({
    id: 'arch/service-delegation',
    because: 'services orchestrate — data access belongs in repositories',
    suggestion: 'Inject a repository and call its methods',
    docs: 'https://wiki.internal/architecture#services',
  })
  .check() // or just build the rule — explain reads metadata without executing
```

Rules without `.rule()` metadata will have empty `id`, `because`, and `suggestion` fields — they still appear in the output with their auto-generated `rule` description.
