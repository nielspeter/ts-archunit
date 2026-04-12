# API Reference

All public exports from `ts-archunit`, organized by category.

## Entry Points

| Export        | Signature                                         | Description                                                      |
| ------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| `project`     | `project(tsConfigPath: string): ArchProject`      | Load a TypeScript project. Cached per path.                      |
| `workspace`   | `workspace(tsConfigPaths: string[]): ArchProject` | Load multiple tsconfigs into a unified project for monorepo use. |
| `modules`     | `modules(p: ArchProject): ModuleRuleBuilder`      | Rule builder for source files (imports/dependencies).            |
| `classes`     | `classes(p: ArchProject): ClassRuleBuilder`       | Rule builder for class declarations.                             |
| `functions`   | `functions(p: ArchProject): FunctionRuleBuilder`  | Rule builder for functions, arrow functions, class methods.      |
| `types`       | `types(p: ArchProject): TypeRuleBuilder`          | Rule builder for interfaces and type aliases.                    |
| `slices`      | `slices(p: ArchProject): SliceRuleBuilder`        | Rule builder for file groupings (cycles, layers).                |
| `calls`       | `calls(p: ArchProject): CallRuleBuilder`          | Rule builder for call expressions.                               |
| `jsxElements` | `jsxElements(p: ArchProject): JsxRuleBuilder`     | Rule builder for JSX elements in .tsx/.jsx files.                |
| `within`      | `within(sel: CallRuleBuilder): ScopedContext`     | Scoped rule builder for callback functions inside matched calls. |

## Rule Builders

| Export                      | Description                                                |
| --------------------------- | ---------------------------------------------------------- |
| `RuleBuilder`               | Base rule builder class.                                   |
| `TerminalBuilder`           | Base terminal builder class (slices, smells, cross-layer). |
| `ModuleRuleBuilder`         | Builder returned by `modules()`.                           |
| `ClassRuleBuilder`          | Builder returned by `classes()`.                           |
| `FunctionRuleBuilder`       | Builder returned by `functions()`.                         |
| `TypeRuleBuilder`           | Builder returned by `types()`.                             |
| `SliceRuleBuilder`          | Builder returned by `slices()`.                            |
| `CallRuleBuilder`           | Builder returned by `calls()`.                             |
| `JsxRuleBuilder`            | Builder returned by `jsxElements()`.                       |
| `ScopedFunctionRuleBuilder` | Builder returned by `within().functions()`.                |

## Rule Builder Methods

Chain methods available on all rule builders (`RuleBuilder`, `SliceRuleBuilder`).

| Method            | Signature                                                          | Description                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.excluding()`    | `.excluding(...patterns: (string \| RegExp \| SilentExclusion)[])` | Permanently suppress violations matching element name (e.g., `'MyService.doWork'`), file path, or message. Strings use exact match; regex uses `.test()`. Warns on unused patterns. Wrap with `silent()` to suppress the warning. |
| `.because()`      | `.because(reason: string)`                                         | Attach a human-readable rationale to the rule.                                                                                                                                                                                    |
| `.rule()`         | `.rule(metadata: RuleMetadata)`                                    | Attach rich metadata (id, because, suggestion, docs).                                                                                                                                                                             |
| `.check()`        | `.check(options?: CheckOptions)`                                   | Execute rule; throw on violations.                                                                                                                                                                                                |
| `.warn()`         | `.warn(options?: CheckOptions)`                                    | Execute rule; log violations without throwing.                                                                                                                                                                                    |
| `.severity()`     | `.severity(level: 'error' \| 'warn')`                              | Execute with the given severity.                                                                                                                                                                                                  |
| `.violations()`   | `.violations(): ArchViolation[]`                                   | Execute rule, return violations without throwing. For programmatic access and presets.                                                                                                                                            |
| `.describeRule()` | `.describeRule(): RuleDescription`                                 | Return rule metadata without executing. Used by `explain` command.                                                                                                                                                                |

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

| Export                   | Signature                                                      | Description                                                                        |
| ------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `importFrom`             | `importFrom(...globs)` or `importFrom(globs[], options)`       | Module imports from files matching glob. Options: `{ ignoreTypeImports }`.         |
| `predicateNotImportFrom` | `notImportFrom(...globs)` or `notImportFrom(globs[], options)` | Module does not import from files matching glob. Options: `{ ignoreTypeImports }`. |
| `exportSymbolNamed`      | `exportSymbolNamed(name: string)`                              | Module exports a symbol with the name.                                             |
| `havePathMatching`       | `havePathMatching(re: RegExp)`                                 | Module file path matches regex.                                                    |

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

| Export                          | Signature                                        | Description                                           |
| ------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `areAsync`                      | `areAsync`                                       | Function is async.                                    |
| `areNotAsync`                   | `areNotAsync`                                    | Function is not async.                                |
| `arePublic`                     | `arePublic()`                                    | Function/method is public (standalone always match).  |
| `areProtected`                  | `areProtected()`                                 | Method is protected.                                  |
| `arePrivate`                    | `arePrivate()`                                   | Method is private.                                    |
| `haveParameterCount`            | `haveParameterCount(n: number)`                  | Function has exactly n parameters.                    |
| `haveParameterCountGreaterThan` | `haveParameterCountGreaterThan(n: number)`       | Function has more than n parameters.                  |
| `haveParameterCountLessThan`    | `haveParameterCountLessThan(n: number)`          | Function has fewer than n parameters.                 |
| `haveParameterNamed`            | `haveParameterNamed(name: string)`               | Function has a parameter with the name.               |
| `haveReturnType`                | `haveReturnType(type: string)`                   | Function has the given return type.                   |
| `haveRestParameter`             | `haveRestParameter()`                            | Function has a `...args` rest parameter.              |
| `haveOptionalParameter`         | `haveOptionalParameter()`                        | Function has an optional or default-valued parameter. |
| `haveParameterOfType`           | `haveParameterOfType(i: number, m: TypeMatcher)` | Parameter at index i matches the TypeMatcher.         |
| `haveParameterNameMatching`     | `haveParameterNameMatching(re: RegExp)`          | Function has a parameter name matching regex.         |

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

## JSX Predicates

| Export                     | Signature                                                      | Description                                               |
| -------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| `areHtmlElements`          | `areHtmlElements(...tags: string[])`                           | Matches HTML intrinsic elements with the given tag names. |
| `areComponents`            | `areComponents(...names?: string[])`                           | Matches component elements. No args = all components.     |
| `jsxWithAttribute`         | `withAttribute(name: string)`                                  | Filter to elements that have the named attribute.         |
| `jsxWithAttributeMatching` | `withAttributeMatching(name: string, value: string \| RegExp)` | Filter to elements where attribute matches value.         |

## JSX Conditions

| Export                        | Signature                                                         | Description                                          |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| `jsxNotExist`                 | `notExist()`                                                      | Filtered JSX element set must be empty.              |
| `jsxHaveAttribute`            | `haveAttribute(name: string)`                                     | Every matched element must have the named attribute. |
| `jsxNotHaveAttribute`         | `notHaveAttribute(name: string)`                                  | No matched element may have the named attribute.     |
| `jsxHaveAttributeMatching`    | `haveAttributeMatching(name: string, value: string \| RegExp)`    | Attribute must exist and match value.                |
| `jsxNotHaveAttributeMatching` | `notHaveAttributeMatching(name: string, value: string \| RegExp)` | Attribute must not match (or be absent).             |

## JSX Utilities

| Export               | Description                                                                         |
| -------------------- | ----------------------------------------------------------------------------------- |
| `STANDARD_HTML_TAGS` | `readonly string[]` — All standard HTML tag names for use with `areHtmlElements()`. |
| `collectJsxElements` | `(sf: SourceFile) => ArchJsxElement[]` — Collect JSX elements from a source file.   |

## Structural Conditions

| Export                      | Signature                      | Description                                     |
| --------------------------- | ------------------------------ | ----------------------------------------------- |
| `notExist`                  | `notExist()`                   | No elements should match the predicates.        |
| `beExported`                | `beExported()`                 | All matched elements should be exported.        |
| `conditionResideInFile`     | `resideInFile(glob: string)`   | All elements should reside in matching files.   |
| `conditionResideInFolder`   | `resideInFolder(glob: string)` | All elements should reside in matching folders. |
| `conditionHaveNameMatching` | `haveNameMatching(re: RegExp)` | All elements should have names matching regex.  |

## Class Conditions

| Export                          | Signature                                        | Description                                           |
| ------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `shouldExtend`                  | `shouldExtend(name: string)`                     | Class must extend the named base class.               |
| `shouldImplement`               | `shouldImplement(name: string)`                  | Class must implement the named interface.             |
| `shouldHaveMethodNamed`         | `shouldHaveMethodNamed(name: string)`            | Class must have a method with the name.               |
| `shouldNotHaveMethodMatching`   | `shouldNotHaveMethodMatching(re: RegExp)`        | Class must not have methods matching regex.           |
| `classAcceptParameterOfType`    | `acceptParameterOfType(matcher: TypeMatcher)`    | At least one param (ctor/method/setter) matches type. |
| `classNotAcceptParameterOfType` | `notAcceptParameterOfType(matcher: TypeMatcher)` | No param (ctor/method/setter) matches type.           |

## Function Conditions

| Export                             | Signature                                        | Description                                 |
| ---------------------------------- | ------------------------------------------------ | ------------------------------------------- |
| `functionNotExist`                 | `notExist()`                                     | No functions should match.                  |
| `functionBeExported`               | `beExported()`                                   | Function must be exported.                  |
| `functionBeAsync`                  | `beAsync()`                                      | Function must be async.                     |
| `functionHaveNameMatching`         | `haveNameMatching(re: RegExp)`                   | Function name must match regex.             |
| `functionHaveReturnTypeMatching`   | `haveReturnTypeMatching(matcher: TypeMatcher)`   | Return type must satisfy TypeMatcher.       |
| `functionAcceptParameterOfType`    | `acceptParameterOfType(matcher: TypeMatcher)`    | At least one parameter matches TypeMatcher. |
| `functionNotAcceptParameterOfType` | `notAcceptParameterOfType(matcher: TypeMatcher)` | No parameter matches TypeMatcher.           |

## Dependency Conditions

| Export                    | Signature                                          | Description                                                                           |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `onlyImportFrom`          | `onlyImportFrom(...globs)` or `(globs[], options)` | Module may only import from listed paths. Options: `{ ignoreTypeImports }`.           |
| `conditionNotImportFrom`  | `notImportFrom(...globs)` or `(globs[], options)`  | Module must not import from listed paths. Options: `{ ignoreTypeImports }`.           |
| `dependOn`                | `dependOn(...globs)` or `(globs[], options)`       | Module must import from at least one matching path. Options: `{ ignoreTypeImports }`. |
| `onlyHaveTypeImportsFrom` | `onlyHaveTypeImportsFrom(...globs: string[])`      | Imports from matching paths must use `import type`.                                   |
| `notHaveAliasedImports`   | `notHaveAliasedImports()`                          | No named import may use an alias (`import { x as y }`).                               |

## Body Analysis Matchers

| Export       | Signature                                                                         | Description                                               |
| ------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `call`       | `call(target: string \| RegExp)`                                                  | Match function/method call expressions.                   |
| `newExpr`    | `newExpr(target: string \| RegExp)`                                               | Match constructor invocations (`new ...`).                |
| `access`     | `access(target: string \| RegExp)`                                                | Match property access expressions.                        |
| `property`   | `property(name: string \| RegExp, value?: boolean \| number \| string \| RegExp)` | Match property assignments by name and optional value.    |
| `expression` | `expression(target: string \| RegExp)`                                            | Match any expression by text.                             |
| `jsxElement` | `jsxElement(tag: string \| RegExp)`                                               | Match JSX elements by tag name (tag-only, no attributes). |

## Body Analysis Conditions

| Export                     | Signature                                        | Description                                      |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `classContain`             | `classContain(matcher: ExpressionMatcher)`       | Class methods must contain expression.           |
| `classNotContain`          | `classNotContain(matcher: ExpressionMatcher)`    | Class methods must not contain expression.       |
| `classUseInsteadOf`        | `classUseInsteadOf(banned, replacement)`         | Ban expression in class, suggest replacement.    |
| `functionContain`          | `functionContain(matcher: ExpressionMatcher)`    | Function body must contain expression.           |
| `functionNotContain`       | `functionNotContain(matcher: ExpressionMatcher)` | Function body must not contain expression.       |
| `functionUseInsteadOf`     | `functionUseInsteadOf(banned, replacement)`      | Ban expression in function, suggest replacement. |
| `functionNotHaveEmptyBody` | `functionNotHaveEmptyBody()`                     | Function must have at least one statement.       |
| `classNotHaveEmptyBody`    | `classNotHaveEmptyBody()`                        | Class must have at least one member.             |
| `moduleContain`            | `moduleContain(matcher, options?)`               | Module must contain expression.                  |
| `moduleNotContain`         | `moduleNotContain(matcher, options?)`            | Module must not contain expression.              |
| `moduleUseInsteadOf`       | `moduleUseInsteadOf(banned, replacement, opts?)` | Ban expression in module, suggest replacement.   |

## Export Conditions

| Export                 | Signature                     | Description                                   |
| ---------------------- | ----------------------------- | --------------------------------------------- |
| `notHaveDefaultExport` | `notHaveDefaultExport()`      | Module must not have a default export.        |
| `haveDefaultExport`    | `haveDefaultExport()`         | Module must have a default export.            |
| `haveMaxExports`       | `haveMaxExports(max: number)` | Module must have at most `max` named exports. |

## Reverse Dependency Conditions

| Export                | Signature                     | Description                                            |
| --------------------- | ----------------------------- | ------------------------------------------------------ |
| `onlyBeImportedVia`   | `onlyBeImportedVia(...globs)` | All importers must match at least one glob.            |
| `beImported`          | `beImported()`                | Module must be imported by at least one other file.    |
| `haveNoUnusedExports` | `haveNoUnusedExports()`       | Every named export must be referenced by another file. |

## Property Conditions

| Export                             | Signature                                  | Description                               |
| ---------------------------------- | ------------------------------------------ | ----------------------------------------- |
| `conditionHavePropertyNamed`       | `havePropertyNamed(...names: string[])`    | All named properties must exist.          |
| `conditionNotHavePropertyNamed`    | `notHavePropertyNamed(...names: string[])` | None of the named properties may exist.   |
| `conditionHavePropertyMatching`    | `havePropertyMatching(pattern: RegExp)`    | At least one property name matches regex. |
| `conditionNotHavePropertyMatching` | `notHavePropertyMatching(pattern: RegExp)` | No property name matches regex.           |
| `haveOnlyReadonlyProperties`       | `haveOnlyReadonlyProperties()`             | All properties must be readonly.          |
| `maxProperties`                    | `maxProperties(max: number)`               | Property count must not exceed max.       |

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
| `haveArgumentWithProperty`      | `haveArgumentWithProperty(...names: string[])`          | At least one object literal arg has ALL named properties.           |
| `notHaveArgumentWithProperty`   | `notHaveArgumentWithProperty(...names: string[])`       | No object literal arg has ANY of the named properties.              |
| `callHaveArgumentContaining`    | `haveArgumentContaining(matcher: ExpressionMatcher)`    | At least one argument subtree must contain the matched expression.  |
| `callNotHaveArgumentContaining` | `notHaveArgumentContaining(matcher: ExpressionMatcher)` | No argument subtree may contain the matched expression.             |

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

| Export            | Signature                                    | Description                                            |
| ----------------- | -------------------------------------------- | ------------------------------------------------------ |
| `definePredicate` | `definePredicate<T>(desc, fn): Predicate<T>` | Create a custom predicate.                             |
| `defineCondition` | `defineCondition<T>(desc, fn): Condition<T>` | Create a custom condition.                             |
| `and`             | `and(...inputs): Predicate \| TypeMatcher`   | Combine with AND. Accepts predicates or type matchers. |
| `or`              | `or(...inputs): Predicate \| TypeMatcher`    | Combine with OR. Accepts predicates or type matchers.  |
| `not`             | `not(input): Predicate \| TypeMatcher`       | Negate. Accepts a predicate or type matcher.           |

## Utilities

| Export                   | Signature                                            | Description                                      |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------ |
| `createViolation`        | `createViolation(node, msg, ctx): ArchViolation`     | Create a violation from a ts-morph node.         |
| `getElementName`         | `getElementName(node): string`                       | Get the name of a ts-morph node.                 |
| `getElementFile`         | `getElementFile(node): string`                       | Get the file path of a ts-morph node.            |
| `getElementLine`         | `getElementLine(node): number`                       | Get the line number of a ts-morph node.          |
| `generateCodeFrame`      | `generateCodeFrame(source, line, opts?): string`     | Generate a code frame snippet.                   |
| `formatViolations`       | `formatViolations(violations, opts?): string`        | Format violations for terminal output.           |
| `formatViolationsPlain`  | `formatViolationsPlain(violations): string`          | Format violations as plain text.                 |
| `formatViolationsJson`   | `formatViolationsJson(violations): string`           | Format violations as JSON.                       |
| `formatViolationsGitHub` | `formatViolationsGitHub(violations): string`         | Format violations as GitHub Actions annotations. |
| `detectFormat`           | `detectFormat(): OutputFormat`                       | Auto-detect output format from environment.      |
| `isCI`                   | `isCI(): boolean`                                    | True if running in a CI environment.             |
| `ArchRuleError`          | class                                                | Error thrown by `.check()` on violations.        |
| `isTypeOnlyImport`       | `isTypeOnlyImport(decl: ImportDeclaration): boolean` | Check if an import is purely type-only.          |

## Check Options

| Export              | Signature                                            | Description                                                           |
| ------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| `withBaseline`      | `withBaseline(path: string): Baseline`               | Load a baseline file for gradual adoption.                            |
| `generateBaseline`  | `generateBaseline(violations, path): void`           | Write a baseline file from current violations.                        |
| `collectViolations` | `collectViolations(...rules): ArchViolation[]`       | Collect violations from multiple rules.                               |
| `diffAware`         | `diffAware(base: string): DiffFilter`                | Only report violations in changed files.                              |
| `Baseline`          | class                                                | Baseline instance for filtering known violations.                     |
| `DiffFilter`        | class                                                | Diff filter instance.                                                 |
| `silent`            | `silent(pattern: string \| RegExp): SilentExclusion` | Wrap an exclusion pattern to suppress the "unused exclusion" warning. |

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

| Export                | Kind | Description                                                         |
| --------------------- | ---- | ------------------------------------------------------------------- |
| `ArchProject`         | type | Loaded TypeScript project.                                          |
| `Predicate`           | type | Predicate interface.                                                |
| `Condition`           | type | Condition interface.                                                |
| `ConditionContext`    | type | Context passed to condition evaluators.                             |
| `ArchViolation`       | type | Violation model.                                                    |
| `RuleMetadata`        | type | Rule metadata (`id`, `because`, `suggestion`, `docs`).              |
| `RuleDescription`     | type | Structured rule description returned by `.describeRule()`.          |
| `CheckOptions`        | type | Options for `.check()`.                                             |
| `OutputFormat`        | type | Output format (`'terminal' \| 'github' \| 'json'`).                 |
| `FormatOptions`       | type | Options for formatting functions.                                   |
| `CodeFrameOptions`    | type | Options for `generateCodeFrame()`.                                  |
| `ExpressionMatcher`   | type | Matcher returned by `call()`, `newExpr()`, etc.                     |
| `TypeMatcher`         | type | Matcher used with `havePropertyType()`.                             |
| `TypeDeclaration`     | type | Union of interface and type alias declarations.                     |
| `ArchFunction`        | type | Unified function/arrow/method model.                                |
| `ArchCall`            | type | Model for matched call expressions.                                 |
| `Slice`               | type | A named group of source files.                                      |
| `SliceDefinition`     | type | Input to `assignedFrom()`.                                          |
| `Named`               | type | Element with a name.                                                |
| `Located`             | type | Element with a file location.                                       |
| `Exportable`          | type | Element that can be exported.                                       |
| `BaselineEntry`       | type | Single entry in a baseline file.                                    |
| `BaselineFile`        | type | Structure of the baseline JSON file.                                |
| `Layer`               | type | Layer definition for cross-layer validation.                        |
| `LayerPair`           | type | Pair of elements from two layers.                                   |
| `PairCondition`       | type | Condition for cross-layer pairs.                                    |
| `ArchPattern`         | type | Pattern template definition.                                        |
| `PropertyConstraint`  | type | Property type constraint in a pattern.                              |
| `Fingerprint`         | type | AST fingerprint for similarity detection.                           |
| `ScopedContext`       | type | Context returned by `within()`.                                     |
| `ExtractedCallback`   | type | Callback extracted from a call expression.                          |
| `PropertyBearingNode` | type | Union of interface, type alias, and class declarations.             |
| `ImportOptions`       | type | Options for import conditions/predicates (`{ ignoreTypeImports }`). |
| `CliConfig`           | type | CLI configuration object.                                           |

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

## Presets (`ts-archunit/presets`)

Parameterized architecture rule bundles that generate multiple coordinated rules from a single function call.

| Export                | Signature                                                 | Description                                              |
| --------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `layeredArchitecture` | `layeredArchitecture(p, options): void`                   | Layer ordering, cycles, isolation, restricted packages.  |
| `dataLayerIsolation`  | `dataLayerIsolation(p, options): void`                    | Base class extension and typed error enforcement.        |
| `strictBoundaries`    | `strictBoundaries(p, options): void`                      | No cycles, no cross-boundary imports, shared isolation.  |
| `dispatchRule`        | `dispatchRule(builder, ruleId, severity, overrides): V[]` | Run a single rule within a preset with severity control. |
| `throwIfViolations`   | `throwIfViolations(violations): void`                     | Throw aggregated ArchRuleError if violations exist.      |
| `validateOverrides`   | `validateOverrides(overrides, knownIds): void`            | Warn on unrecognized override keys.                      |

See [Architecture Presets](/presets) for full configuration options.

## Standard Rules (Sub-Path Imports)

### `ts-archunit/rules/typescript`

| Export                  | Description                                                              |
| ----------------------- | ------------------------------------------------------------------------ |
| `noAnyProperties()`     | Class properties must not be typed as `any`.                             |
| `noTypeAssertions()`    | Method bodies must not contain `as` type assertions (allows `as const`). |
| `noNonNullAssertions()` | Method bodies must not contain non-null assertions (`!`).                |

### `ts-archunit/rules/security`

| Export                            | Target    | Description                                       |
| --------------------------------- | --------- | ------------------------------------------------- |
| `noEval()`                        | classes   | No `eval()` calls in class methods.               |
| `noFunctionConstructor()`         | classes   | No `new Function()` constructor.                  |
| `noConsoleLog()`                  | classes   | No `console.log` calls.                           |
| `noProcessEnv()`                  | classes   | No direct `process.env` access.                   |
| `noConsole()`                     | classes   | No console access at all (log, warn, error, etc). |
| `noJsonParse()`                   | classes   | No `JSON.parse` calls.                            |
| `functionNoEval()`                | functions | No `eval()` calls in functions.                   |
| `functionNoFunctionConstructor()` | functions | No `new Function()` in functions.                 |
| `functionNoProcessEnv()`          | functions | No `process.env` access in functions.             |
| `functionNoConsoleLog()`          | functions | No `console.log` in functions.                    |
| `functionNoConsole()`             | functions | No console access in functions.                   |
| `functionNoJsonParse()`           | functions | No `JSON.parse` in functions.                     |
| `moduleNoEval()`                  | modules   | No `eval()` anywhere in module.                   |
| `moduleNoProcessEnv()`            | modules   | No `process.env` anywhere in module.              |
| `moduleNoConsoleLog()`            | modules   | No `console.log` anywhere in module.              |

### `ts-archunit/rules/errors`

| Export                      | Target    | Description                                   |
| --------------------------- | --------- | --------------------------------------------- |
| `noGenericErrors()`         | classes   | No `new Error()` -- use typed domain errors.  |
| `noTypeErrors()`            | classes   | No `new TypeError()`.                         |
| `functionNoGenericErrors()` | functions | No `new Error()` in functions.                |
| `functionNoTypeErrors()`    | functions | No `new TypeError()` in functions.            |
| `noSilentCatch()`           | classes   | Catch blocks must reference the caught error. |
| `functionNoSilentCatch()`   | functions | Catch blocks must reference the caught error. |
| `moduleNoSilentCatch()`     | modules   | Catch blocks must reference the caught error. |

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

### `ts-archunit/rules/architecture`

| Export                   | Target    | Description                                             |
| ------------------------ | --------- | ------------------------------------------------------- |
| `mustCall(pattern)`      | functions | Function body must contain a call matching the regex.   |
| `classMustCall(pattern)` | classes   | At least one class method must contain a matching call. |

### `ts-archunit/rules/hygiene`

| Export                     | Target    | Description                                            |
| -------------------------- | --------- | ------------------------------------------------------ |
| `noDeadModules()`          | modules   | Module must be imported by at least one other file.    |
| `noUnusedExports()`        | modules   | Every named export must be referenced by another file. |
| `noStubComments(pattern?)` | functions | No TODO/FIXME/HACK/STUB comments in function body.     |
| `noEmptyBodies()`          | functions | Functions must have at least one statement.            |

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
