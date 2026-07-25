# spikes/

Throwaway measurement scripts kept **only** so that a number quoted in a plan can
be re-derived by someone other than its author.

They are not shipped code, not covered by `tsconfig.json`, and not part of the
test suite. They are here because plan 0069's standing rule is "no count appears
in it that was not derived on the stated date" — and a count nobody else can
reproduce satisfies the letter of that rule while defeating its purpose.

| Script                 | Reproduces                                                 |
| ---------------------- | ---------------------------------------------------------- |
| `0069-glob-census.mjs` | Plan 0069's Problem table — dead globs in a rule file      |
| `0069-gate-walk.mjs`   | Plan 0069's gate runs — TypeScript on disk vs in a project |

Run from the repository root:

```bash
node spikes/0069-glob-census.mjs tests/archunit/arch-rules.test.ts
node spikes/0069-gate-walk.mjs /path/to/other-repo/tsconfig.json
```
