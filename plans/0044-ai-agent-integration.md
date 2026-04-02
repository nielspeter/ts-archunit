# Plan 0044: AI Agent Integration

## Status

- **State:** Ready
- **Priority:** P0 — The library's core value proposition is guiding AI coding agents
- **Effort:** 4 days
- **Created:** 2026-04-01
- **Updated:** 2026-04-01 (round 2: addressed all criticals from round 1; fixed execution model, cache refresh, path validation, imperative field, and test gaps from round 2)
- **Depends on:** 0040 (Presets), 0043 (Explain command)

## Context

ts-archunit was built to enforce architecture rules that AI coding agents violate. The library already has the enforcement engine (body analysis, presets, rich violation messages), but the integration with AI agent workflows has gaps:

1. **Agents discover violations too late.** The current flow is: agent writes code → pushes PR → CI runs tests → agent sees violation → agent fixes. The feedback loop goes through git push + CI, adding minutes per iteration.

2. **Agents don't know constraints upfront.** The `explain` command outputs JSON, but agents consume markdown in system prompts. Manual piping is required.

3. **No preset targeting agent-specific mistakes.** Agents make predictable mistakes (inline logic, generic errors, empty stubs, copy-paste) that a single preset could catch.

**Goal:** Three features that close the loop — real-time checking via MCP, upfront context via system prompt generation, and one-liner setup via an agent-aware preset.

### Post-review changes

The initial draft was reviewed by 7 personas (architect, backend, devops, product, customer, testing, frontend). Key changes:

- **Critical #1 (rule files call `.check()`):** Added `check_architecture` execution model: wrap rule file import in try/catch, catch `ArchRuleError` and extract `.violations`, catch other errors and return MCP error response. Presets that throw are handled naturally — the violations are in the error object.
- **Critical #2 (MCP SDK dependency):** Explicit: `@modelcontextprotocol/sdk` is an optional `peerDependency`. The `mcp` subcommand lazy-imports it and exits with a clear install message if missing. ADR-001 compliance documented.
- **Critical #3 (cache invalidation):** Added `refresh` parameter to `check_architecture` tool. When true, calls `sourceFile.refreshFromFileSystem()` on specified files before evaluation. No full project reload.
- **Critical #4 (security):** Added path validation — `configPath` must resolve within `process.cwd()`. Document trust boundary.
- **Critical #5 (cold-start latency):** Project loads eagerly on MCP server startup using `configPath` from first invocation, then caches. Documented expected latency.
- **Important: `context` as `explain --format agent`** instead of separate subcommand.
- **Important: heuristic fragility** — added `imperative` field to `RuleDescription` so conditions can provide their own agent-friendly text. Heuristic is the fallback, not the primary path.
- **Important: `agentGuardrails` uses function variants** — `functionNoGenericErrors`, `functionNoConsole`, `functionNoJsonParse` (not class-only versions).
- **Important: config auto-discovery** — MCP tools use existing `resolveConfig()` when `configPath` is omitted.
- **Important: stdio safety** — all stdout/stderr from rule evaluation is captured in MCP mode. Only MCP JSON-RPC messages go to stdout.
- **Important: test count** — expanded from ~24 to ~44 tests.

## Phase 1: MCP Server (2 days)

### What it does

An MCP (Model Context Protocol) server that exposes architecture checking as tools. AI agents (Claude Code, Cursor, Windsurf, Cline) call these tools while writing code — before committing.

### Tools

#### `check_architecture`

Run architecture rules against specific files or the whole project. Returns structured violations.

```json
{
  "name": "check_architecture",
  "description": "Check TypeScript files against architecture rules. Returns violations with fix suggestions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "configPath": {
        "type": "string",
        "description": "Path to the architecture rules file. If omitted, auto-discovers ts-archunit.config.ts or arch.rules.ts."
      },
      "files": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Specific files to check. If omitted, checks all project files."
      },
      "refresh": {
        "type": "boolean",
        "description": "If true, refresh specified files from disk before checking (use after writing files). Default: false."
      }
    }
  }
}
```

Response:

```json
{
  "violations": [
    {
      "ruleId": "repo/typed-errors",
      "file": "src/repositories/webhook.repository.ts",
      "line": 42,
      "message": "WebhookRepository contains new 'Error' at line 42",
      "because": "Generic Error loses context",
      "suggestion": "Use NotFoundError, ValidationError, or DomainError instead",
      "codeFrame": "  41 |     if (!result) {\n> 42 |       throw new Error(...)\n  43 |     }"
    }
  ],
  "summary": "1 violation found"
}
```

#### `explain_rules`

Return all active architecture rules as structured data. The agent reads this once at the start of a task to understand constraints.

```json
{
  "name": "explain_rules",
  "description": "List all active architecture rules with their constraints, rationale, and fix suggestions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "configPath": {
        "type": "string",
        "description": "Path to the architecture rules file. If omitted, auto-discovers."
      },
      "format": {
        "type": "string",
        "enum": ["json", "agent"],
        "description": "Output format. 'agent' outputs imperative markdown optimized for system prompts. Default: 'json'."
      }
    }
  }
}
```

### Execution model — handling `.check()` throws

Rule files come in two patterns, and the MCP server must handle both:

1. **Preset-style (side-effectful):** The file calls `layeredArchitecture(p, {...})` at top level, which internally calls `throwIfViolations()`. The preset throws `ArchRuleError` during `import()`.
2. **Builder-export:** The file exports an array of builders (e.g., `export default [classes(p).that()...should()...]`). `loadRuleFiles()` returns these builders without executing them.

The MCP server uses a two-phase execution model (mirroring `runCheck` in `src/cli/commands/check.ts`):

```typescript
async function executeRuleFile(configPath: string): Promise<ArchViolation[]> {
  const violations: ArchViolation[] = []

  // Phase 1: Import the rule file. Preset-style rules throw during import.
  let builders: RuleBuilderLike[]
  try {
    builders = await loadRuleFiles([configPath])
  } catch (error) {
    if (error instanceof ArchRuleError) {
      violations.push(...error.violations)
      return violations // preset threw — violations extracted
    }
    throw error // syntax error, missing file — return MCP error
  }

  // Phase 2: Execute returned builders. Builder-export rule files reach here.
  for (const builder of builders) {
    if ('violations' in builder && typeof builder.violations === 'function') {
      violations.push(...(builder as { violations: () => ArchViolation[] }).violations())
    } else {
      // Fallback: call .check() and catch the throw
      try {
        builder.check()
      } catch (error) {
        if (error instanceof ArchRuleError) {
          violations.push(...error.violations)
        } else {
          throw error
        }
      }
    }
  }

  return violations
}
```

This means:

- **Preset-style rule files** work unmodified — violations are extracted from the thrown `ArchRuleError` during import. A single preset reports all its internal violations (presets aggregate before throwing).
- **Builder-export rule files** work — builders with `.violations()` are called directly (non-throwing). Builders without `.violations()` fall back to `.check()` with try/catch.
- Non-rule errors (syntax errors, missing tsconfig) are returned as MCP error responses.

**Limitation:** If a preset-style rule file calls multiple presets sequentially, only the first failing preset's violations are captured (the throw halts execution). This is inherent to the throw-based model. The MCP docs should recommend using builder-export style with `.violations()` for rule files used with the MCP server. Note: a single preset (e.g., `layeredArchitecture`) always reports ALL its violations — the limitation only applies across multiple presets in one file.

### Cache invalidation

The ts-morph project is loaded once and cached. The `refresh` parameter controls cache freshness:

```typescript
if (options.refresh && options.files) {
  for (const filePath of options.files) {
    const resolved = path.resolve(filePath)
    const sf = project._project.getSourceFile(resolved)
    if (sf) {
      sf.refreshFromFileSystemSync() // re-reads from disk, sync to keep it simple
    } else {
      // New file created by the agent — add it to the project
      project._project.addSourceFileAtPath(resolved)
    }
  }
}
```

When `refresh` is true without `files`, calls `resetProjectCache()` for a full cache eviction. The next tool call lazily re-creates the project (incurring cold-start latency). Agents should pass `refresh: true` with specific `files` to avoid full reload.

`files` paths are validated the same way as `configPath` — must resolve within `process.cwd()`.

### Security: path validation

`configPath` is validated before execution:

```typescript
function validatePath(inputPath: string): string {
  const resolved = path.resolve(process.cwd(), inputPath)
  const projectRoot = process.cwd()
  // Trailing separator prevents /app matching /application
  if (resolved !== projectRoot && !resolved.startsWith(projectRoot + path.sep)) {
    throw new Error(`Path must be within the project root: ${projectRoot}`)
  }
  return resolved
}
```

Used for both `configPath` and `files` entries.

**Trust boundary:** The MCP server has the same capabilities as `node` running in the user's shell. It executes user-supplied rule files. This is documented in `docs/mcp.md`.

### Config auto-discovery

When `configPath` is omitted, the MCP server uses the existing `resolveConfig()` from `src/cli/resolve-config.ts` to find `ts-archunit.config.ts` or common rule file names. This eliminates the biggest first-call friction point.

### Stdio safety

In MCP mode, all rule evaluation output is captured. The MCP server:

1. Redirects `process.stderr` writes from the rule engine to a buffer (not the MCP transport).
2. Suppresses `console.warn` calls from the rule engine (exclusion warnings, deprecation notices).
3. Only writes MCP JSON-RPC protocol messages to stdout.

This prevents stray `console.log` or `formatViolations()` output from corrupting the JSON-RPC stream.

### Cold-start latency

The ts-morph project loads on the first tool call, not on server startup (the server doesn't know the tsconfig path until a tool is called). Expected latency:

| Project size           | First call | Subsequent calls |
| ---------------------- | ---------- | ---------------- |
| Small (< 100 files)    | 1-3s       | < 100ms          |
| Medium (100-500 files) | 3-8s       | < 100ms          |
| Large (500+ files)     | 8-15s      | < 100ms          |

The MCP server sends a progress notification during project loading so the agent knows to wait. Subsequent calls with `refresh: true` on specific files are fast (< 500ms).

### Serialized tool calls

Tool calls are serialized (not concurrent). The MCP SDK handles this via the request handler pattern. This avoids ts-morph concurrency issues and simplifies caching.

### Implementation

```
src/mcp/
├── server.ts          # MCP server setup, tool registration, stdio transport
├── tools/
│   ├── check.ts       # check_architecture tool implementation
│   └── explain.ts     # explain_rules tool implementation
└── index.ts           # startMcpServer() entry point, lazy SDK import
```

The `src/mcp/index.ts` is NOT a bin entry — it exports `startMcpServer()` which is called by the existing `src/cli/index.ts` when the `mcp` subcommand is used.

### `explain_rules` and preset-style rule files

The `explain_rules` tool loads rule files to call `.describeRule()` on returned builders. But preset-style rule files run and throw during import. The tool wraps the import in try/catch, discards the `ArchRuleError` (violations are not the point of `explain`), and returns whatever builders were successfully loaded. For preset-style files, the descriptions come from the `RuleMetadata` set on preset rules before they throw — captured via `.rule({ id, because, ... })` calls that execute before `throwIfViolations()`.

### MCP server registration

Users add to their `.claude/settings.json` (Claude Code) or equivalent:

```json
{
  "mcpServers": {
    "ts-archunit": {
      "command": "npx",
      "args": ["ts-archunit", "mcp"]
    }
  }
}
```

Docs recommend local install for faster startup: `./node_modules/.bin/ts-archunit mcp`.

### ADR-001 compliance

`@modelcontextprotocol/sdk` is an **optional peer dependency**, not a runtime dependency. The `mcp` subcommand lazy-imports it:

```typescript
async function startMcpServer(): Promise<void> {
  try {
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js')
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
    // ... start server
  } catch {
    console.error(
      'Error: @modelcontextprotocol/sdk is required for the MCP server.\n' +
        'Install it: npm install @modelcontextprotocol/sdk',
    )
    process.exitCode = 1
  }
}
```

This keeps the core package at two runtime dependencies (ts-morph, picomatch) per ADR-001.

## Phase 2: Agent-Optimized Explain Format (0.5 day)

### What it does

Adds `--format agent` to the existing `explain` command (not a separate `context` subcommand — review feedback). Outputs imperative markdown optimized for system prompts.

```bash
npx ts-archunit explain arch.rules.ts --format agent >> CLAUDE.md
```

### Output format

```markdown
<!-- ts-archunit:start -->

## Architecture Rules (auto-generated by ts-archunit)

The following rules are enforced by CI. Violations will block your PR.

### Layer Rules

- Do NOT import from `**/repositories/**` in files under `**/routes/**` — routes must go through services
- Do NOT import from `**/infrastructure/**` in files under `**/domain/**` — domain must be independent

### Code Patterns

- Do NOT throw `new Error()` in classes extending BaseRepository — use NotFoundError, ValidationError, or DomainError
- Do NOT call `parseInt` in classes extending BaseRepository — use this.extractCount() instead
- Do NOT call `eval()` anywhere in source code

### Hygiene

- Do NOT leave empty function bodies — every function must have at least one statement
- Do NOT leave stub comments in source code
- Every exported symbol must be referenced by at least one other file

### Required Patterns

- Functions in `**/services/**` MUST call a method matching /Repository/ — services must delegate to the data layer
<!-- ts-archunit:end -->
```

Sentinel markers (`<!-- ts-archunit:start -->` / `<!-- ts-archunit:end -->`) enable idempotent updates — running the command again replaces the block instead of appending.

### Imperative text generation

The primary path is a new optional `imperative` field on both `RuleMetadata` (input — what rule authors set) and `RuleDescription` (output — what `describeRule()` returns):

```typescript
// src/core/rule-metadata.ts — add imperative field
export interface RuleMetadata {
  id?: string
  because?: string
  suggestion?: string
  docs?: string
  imperative?: string // "Do NOT throw new Error() in repositories"
}

// src/core/rule-description.ts — add imperative field
export interface RuleDescription {
  rule: string
  id?: string
  because?: string
  suggestion?: string
  docs?: string
  imperative?: string
}
```

Built-in conditions provide their own `imperative` text via the condition's `description` field + the builder's predicate context. The heuristic string-matching is the **fallback**, not the primary path. This ensures custom rules degrade gracefully (raw description) while built-in rules produce polished imperative sentences.

To populate `imperative`, `RuleBuilder.describeRule()` is updated:

```typescript
describeRule(): RuleDescription {
  return {
    rule: this.buildRuleDescription(),
    id: this._metadata?.id,
    because: this._reason,
    suggestion: this._metadata?.suggestion,
    docs: this._metadata?.docs,
    imperative: this._metadata?.imperative ?? this.buildImperative(),
  }
}
```

Where `buildImperative()` applies the heuristic conversion as a fallback. Rule authors can also pass `imperative` directly via `.rule({ imperative: 'Do NOT ...' })`.

### Implementation

Modified file: `src/cli/commands/explain.ts` — add `agent` format alongside `json` and `markdown`. No new file.

**CLI flag routing:** The existing `--format` flag (`terminal`, `json`, `github`, `auto`) is used by `check` for violation output format. For `explain`, the format is passed via `--markdown` (boolean) today. The `agent` format is added as a new value for a dedicated `--explain-format` flag on the `explain` subcommand, keeping it separate from the check format. Alternatively, reuse `--markdown` by renaming it to `--format` on explain only — implementation detail, either approach works. The key constraint: `--format agent` must not be confused with the check command's `--format` flag.

Modified file: `src/core/rule-description.ts` — add `imperative` field.

Modified file: `src/core/rule-builder.ts` — add `buildImperative()` private method.

## Phase 3: Agent Guardrails Preset (0.5 day)

### What it does

A single preset targeting the specific mistakes AI agents make most often. One function call, no per-rule assembly. Uses **function variants** of all rules (not class-only versions) so standalone functions and arrow functions are covered.

```typescript
import { agentGuardrails } from '@nielspeter/ts-archunit/presets'

agentGuardrails(p, {
  src: 'src/**',
  noInlineLogic: ['parseInt', 'JSON.parse', 'eval'],
  noGenericErrors: true,
  noStubs: true,
  noEmptyBodies: true,
  noCopyPaste: true,
})
```

### Generated rules

| Rule ID                          | Entry point    | What it enforces                                 | Default | Condition used                           |
| -------------------------------- | -------------- | ------------------------------------------------ | ------- | ---------------------------------------- |
| `preset/agent/no-inline-logic`   | `functions(p)` | Functions must not call banned APIs              | error   | `functionNotContain(call(name))` per API |
| `preset/agent/no-generic-errors` | `functions(p)` | Functions must not throw `new Error()`           | error   | `functionNoGenericErrors()`              |
| `preset/agent/no-stubs`          | `functions(p)` | No stub comments in function bodies              | error   | `noStubComments()`                       |
| `preset/agent/no-empty-bodies`   | `functions(p)` | No empty function bodies                         | error   | `noEmptyBodies()`                        |
| `preset/agent/no-copy-paste`     | `smells`       | No duplicate function bodies (>= 0.9 similarity) | warn    | `smells.duplicateBodies(p)`              |

All rules accept `overrides` via `PresetBaseOptions`:

```typescript
agentGuardrails(p, {
  src: 'src/**',
  noGenericErrors: true,
  overrides: {
    'preset/agent/no-generic-errors': 'warn', // downgrade to warning
    'preset/agent/no-empty-bodies': 'off', // disable
  },
})
```

### What's NOT in this preset

- `noConsole` / `noDefaultExports` — these overlap with ESLint rules most teams already have. The preset focuses on things only ts-archunit can catch (body analysis, delegation patterns, copy-paste detection).
- Class-only variants — the preset uses function variants so it catches violations in standalone functions, arrow functions, and class methods.

### Why a separate preset

`layeredArchitecture` enforces _where_ code goes. `agentGuardrails` enforces _how_ code is written. They compose:

```typescript
layeredArchitecture(p, { layers: { ... } })
agentGuardrails(p, { src: 'src/**', noGenericErrors: true })
```

### `noInlineLogic` generates one rule per banned API

Each entry in the `noInlineLogic` array generates a separate `dispatchRule` call with its own rule ID suffix:

```
preset/agent/no-inline-logic/parseInt
preset/agent/no-inline-logic/JSON.parse
preset/agent/no-inline-logic/eval
```

This preserves specificity in violation messages — the agent sees which specific API was called, not a generic "banned API" message.

## Phase 4: Documentation (0.5 day)

### New pages

| Page                | Content                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/ai-agents.md` | Why AI agents need architecture guardrails. MCP server setup (Claude Code, Cursor, Windsurf). System prompt generation. Agent guardrails preset. The full workflow from setup to self-correcting agents. |
| `docs/mcp.md`       | MCP server reference — tool schemas, response format, caching behavior, refresh mechanism, security trust boundary, expected latency, recommended local install.                                         |

### Updated pages

| Page                      | What changes                                                                    |
| ------------------------- | ------------------------------------------------------------------------------- |
| `docs/getting-started.md` | Add "AI Agent Setup" section with MCP registration and `explain --format agent` |
| `docs/cli.md`             | Add `mcp` subcommand and `--format agent` flag on `explain`                     |
| `docs/presets.md`         | Add `agentGuardrails` preset                                                    |
| `README.md`               | Already leads with AI angle — add MCP setup instructions                        |

## Files

| File                                     | Type                                                                          | Phase |
| ---------------------------------------- | ----------------------------------------------------------------------------- | ----- |
| `src/mcp/server.ts`                      | New — MCP server setup, tool registration, stdio safety                       | 1     |
| `src/mcp/tools/check.ts`                 | New — check_architecture tool, path validation, cache refresh                 | 1     |
| `src/mcp/tools/explain.ts`               | New — explain_rules tool, agent format                                        | 1     |
| `src/mcp/index.ts`                       | New — `startMcpServer()` with lazy SDK import                                 | 1     |
| `src/cli/index.ts`                       | Modified — register `mcp` subcommand, add `--format agent` to explain         | 1+2   |
| `src/cli/commands/explain.ts`            | Modified — add `agent` format output                                          | 2     |
| `src/core/rule-metadata.ts`              | Modified — add `imperative` field                                             | 2     |
| `src/core/rule-description.ts`           | Modified — add `imperative` field                                             | 2     |
| `src/core/rule-builder.ts`               | Modified — add `buildImperative()`, populate `imperative` in `describeRule()` | 2     |
| `src/core/terminal-builder.ts`           | Modified — populate `imperative` in `describeRule()`                          | 2     |
| `src/presets/agent-guardrails.ts`        | New — agent guardrails preset                                                 | 3     |
| `src/presets/index.ts`                   | Modified — re-export                                                          | 3     |
| `package.json`                           | Modified — add `@modelcontextprotocol/sdk` as optional peerDependency         | 1     |
| `docs/ai-agents.md`                      | New                                                                           | 4     |
| `docs/mcp.md`                            | New                                                                           | 4     |
| `tests/mcp/server.test.ts`               | New — in-memory transport tests                                               | 1     |
| `tests/mcp/check.test.ts`                | New — check tool tests                                                        | 1     |
| `tests/mcp/explain.test.ts`              | New — explain tool tests                                                      | 1     |
| `tests/cli/explain-agent-format.test.ts` | New — agent format tests                                                      | 2     |
| `tests/presets/agent-guardrails.test.ts` | New                                                                           | 3     |

## Test strategy

### MCP server (~21 tests)

**Happy paths:**

- `check_architecture` returns violations for known bad fixture
- `check_architecture` returns empty violations for clean fixture
- `check_architecture` with `files` parameter scopes evaluation
- `check_architecture` includes `codeFrame`, `because`, `suggestion` in response
- `check_architecture` with `refresh: true` picks up file changes
- `explain_rules` returns rule descriptions in JSON format
- `explain_rules` returns agent-optimized markdown with `format: 'agent'`
- Config auto-discovery works when `configPath` is omitted
- Project caching: second call reuses cached project (spy on `Project` constructor)

**Error paths:**

- Invalid `configPath` returns MCP error response (not crash)
- `configPath` outside project root is rejected with clear message
- Rule file with syntax error returns MCP error (not crash)
- Rule file with non-ArchRuleError throw returns MCP error
- Missing `@modelcontextprotocol/sdk` produces clear install message

**Documented behaviors:**

- Multi-rule file with two failing `.check()` calls returns only first rule's violations
- `refresh: true` without `files` triggers full cache eviction (next call reloads)
- `refresh: true` with a newly created file adds it to the project
- Stdio safety: rule evaluation with `console.warn` does not corrupt MCP JSON-RPC stream
- `explain_rules` on a preset-style rule file catches `ArchRuleError` during import and still returns descriptions

**Transport:**

- Tests use `InMemoryTransport` from MCP SDK — no subprocess spawning
- Serialization: verify JSON-RPC request/response structure

### Agent format for explain (~12 tests)

- Generates markdown with imperative "Do NOT" / "MUST" sentences
- Uses `imperative` field from `RuleDescription` when available
- Falls back to heuristic conversion when `imperative` is not set
- Handles compound rule descriptions (multiple conditions)
- Preserves regex patterns in output (`/Repository/`)
- Incorporates `because` field as suffix
- Groups rules by category
- Empty rules produces "No rules found."
- Sentinel markers present for idempotent updates
- Custom `.rule({ imperative: '...' })` overrides heuristic
- Handles rules without metadata (raw description fallback)
- Markdown-special characters are escaped

### Agent guardrails preset (~13 tests)

- Catches eval when `noInlineLogic` includes `'eval'`
- Each `noInlineLogic` entry generates a separate rule ID
- `noInlineLogic: []` is a no-op (no rules generated)
- Catches empty bodies when `noEmptyBodies: true`
- Catches stub comments when `noStubs: true`
- Catches generic Error when `noGenericErrors: true` (uses function variant)
- Catches duplicate bodies when `noCopyPaste: true`
- Passes for clean code with all options enabled
- Override to `'off'` suppresses a specific rule
- Override to `'warn'` downgrades severity
- Optional rules skipped when not configured (e.g., `noGenericErrors` omitted)
- Aggregated error contains violations from multiple rules
- `src` glob scopes all generated rules
- `noDefaultExports` NOT present (removed per review — ESLint overlap)

### CLI routing (~3 tests)

- `await run(['mcp'])` does not produce "Unknown command" error
- `await run(['explain', 'rules.ts', '--format', 'agent'])` produces agent-format output
- `--watch` is rejected for `mcp` command

## Dependencies

| Package                     | Purpose                   | Type                                     |
| --------------------------- | ------------------------- | ---------------------------------------- |
| `@modelcontextprotocol/sdk` | MCP server implementation | `peerDependencies` with `optional: true` |

The MCP SDK is lazy-imported by the `mcp` subcommand only. The core package, CLI `check`/`baseline`/`explain`, and all presets work without it installed. This preserves ADR-001's "no runtime dependencies beyond ts-morph and picomatch" constraint.

## Out of scope

- **Auto-fix / code transformation** — the agent applies fixes based on text suggestions. Structured fix templates (find/replace patterns) are a future enhancement.
- **File watcher in MCP** — use the `refresh` parameter instead. No filesystem watching in the MCP process.
- **Multi-project support** — one MCP server per tsconfig. Monorepos run multiple servers.
- **IDE plugins** — MCP is the universal integration layer. No VS Code / JetBrains plugins.
- **Agent-specific rule tuning** — rules are the same for humans and agents. The preset just bundles common ones.
- **Separate `@ts-archunit/mcp` package** — considered per ADR-006, but pragmatically the MCP server is thin (< 200 lines), shares the same bin entry, and benefits from discoverability as a subcommand. The lazy import keeps it zero-cost for non-MCP users. Revisit if the MCP server grows complex enough to warrant independent versioning.

## Verification

```bash
npm run test
npm run typecheck
npm run lint
npm run docs:build
```
