# ADR-002: Use ts-morph as AST Engine

## Status

**Accepted** (March 2026)

## Context

ts-archunit needs to analyze TypeScript source code at multiple levels:

1. **Structural queries** — find classes, functions, interfaces by name, location, decorators
2. **Relationship queries** — imports, extends, implements
3. **Body analysis** — what a function calls inside its body (`parseInt`, `this.extractCount()`)
4. **Type-level queries** — is `orderBy` a `string` or a union of literals? Does this class structurally match an interface?

This requires both AST access (syntax tree) and type checker access (semantic type resolution). The choice of engine determines what the library can express, how fast it runs, and how maintainable it is.

## Decision

**We will use ts-morph as our sole AST and type-checking engine.**

```typescript
import { Project, SyntaxKind, Node } from 'ts-morph'

const project = new Project({ tsConfigFilePath: 'tsconfig.json' })

// Structural: find classes extending BaseRepository
const classes = project.getSourceFiles()
  .flatMap(f => f.getClasses())
  .filter(c => c.getExtends()?.getExpression().getText() === 'BaseRepository')

// Body analysis: find parseInt calls in method bodies
for (const cls of classes) {
  for (const method of cls.getMethods()) {
    const calls = method.getDescendantsOfKind(SyntaxKind.CallExpression)
    const usesParseInt = calls.some(c => c.getExpression().getText() === 'parseInt')
  }
}

// Type checker: is orderBy a bare string?
const iface = sourceFile.getInterface('RoleQueryOptions')
const prop = iface.getProperty('orderBy')
const type = prop.getType().getNonNullableType()
const isBareString = type.isString()  // true for string, false for 'a' | 'b'
```

ts-morph wraps the TypeScript compiler API (`typescript` package) with a developer-friendly API. It provides:
- The full TypeScript AST via wrapper classes (`ClassDeclaration`, `FunctionDeclaration`, etc.)
- The TypeScript type checker via `.getType()`, `.isString()`, `.isUnion()`, `.getUnionTypes()`
- Source file manipulation (we only use read, not write)
- Project-level operations (load from tsconfig, resolve imports)

## Consequences

### Positive

**Full TypeScript fidelity:**
- ts-morph uses the real TypeScript compiler — there is no parser divergence
- Every TypeScript syntax construct is supported (decorators, satisfies, const assertions, template literals, etc.)
- Type resolution handles generics, conditional types, mapped types, `Partial<>`, `Pick<>`, `Omit<>`, etc.
- As TypeScript evolves, ts-morph tracks it (same parser)

**Two-tier analysis (AST + type checker):**
- Most rules only need the AST (fast): name matching, decorator checking, call expression walking
- Type-level rules trigger the type checker on demand (slower but correct): `isString()`, `isUnionOfLiterals()`, structural matching
- The spec's performance strategy relies on this separation — AST-only rules don't pay for type checking

**Battle-tested:**
- ts-morph has 4M+ weekly npm downloads
- Used by ts-auto-mock, ts-json-schema-generator, and many code generation tools
- Active maintenance, tracks TypeScript releases closely

**Developer-friendly API:**
- `cls.getExtends()` vs `ts.getHeritageClauses(node).find(h => h.token === ts.SyntaxKind.ExtendsKeyword)`
- `method.getDescendantsOfKind(SyntaxKind.CallExpression)` vs manual `ts.forEachChild` recursion
- `.getText()`, `.getStartLineNumber()`, `.getSourceFile().getFilePath()` — all convenience methods needed for violation reporting

**Source maps and code frames:**
- ts-morph preserves exact source positions
- `node.getStartLineNumber()` and `node.getStart()` give precise locations for violation reporting
- This is critical for code frame generation (spec Section 12)

### Negative

**Performance overhead:**
- ts-morph wraps every AST node in a class instance — memory overhead vs raw TypeScript compiler API
- For 500-file projects: negligible. For 5000+ files: may need lazy loading (spec Section 13.4)
- Mitigation: lazy source file parsing, predicate memoization, file-set narrowing via `resideInFolder`

**Large dependency:**
- ts-morph pulls in the `typescript` package (~40MB installed)
- ts-archunit is a dev dependency — disk size is acceptable
- Users likely already have `typescript` installed

**Version coupling:**
- ts-morph pins a TypeScript version range — if a user's project uses a newer TypeScript, there could be parser mismatches
- Mitigation: ts-morph tracks TypeScript releases quickly (usually within weeks)
- Future: allow users to pass their own TypeScript instance (ts-morph supports this)

## Alternatives Considered

### Alternative 1: Direct TypeScript Compiler API

**Use `typescript` package directly without ts-morph wrapper.**

```typescript
import * as ts from 'typescript'

const program = ts.createProgram(['src/index.ts'], { strict: true })
const checker = program.getTypeChecker()

// Verbose: finding classes that extend BaseRepository
function visit(node: ts.Node) {
  if (ts.isClassDeclaration(node)) {
    const heritage = node.heritageClauses?.find(
      h => h.token === ts.SyntaxKind.ExtendsKeyword
    )
    if (heritage) {
      const expr = heritage.types[0]?.expression
      if (ts.isIdentifier(expr) && expr.text === 'BaseRepository') {
        // found it
      }
    }
  }
  ts.forEachChild(node, visit)
}
```

**Pros:**
- No wrapper overhead — slightly faster
- Direct access to all compiler internals
- No version coupling (uses project's own TypeScript)

**Cons:**
- Extremely verbose API — 3-5x more code for the same operations
- No convenience methods — manual tree walking, manual position calculation
- Internal API is not stable between TypeScript versions (some helpers move/rename)
- ts-morph already solves all these problems

**Rejected because:** The verbosity tax is enormous. ts-morph's API directly maps to the DSL operations we need (getClasses, getExtends, getDescendantsOfKind). Writing a wrapper around the raw compiler API would essentially recreate ts-morph, poorly.

### Alternative 2: Tree-sitter with tree-sitter-typescript

**Use tree-sitter for fast, incremental parsing.**

**Pros:**
- Very fast parsing (written in C)
- Incremental reparsing (only changed regions)
- Language-agnostic query syntax

**Cons:**
- No type checker — cannot resolve `Partial<>`, type aliases, structural typing
- Separate grammar from TypeScript compiler — parser divergence risk
- Tree-sitter's TypeScript grammar lags behind TypeScript releases
- Would need a separate type checker integration (back to the TypeScript compiler API)

**Rejected because:** ts-archunit requires type-level analysis (spec Sections 6.4, 13.3). Tree-sitter only provides syntax-level parsing. We'd need both tree-sitter AND the TypeScript compiler, which is worse than just using ts-morph.

### Alternative 3: SWC or OXC

**Use a Rust-based parser for speed.**

**Pros:**
- 10-100x faster parsing than TypeScript's own parser
- Growing ecosystem

**Cons:**
- No type checker — same limitation as tree-sitter
- AST format differs from TypeScript's — would need translation layer
- SWC/OXC TypeScript support is "parse and strip types", not "understand types"
- Cannot answer "is this type a union of string literals?"

**Rejected because:** Same as tree-sitter — no type checker. Speed is not the bottleneck; type resolution is the hard problem.

### Alternative 4: TypeScript Language Service API

**Use `ts.createLanguageService()` for IDE-like queries.**

**Pros:**
- Designed for interactive queries (find references, go to definition)
- Incremental updates
- Same API that VS Code uses

**Cons:**
- Designed for single-file-at-a-time queries, not batch analysis
- More complex setup than `ts.createProgram`
- ts-morph already uses the program/checker API which is more appropriate for batch analysis

**Rejected because:** The language service is optimized for interactive IDE scenarios. ts-archunit runs batch analysis across many files — `ts.createProgram` + type checker (which ts-morph wraps) is the right tool.

## Notes

- ts-morph is used in read-only mode — we never modify source files
- The spec assumes TypeScript 7 (Go-based compiler) will eliminate performance concerns — ts-morph should work with TS7 as long as the compiler API is preserved
- If TS7 breaks ts-morph compatibility, this ADR should be revisited
