# Examples

Architecture rule examples for common project patterns. Copy and adapt for your own project.

| Example                                                    | Description                                                                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [rest-api.test.ts](./rest-api.test.ts)                     | REST API backend — layers, naming, body analysis, type safety                                                                                          |
| [clean-architecture.test.ts](./clean-architecture.test.ts) | Clean/Hexagonal Architecture — the dependency rule, domain isolation                                                                                   |
| [custom-rules.test.ts](./custom-rules.test.ts)             | Team-specific conventions — JSDoc enforcement, no magic numbers, no public fields                                                                      |
| [type-safety.test.ts](./type-safety.test.ts)               | Strict type safety — ban `any`, type assertions (`as`), non-null assertions (`!`), `eval`                                                              |
| [archunit-inspired.test.ts](./archunit-inspired.test.ts)   | All 7 ArchUnit categories + TypeScript extras — dependencies, containment, inheritance, decorators, layers, cycles, body analysis, type safety, naming |

## Running

These examples are templates, not runnable tests — they reference project structures (`src/domain/`, `src/services/`, etc.) that don't exist in this repo. To use them:

1. Copy an example to your project's test directory
2. Adjust folder paths to match your project structure
3. Run with your test runner: `npx vitest run arch.test.ts`
