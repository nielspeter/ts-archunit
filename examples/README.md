# Examples

Architecture rule examples for common project patterns. Copy and adapt for your own project.

| Example | Description |
|---------|-------------|
| [rest-api.test.ts](./rest-api.test.ts) | REST API backend — layers, naming, body analysis, type safety |
| [clean-architecture.test.ts](./clean-architecture.test.ts) | Clean/Hexagonal Architecture — the dependency rule, domain isolation |
| [custom-rules.test.ts](./custom-rules.test.ts) | Team-specific conventions — JSDoc enforcement, no magic numbers, no public fields |

## Running

These examples are templates, not runnable tests — they reference project structures (`src/domain/`, `src/services/`, etc.) that don't exist in this repo. To use them:

1. Copy an example to your project's test directory
2. Adjust folder paths to match your project structure
3. Run with your test runner: `npx vitest run arch.test.ts`
