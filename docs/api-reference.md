# API Reference

All public exports from `ts-archunit`, organized by category.

## Entry Points

| Export      | Signature                                        | Description                                                      |
| ----------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| `project`   | `project(tsConfigPath: string): ArchProject`     | Load a TypeScript project. Cached per path.                      |
| `modules`   | `modules(p: ArchProject): ModuleRuleBuilder`     | Rule builder for source files (imports/dependencies).            |
| `classes`   | `classes(p: ArchProject): ClassRuleBuilder`      | Rule builder for class declarations.                             |
| `functions` | `functions(p: ArchProject): FunctionRuleBuilder` | Rule builder for functions, arrow functions, class methods.      |
| `types`     | `types(p: ArchProject): TypeRuleBuilder`         | Rule builder for interfaces and type aliases.                    |
| `slices`    | `slices(p: ArchProject): SliceRuleBuilder`       | Rule builder for file groupings (cycles, layers).                |
| `calls`     | `calls(p: ArchProject): CallRuleBuilder`         | Rule builder for call expressions.                               |
| `within`    | `within(sel: CallRuleBuilder): ScopedContext`    | Scoped rule builder for callback functions inside matched calls. |

## Rule Builders

| Export                      | Description                                 |
| --------------------------- | ------------------------------------------- |
| `RuleBuilder`               | Base rule builder class.                    |
| `ModuleRuleBuilder`         | Builder returned by `modules()`.            |
| `ClassRuleBuilder`          | Builder returned by `classes()`.            |
| `FunctionRuleBuilder`       | Builder returned by `functions()`.          |
| `TypeRuleBuilder`           | Builder returned by `types()`.              |
| `SliceRuleBuilder`          | Builder returned by `slices()`.             |
| `CallRuleBuilder`           | Builder returned by `calls()`.              |
| `ScopedFunctionRuleBuilder` | Builder returned by `within().functions()`. |

## Rule Builder Methods

Chain methods available on all rule builders (`RuleBuilder`, `SliceRuleBuilder`).

| Method         | Signature                                       | Description                                                                                             |
| -------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `.excluding()` | `.excluding(...patterns: (string \| RegExp)[])` | Permanently suppress violations matching element name, file path, or message. Warns on unused patterns. |
| `.because()`   | `.because(reason: string)`                      | Attach a human-readable rationale to the rule.                                                          |
| `.rule()`      | `.rule(metadata: RuleMetadata)`                 | Attach rich metadata (id, because, suggestion, docs).                                                   |
| `.check()`     | `.check(options?: CheckOptions)`                | Execute rule; throw on violations.                                                                      |
| `.warn()`      | `.warn(options?: CheckOptions)`                 | Execute rule; log violations without throwing.                                                          |
| `.severity()`  | `.severity(level: 'error' \| 'warn')`           | Execute with the given severity.                                                                        |

## Exclusion Comments

| Export                   | Signature                                                                              | Description                                               |
| ------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `parseExclusionComments` | `parseExclusionComments(source: string, file: string): ParseResult`                    | Parse `// ts-archunit-exclude` comments from source text. |
| `isExcludedByComment`    | `isExcludedByComment(violation: ArchViolation, comments: ExclusionComment[]): boolean` | Check if a violation is covered by an exclusion comment.  |

### Types

| Export             | Kind | Description                                                                 |
| ------------------ | ---- | --------------------------------------------------------------------------- |
| `ExclusionComment` | type | Parsed exclusion comment with ruleId, reason, file, line, isBlock, endLine. |
| `ExclusionWarning` | type | Warning about a malformed exclusion comment.                                |
| `ParseResult`      | type | Result of parsing: `{ exclusions, warnings }`.                              |

## Identity Predicates

Available on all entry points via `.that()`.

| Export                 | Signature                         | Description               |
| ---------------------- | --------------------------------- | ------------------------- |
| `haveNameMatching`     | `haveNameMatching(re: RegExp)`    | Name matches regex.       |
| `haveNameStartingWith` | `haveNameStartingWith(s: string)` | Name starts with string.  |
| `haveNameEndingWith`   | `haveNameEndingWith(s: string)`   | Name ends with string.    |
| `resideInFile`         | `resideInFile(glob: string)`      | File path matches glob.   |
| `resideInFolder`       | `resideInFolder(glob: string)`    | Folder path matches glob. |
| `areExported`          | `areExported`                     | Element is exported.      |
| `areNotExported`       | `areNotExported`                  | Element is not exported.  |

## Module Predicates

| Export                   | Signature                         | Description                                      |
| ------------------------ | --------------------------------- | ------------------------------------------------ |
| `importFrom`             | `importFrom(glob: string)`        | Module imports from files matching glob.         |
| `predicateNotImportFrom` | `notImportFrom(glob: string)`     | Module does not import from files matching glob. |
| `exportSymbolNamed`      | `exportSymbolNamed(name: string)` | Module exports a symbol with the name.           |
| `havePathMatching`       | `havePathMatching(re: RegExp)`    | Module file path matches regex.                  |

## Class Predicates

| Export                  | Signature                           | Description                           |
| ----------------------- | ----------------------------------- | ------------------------------------- |
| `extend`                | `extend(name: string)`              | Class extends the named base class.   |
| `implement`             | `implement(name: string)`           | Class implements the named interface. |
| `haveDecorator`         | `haveDecorator(name: string)`       | Class has the named decorator.        |
| `haveDecoratorMatching` | `haveDecoratorMatching(re: RegExp)` | Class has a decorator matching regex. |
| `areAbstract`           | `areAbstract`                       | Class is abstract.                    |
| `classHaveMethodNamed`  | `haveMethodNamed(name: string)`     | Class has a method with the name.     |
| `haveMethodMatching`    | `haveMethodMatching(re: RegExp)`    | Class has a method matching regex.    |
| `havePropertyNamed`     | `havePropertyNamed(name: string)`   | Class has a property with the name.   |

## Function Predicates

| Export                          | Signature                                  | Description                             |
| ------------------------------- | ------------------------------------------ | --------------------------------------- |
| `areAsync`                      | `areAsync`                                 | Function is async.                      |
| `areNotAsync`                   | `areNotAsync`                              | Function is not async.                  |
| `haveParameterCount`            | `haveParameterCount(n: number)`            | Function has exactly n parameters.      |
| `haveParameterCountGreaterThan` | `haveParameterCountGreaterThan(n: number)` | Function has more than n parameters.    |
| `haveParameterCountLessThan`    | `haveParameterCountLessThan(n: number)`    | Function has fewer than n parameters.   |
| `haveParameterNamed`            | `haveParameterNamed(name: string)`         | Function has a parameter with the name. |
| `haveReturnType`                | `haveReturnType(type: string)`             | Function has the given return type.     |

## Type Predicates

| Export               | Signature                                      | Description                               |
| -------------------- | ---------------------------------------------- | ----------------------------------------- |
| `areInterfaces`      | `areInterfaces`                                | Type is an interface.                     |
| `areTypeAliases`     | `areTypeAliases`                               | Type is a type alias.                     |
| `haveProperty`       | `haveProperty(name: string)`                   | Type has a property with the name.        |
| `havePropertyOfType` | `havePropertyOfType(name: string, re: RegExp)` | Property exists with type matching regex. |
| `extendType`         | `extendType(name: string)`                     | Interface extends the named type.         |

## Call Predicates

| Export            | Signature                                                   | Description                                                                 |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `onObject`        | `onObject(name: string)`                                    | Call is on the named object (e.g., `app`). Supports nested: `router.route`. |
| `withMethod`      | `withMethod(nameOrRegex: string \| RegExp)`                 | Call method matches exact name or regex pattern.                            |
| `withArgMatching` | `withArgMatching(index: number, pattern: string \| RegExp)` | Argument at index matches regex or exact string.                            |
| `withStringArg`   | `withStringArg(index: number, glob: string)`                | String literal argument at index matches glob pattern.                      |

## Structural Conditions

| Export                      | Signature                      | Description                                     |
| --------------------------- | ------------------------------ | ----------------------------------------------- |
| `notExist`                  | `notExist()`                   | No elements should match the predicates.        |
| `beExported`                | `beExported()`                 | All matched elements should be exported.        |
| `conditionResideInFile`     | `resideInFile(glob: string)`   | All elements should reside in matching files.   |
| `conditionResideInFolder`   | `resideInFolder(glob: string)` | All elements should reside in matching folders. |
| `conditionHaveNameMatching` | `haveNameMatching(re: RegExp)` | All elements should have names matching regex.  |

## Class Conditions

| Export                        | Signature                                 | Description                                 |
| ----------------------------- | ----------------------------------------- | ------------------------------------------- |
| `shouldExtend`                | `shouldExtend(name: string)`              | Class must extend the named base class.     |
| `shouldImplement`             | `shouldImplement(name: string)`           | Class must implement the named interface.   |
| `shouldHaveMethodNamed`       | `shouldHaveMethodNamed(name: string)`     | Class must have a method with the name.     |
| `shouldNotHaveMethodMatching` | `shouldNotHaveMethodMatching(re: RegExp)` | Class must not have methods matching regex. |

## Function Conditions

| Export                     | Signature                      | Description                     |
| -------------------------- | ------------------------------ | ------------------------------- |
| `functionNotExist`         | `notExist()`                   | No functions should match.      |
| `functionBeExported`       | `beExported()`                 | Function must be exported.      |
| `functionBeAsync`          | `beAsync()`                    | Function must be async.         |
| `functionHaveNameMatching` | `haveNameMatching(re: RegExp)` | Function name must match regex. |

## Dependency Conditions

| Export                    | Signature                               | Description                                         |
| ------------------------- | --------------------------------------- | --------------------------------------------------- |
| `onlyImportFrom`          | `onlyImportFrom(...globs: string[])`    | Module may only import from listed paths.           |
| `conditionNotImportFrom`  | `notImportFrom(...globs: string[])`     | Module must not import from listed paths.           |
| `onlyHaveTypeImportsFrom` | `onlyHaveTypeImportsFrom(glob: string)` | Imports from matching paths must use `import type`. |

## Body Analysis Matchers

| Export       | Signature                              | Description                                |
| ------------ | -------------------------------------- | ------------------------------------------ |
| `call`       | `call(target: string \| RegExp)`       | Match function/method call expressions.    |
| `newExpr`    | `newExpr(target: string \| RegExp)`    | Match constructor invocations (`new ...`). |
| `access`     | `access(target: string \| RegExp)`     | Match property access expressions.         |
| `expression` | `expression(target: string \| RegExp)` | Match any expression by text.              |

## Body Analysis Conditions

| Export                 | Signature                                        | Description                                      |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `classContain`         | `classContain(matcher: ExpressionMatcher)`       | Class methods must contain expression.           |
| `classNotContain`      | `classNotContain(matcher: ExpressionMatcher)`    | Class methods must not contain expression.       |
| `classUseInsteadOf`    | `classUseInsteadOf(banned, replacement)`         | Ban expression in class, suggest replacement.    |
| `functionContain`      | `functionContain(matcher: ExpressionMatcher)`    | Function body must contain expression.           |
| `functionNotContain`   | `functionNotContain(matcher: ExpressionMatcher)` | Function body must not contain expression.       |
| `functionUseInsteadOf` | `functionUseInsteadOf(banned, replacement)`      | Ban expression in function, suggest replacement. |

## Type-Level Conditions

| Export             | Signature                                              | Description                           |
| ------------------ | ------------------------------------------------------ | ------------------------------------- |
| `havePropertyType` | `havePropertyType(name: string, matcher: TypeMatcher)` | Property must match the type matcher. |

## Type Matchers

| Export              | Signature                                    | Description                             |
| ------------------- | -------------------------------------------- | --------------------------------------- |
| `isString`          | `isString(): TypeMatcher`                    | Type is `string`.                       |
| `isNumber`          | `isNumber(): TypeMatcher`                    | Type is `number`.                       |
| `isBoolean`         | `isBoolean(): TypeMatcher`                   | Type is `boolean`.                      |
| `isUnionOfLiterals` | `isUnionOfLiterals(): TypeMatcher`           | Type is a union of literal types.       |
| `isStringLiteral`   | `isStringLiteral(): TypeMatcher`             | Type is a string literal.               |
| `arrayOf`           | `arrayOf(matcher: TypeMatcher): TypeMatcher` | Type is an array whose element matches. |
| `matching`          | `matching(re: RegExp): TypeMatcher`          | Type text matches regex.                |
| `exactly`           | `exactly(text: string): TypeMatcher`         | Type text matches exactly.              |
| `notType`           | `notType(matcher: TypeMatcher): TypeMatcher` | Negates a type matcher.                 |

## Slice Conditions

| Export              | Signature                                | Description                               |
| ------------------- | ---------------------------------------- | ----------------------------------------- |
| `beFreeOfCycles`    | `beFreeOfCycles()`                       | No circular dependencies between slices.  |
| `respectLayerOrder` | `respectLayerOrder(...layers: string[])` | Dependencies follow declared layer order. |
| `notDependOn`       | `notDependOn(slice: string)`             | No slice depends on the named slice.      |

## Call Conditions

| Export                          | Signature                                               | Description                                                         |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| `callHaveCallbackContaining`    | `haveCallbackContaining(matcher: ExpressionMatcher)`    | At least one callback argument must contain the matched expression. |
| `callNotHaveCallbackContaining` | `notHaveCallbackContaining(matcher: ExpressionMatcher)` | No callback argument may contain the matched expression.            |
| `callNotExist`                  | `notExist()`                                            | The filtered call set must be empty.                                |

See [Call Rules](/calls) for usage examples.

## Pattern Templates

| Export               | Signature                                                                                             | Description                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `definePattern`      | `definePattern(name: string, opts: { returnShape: Record<string, PropertyConstraint> }): ArchPattern` | Define a return type shape pattern.                                               |
| `followPattern`      | `followPattern(pattern: ArchPattern): Condition<ArchFunction>`                                        | Condition: function return type must match the pattern. Unwraps `Promise<T>`.     |
| `PropertyConstraint` | `string \| TypeMatcher`                                                                               | `string` = regex on type text, `'T[]'` = any array, `TypeMatcher` = programmatic. |
| `ArchPattern`        | type                                                                                                  | Pattern with `name` and `returnShape`.                                            |

See [Pattern Templates](/patterns) for usage examples.

## Smell Detectors

| Export                        | Signature                                                                  | Description                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `smells.duplicateBodies`      | `smells.duplicateBodies(p: ArchProject): DuplicateBodiesBuilder`           | Detect functions with structurally similar AST bodies.                                                           |
| `smells.inconsistentSiblings` | `smells.inconsistentSiblings(p: ArchProject): InconsistentSiblingsBuilder` | Detect sibling files missing a majority pattern.                                                                 |
| `SmellBuilder`                | class                                                                      | Base builder: `inFolder`, `minLines`, `ignoreTests`, `ignorePaths`, `groupByFolder`, `because`, `warn`, `check`. |
| `DuplicateBodiesBuilder`      | class                                                                      | Extends SmellBuilder. Adds `withMinSimilarity(n)`.                                                               |
| `InconsistentSiblingsBuilder` | class                                                                      | Extends SmellBuilder. Adds `forPattern(matcher)`.                                                                |
| `buildFingerprint`            | `buildFingerprint(node: Node): Fingerprint`                                | Build an AST fingerprint (kinds, calls, nodeCount) from a body node.                                             |
| `computeSimilarity`           | `computeSimilarity(a: Fingerprint, b: Fingerprint): number`                | LCS-based similarity between two fingerprints, normalized to [0,1].                                              |

See [Smell Detection](/smell-detection) for usage examples.

## Cross-Layer Validation

| Export                    | Signature                                                                                       | Description                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `crossLayer`              | `crossLayer(p: ArchProject): CrossLayerBuilder`                                                 | Entry point for cross-layer consistency rules.                           |
| `CrossLayerBuilder`       | class                                                                                           | Builder: `.layer(name, glob)` (2+ required) then `.mapping(fn)`.         |
| `MappedCrossLayerBuilder` | class                                                                                           | After `.mapping()`: provides `.forEachPair()`.                           |
| `PairConditionBuilder`    | class                                                                                           | After `.forEachPair()`: provides `.should(condition)`.                   |
| `PairFinalBuilder`        | class                                                                                           | Terminal: `.because()`, `.rule()`, `.check()`, `.warn()`, `.severity()`. |
| `haveMatchingCounterpart` | `haveMatchingCounterpart(layers: Layer[]): PairCondition`                                       | Every left-layer file must have a counterpart in the right layer.        |
| `haveConsistentExports`   | `haveConsistentExports(extractLeft, extractRight): PairCondition`                               | Every exported symbol in left file must appear in right file.            |
| `satisfyPairCondition`    | `satisfyPairCondition(desc: string, fn: (pair: LayerPair) => Violation \| null): PairCondition` | Custom inline pair condition.                                            |

See [Cross-Layer Validation](/cross-layer) for usage examples.

## Extension API

| Export            | Signature                                    | Description                  |
| ----------------- | -------------------------------------------- | ---------------------------- |
| `definePredicate` | `definePredicate<T>(desc, fn): Predicate<T>` | Create a custom predicate.   |
| `defineCondition` | `defineCondition<T>(desc, fn): Condition<T>` | Create a custom condition.   |
| `and`             | `and(...predicates): Predicate`              | Combine predicates with AND. |
| `or`              | `or(...predicates): Predicate`               | Combine predicates with OR.  |
| `not`             | `not(predicate): Predicate`                  | Negate a predicate.          |

## Utilities

| Export                   | Signature                                        | Description                                      |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| `createViolation`        | `createViolation(node, msg, ctx): ArchViolation` | Create a violation from a ts-morph node.         |
| `getElementName`         | `getElementName(node): string`                   | Get the name of a ts-morph node.                 |
| `getElementFile`         | `getElementFile(node): string`                   | Get the file path of a ts-morph node.            |
| `getElementLine`         | `getElementLine(node): number`                   | Get the line number of a ts-morph node.          |
| `generateCodeFrame`      | `generateCodeFrame(source, line, opts?): string` | Generate a code frame snippet.                   |
| `formatViolations`       | `formatViolations(violations, opts?): string`    | Format violations for terminal output.           |
| `formatViolationsPlain`  | `formatViolationsPlain(violations): string`      | Format violations as plain text.                 |
| `formatViolationsJson`   | `formatViolationsJson(violations): string`       | Format violations as JSON.                       |
| `formatViolationsGitHub` | `formatViolationsGitHub(violations): string`     | Format violations as GitHub Actions annotations. |
| `detectFormat`           | `detectFormat(): OutputFormat`                   | Auto-detect output format from environment.      |
| `isCI`                   | `isCI(): boolean`                                | True if running in a CI environment.             |
| `ArchRuleError`          | class                                            | Error thrown by `.check()` on violations.        |

## Check Options

| Export              | Signature                                      | Description                                       |
| ------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `withBaseline`      | `withBaseline(path: string): Baseline`         | Load a baseline file for gradual adoption.        |
| `generateBaseline`  | `generateBaseline(violations, path): void`     | Write a baseline file from current violations.    |
| `collectViolations` | `collectViolations(...rules): ArchViolation[]` | Collect violations from multiple rules.           |
| `diffAware`         | `diffAware(base: string): DiffFilter`          | Only report violations in changed files.          |
| `Baseline`          | class                                          | Baseline instance for filtering known violations. |
| `DiffFilter`        | class                                          | Diff filter instance.                             |

## ArchFunction Model

| Export                         | Signature                                          | Description                              |
| ------------------------------ | -------------------------------------------------- | ---------------------------------------- |
| `collectFunctions`             | `collectFunctions(sourceFiles): ArchFunction[]`    | Collect all functions from source files. |
| `fromFunctionDeclaration`      | `fromFunctionDeclaration(node): ArchFunction`      | Wrap a function declaration.             |
| `fromArrowVariableDeclaration` | `fromArrowVariableDeclaration(node): ArchFunction` | Wrap an arrow function variable.         |
| `fromMethodDeclaration`        | `fromMethodDeclaration(node): ArchFunction`        | Wrap a class method declaration.         |

## Callback Extraction

| Export             | Signature                                      | Description                                       |
| ------------------ | ---------------------------------------------- | ------------------------------------------------- |
| `extractCallbacks` | `extractCallbacks(calls): ExtractedCallback[]` | Extract callback functions from call expressions. |

## Scoped Rules

| Export                      | Signature                    | Description                                |
| --------------------------- | ---------------------------- | ------------------------------------------ |
| `within`                    | `within(sel): ScopedContext` | Create scoped rules from call selections.  |
| `ScopedFunctionRuleBuilder` | class                        | Builder for function rules within a scope. |

## Metrics

| Export                      | Signature                                                     | Description                                                 |
| --------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| `cyclomaticComplexity`      | `cyclomaticComplexity(body: Node \| undefined): number`       | Calculate McCabe cyclomatic complexity for a function body. |
| `linesOfCode`               | `linesOfCode(node: Node): number`                             | Count span lines (start to end, inclusive).                 |
| `haveCyclomaticComplexity`  | `haveCyclomaticComplexity(opts): Predicate<ClassDeclaration>` | Predicate: class has a method with complexity > threshold.  |
| `haveComplexity`            | `haveComplexity(opts): Predicate<ArchFunction>`               | Predicate: function has complexity > threshold.             |
| `haveMoreLinesThan`         | `haveMoreLinesThan(n): Predicate<ClassDeclaration>`           | Predicate: class spans more than n lines.                   |
| `haveMoreFunctionLinesThan` | `haveMoreFunctionLinesThan(n): Predicate<ArchFunction>`       | Predicate: function spans more than n lines.                |
| `haveMoreMethodsThan`       | `haveMoreMethodsThan(n): Predicate<ClassDeclaration>`         | Predicate: class has more than n methods.                   |

## CLI

| Export              | Signature                                    | Description                                                      |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| `defineConfig`      | `defineConfig(config: CliConfig): CliConfig` | Define CLI configuration file.                                   |
| `resetProjectCache` | `resetProjectCache(): void`                  | Clear the project singleton cache. Used by watch mode and tests. |

## Types (TypeScript)

| Export               | Kind | Description                                            |
| -------------------- | ---- | ------------------------------------------------------ |
| `ArchProject`        | type | Loaded TypeScript project.                             |
| `Predicate`          | type | Predicate interface.                                   |
| `Condition`          | type | Condition interface.                                   |
| `ConditionContext`   | type | Context passed to condition evaluators.                |
| `ArchViolation`      | type | Violation model.                                       |
| `RuleMetadata`       | type | Rule metadata (`id`, `because`, `suggestion`, `docs`). |
| `CheckOptions`       | type | Options for `.check()`.                                |
| `OutputFormat`       | type | Output format (`'terminal' \| 'github' \| 'json'`).    |
| `FormatOptions`      | type | Options for formatting functions.                      |
| `CodeFrameOptions`   | type | Options for `generateCodeFrame()`.                     |
| `ExpressionMatcher`  | type | Matcher returned by `call()`, `newExpr()`, etc.        |
| `TypeMatcher`        | type | Matcher used with `havePropertyType()`.                |
| `TypeDeclaration`    | type | Union of interface and type alias declarations.        |
| `ArchFunction`       | type | Unified function/arrow/method model.                   |
| `ArchCall`           | type | Model for matched call expressions.                    |
| `Slice`              | type | A named group of source files.                         |
| `SliceDefinition`    | type | Input to `assignedFrom()`.                             |
| `Named`              | type | Element with a name.                                   |
| `Located`            | type | Element with a file location.                          |
| `Exportable`         | type | Element that can be exported.                          |
| `BaselineEntry`      | type | Single entry in a baseline file.                       |
| `BaselineFile`       | type | Structure of the baseline JSON file.                   |
| `Layer`              | type | Layer definition for cross-layer validation.           |
| `LayerPair`          | type | Pair of elements from two layers.                      |
| `PairCondition`      | type | Condition for cross-layer pairs.                       |
| `ArchPattern`        | type | Pattern template definition.                           |
| `PropertyConstraint` | type | Property type constraint in a pattern.                 |
| `Fingerprint`        | type | AST fingerprint for similarity detection.              |
| `ScopedContext`      | type | Context returned by `within()`.                        |
| `ExtractedCallback`  | type | Callback extracted from a call expression.             |
| `CliConfig`          | type | CLI configuration object.                              |

## GraphQL Extension (`ts-archunit/graphql`)

Requires the optional `graphql` peer dependency.

### Entry Points

| Export          | Signature                                                           | Description                                 |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| `schema`        | `schema(p: ArchProject \| string, glob: string): SchemaRuleBuilder` | Rule builder for `.graphql` schema files.   |
| `schemaFromSDL` | `schemaFromSDL(sdl: string, path?): SchemaRuleBuilder`              | Rule builder from raw SDL string.           |
| `resolvers`     | `resolvers(p: ArchProject, glob: string): ResolverRuleBuilder`      | Rule builder for resolver TypeScript files. |

### Schema Predicates

| Export         | Signature                  | Description                                      |
| -------------- | -------------------------- | ------------------------------------------------ |
| `queries`      | `queries`                  | Select Query type fields.                        |
| `mutations`    | `mutations`                | Select Mutation type fields.                     |
| `typesNamed`   | `typesNamed(re: RegExp)`   | Select types matching regex.                     |
| `returnListOf` | `returnListOf(re: RegExp)` | Select fields returning a list of matching type. |

### Schema Conditions

| Export                 | Signature                                    | Description                                |
| ---------------------- | -------------------------------------------- | ------------------------------------------ |
| `haveFields`           | `haveFields(...names: string[])`             | Type must have the named fields.           |
| `acceptArgs`           | `acceptArgs(...names: string[])`             | Field must accept the named arguments.     |
| `haveMatchingResolver` | `haveMatchingResolver(resolverGlob: string)` | Schema field has a matching resolver file. |

### Resolver Predicates

| Export                  | Signature                           | Description                                        |
| ----------------------- | ----------------------------------- | -------------------------------------------------- |
| `resolveFieldReturning` | `resolveFieldReturning(re: RegExp)` | Resolver resolves a field returning matching type. |

### Schema Loader

| Export               | Signature                                      | Description                                |
| -------------------- | ---------------------------------------------- | ------------------------------------------ |
| `loadSchemaFromGlob` | `loadSchemaFromGlob(root, glob): LoadedSchema` | Load schema from glob pattern.             |
| `loadSchemaFromSDL`  | `loadSchemaFromSDL(sdl, path?): LoadedSchema`  | Load schema from SDL string.               |
| `isGraphQLAvailable` | `isGraphQLAvailable(): boolean`                | Check if the graphql package is installed. |

### Builders

| Export                | Description                              |
| --------------------- | ---------------------------------------- |
| `SchemaRuleBuilder`   | Builder for schema architecture rules.   |
| `ResolverRuleBuilder` | Builder for resolver architecture rules. |

### Types

| Export                  | Kind | Description                       |
| ----------------------- | ---- | --------------------------------- |
| `SchemaElement`         | type | Element in a GraphQL schema.      |
| `LoadedSchema`          | type | Loaded and parsed GraphQL schema. |
| `GraphQLSchemaLike`     | type | Schema interface.                 |
| `GraphQLObjectTypeLike` | type | Object type interface.            |
| `GraphQLFieldLike`      | type | Field interface.                  |
| `GraphQLArgumentLike`   | type | Argument interface.               |
| `GraphQLTypeLike`       | type | Type interface.                   |

## Standard Rules (Sub-Path Imports)

### `ts-archunit/rules/typescript`

| Export                  | Description                                                              |
| ----------------------- | ------------------------------------------------------------------------ |
| `noAnyProperties()`     | Class properties must not be typed as `any`.                             |
| `noTypeAssertions()`    | Method bodies must not contain `as` type assertions (allows `as const`). |
| `noNonNullAssertions()` | Method bodies must not contain non-null assertions (`!`).                |

### `ts-archunit/rules/security`

| Export                    | Description                         |
| ------------------------- | ----------------------------------- |
| `noEval()`                | No `eval()` calls in class methods. |
| `noFunctionConstructor()` | No `new Function()` constructor.    |
| `noConsoleLog()`          | No `console.log` calls.             |
| `noProcessEnv()`          | No direct `process.env` access.     |

### `ts-archunit/rules/errors`

| Export              | Description                                  |
| ------------------- | -------------------------------------------- |
| `noGenericErrors()` | No `new Error()` -- use typed domain errors. |
| `noTypeErrors()`    | No `new TypeError()`.                        |

### `ts-archunit/rules/naming`

| Export                           | Description                          |
| -------------------------------- | ------------------------------------ |
| `mustMatchName(re: RegExp)`      | Class name must match regex.         |
| `mustNotEndWith(suffix: string)` | Class name must not end with suffix. |

### `ts-archunit/rules/dependencies`

| Export                      | Description                                       |
| --------------------------- | ------------------------------------------------- |
| `onlyDependOn(...globs)`    | Module may only import from listed paths.         |
| `mustNotDependOn(...globs)` | Module must not import from listed paths.         |
| `typeOnlyFrom(...globs)`    | Imports from listed paths must use `import type`. |

### `ts-archunit/rules/metrics`

| Export                       | Description                                               |
| ---------------------------- | --------------------------------------------------------- |
| `maxCyclomaticComplexity(n)` | No method/constructor/getter/setter exceeds complexity n. |
| `maxClassLines(n)`           | Class spans no more than n lines.                         |
| `maxMethodLines(n)`          | No method/constructor/getter/setter exceeds n lines.      |
| `maxMethods(n)`              | Class has no more than n methods.                         |
| `maxParameters(n)`           | No method/constructor has more than n parameters.         |
| `maxFunctionComplexity(n)`   | Function complexity does not exceed n.                    |
| `maxFunctionLines(n)`        | Function spans no more than n lines.                      |
| `maxFunctionParameters(n)`   | Function has no more than n parameters.                   |
