import {
  type FunctionDeclaration,
  type VariableDeclaration,
  type MethodDeclaration,
  type SourceFile,
  type ParameterDeclaration,
  type Type,
  type Node,
  Node as NodeClass,
  Scope,
  SyntaxKind,
} from 'ts-morph'
import { collectObjectLiteralFunctions } from '../helpers/object-literal-functions.js'

/**
 * Unified representation of a TypeScript function.
 *
 * Wraps both FunctionDeclaration (`function foo() {}`) and
 * VariableDeclaration with ArrowFunction initializer (`const foo = () => {}`).
 *
 * Satisfies Named, Located, and Exportable interfaces from identity predicates.
 */
export interface ArchFunction {
  /** Function name, or undefined for anonymous functions. */
  getName(): string | undefined

  /** Source file containing this function. */
  getSourceFile(): SourceFile

  /** Whether this function is exported from its module. */
  isExported(): boolean

  /** Whether this function is declared async. */
  isAsync(): boolean

  /** Parameter declarations of this function. */
  getParameters(): ParameterDeclaration[]

  /** Return type of this function (resolved by the type checker). */
  getReturnType(): Type

  /** Function body node, for body analysis (plan 0011). */
  getBody(): Node | undefined

  /**
   * Underlying ts-morph node for violation reporting.
   * FunctionDeclaration or VariableDeclaration.
   */
  getNode(): Node

  /**
   * Start line number in the source file.
   * Used for violation reporting.
   */
  getStartLineNumber(): number

  /**
   * Visibility scope of this function.
   *
   * - Standalone functions and arrow functions are always `'public'` (module-level).
   * - Class methods return their actual modifier (`public`, `protected`, or `private`).
   *   Methods with no explicit modifier default to `'public'`.
   */
  getScope(): 'public' | 'protected' | 'private'
}

/**
 * Create an ArchFunction from a FunctionDeclaration.
 */
export function fromFunctionDeclaration(decl: FunctionDeclaration): ArchFunction {
  return {
    getName: () => decl.getName(),
    getSourceFile: () => decl.getSourceFile(),
    isExported: () => decl.isExported(),
    isAsync: () => decl.isAsync(),
    getParameters: () => decl.getParameters(),
    getReturnType: () => decl.getReturnType(),
    getBody: () => decl.getBody(),
    getNode: () => decl,
    getStartLineNumber: () => decl.getStartLineNumber(),
    getScope: () => 'public',
  }
}

/**
 * Create an ArchFunction from a VariableDeclaration whose initializer
 * is an ArrowFunction.
 *
 * Precondition: caller must verify the initializer is an ArrowFunction.
 */
export function fromArrowVariableDeclaration(decl: VariableDeclaration): ArchFunction {
  const arrow = decl.getInitializerIfKind(SyntaxKind.ArrowFunction)
  if (!arrow) throw new Error('Expected arrow function initializer')
  return {
    getName: () => decl.getName(),
    getSourceFile: () => decl.getSourceFile(),
    isExported: () => {
      // VariableDeclaration itself doesn't have isExported —
      // check the parent VariableStatement.
      const varStatement = decl.getVariableStatement()
      return varStatement?.isExported() ?? false
    },
    isAsync: () => arrow.isAsync(),
    getParameters: () => arrow.getParameters(),
    getReturnType: () => arrow.getReturnType(),
    getBody: () => arrow.getBody(),
    getNode: () => decl,
    getStartLineNumber: () => decl.getStartLineNumber(),
    getScope: () => 'public',
  }
}

/**
 * Create an ArchFunction from a class MethodDeclaration.
 *
 * Method name is prefixed with the class name for clarity in violation messages:
 * "Space.getWebhooks" instead of just "getWebhooks".
 */
export function fromMethodDeclaration(method: MethodDeclaration): ArchFunction {
  const parent = method.getParent()
  const className = NodeClass.isClassDeclaration(parent)
    ? (parent.getName() ?? '<anonymous>')
    : '<anonymous>'
  return {
    getName: () => {
      const methodName = method.getName()
      return `${className}.${methodName}`
    },
    getSourceFile: () => method.getSourceFile(),
    isExported: () => {
      // A method is "exported" if its class is exported (ADR-005: use type guard)
      const cls = method.getParent()
      if (NodeClass.isClassDeclaration(cls)) {
        return cls.isExported()
      }
      return false
    },
    isAsync: () => method.isAsync(),
    getParameters: () => method.getParameters(),
    getReturnType: () => method.getReturnType(),
    getBody: () => method.getBody(),
    getNode: () => method,
    getStartLineNumber: () => method.getStartLineNumber(),
    getScope: () => {
      const scope = method.getScope()
      if (scope === Scope.Protected) return 'protected'
      if (scope === Scope.Private) return 'private'
      return 'public'
    },
  }
}

/**
 * Options for {@link collectFunctions} / the `functions()` entry point.
 */
export interface FunctionCollectionOptions {
  /** Include class methods (pattern 3). Default: `true`. */
  includeMethods?: boolean
  /**
   * Include object-literal function property values — arrows, function
   * expressions, and method shorthand (`{ GET: () => {} }`, `{ GET(){} }`).
   * Default: `false`. Opt-in because it widens the "named unit" default set
   * (proposal 016). Each is named by its qualified property-key path.
   */
  includeObjectLiteralFunctions?: boolean
}

/**
 * Scan a source file for functions.
 *
 * Returns ArchFunction wrappers for these *named* shapes by default:
 * 1. FunctionDeclarations — `function foo() {}`
 * 2. VariableDeclarations with ArrowFunction initializer — `const foo = () => {}`
 * 3. Class MethodDeclarations — `class Foo { bar() {} }` (when includeMethods is true)
 *
 * Plus, when `includeObjectLiteralFunctions` is set (default off):
 * 4. Object-literal function property values (arrows / function expressions /
 *    method shorthand), named by their qualified property-key path.
 *
 * @param sourceFile - The source file to scan
 * @param options - {@link FunctionCollectionOptions}
 */
export function collectFunctions(
  sourceFile: SourceFile,
  options?: FunctionCollectionOptions,
): ArchFunction[] {
  const includeMethods = options?.includeMethods ?? true
  const includeObjectLiteralFunctions = options?.includeObjectLiteralFunctions ?? false
  const functions: ArchFunction[] = []

  // Pattern 1: FunctionDeclarations
  for (const fn of sourceFile.getFunctions()) {
    functions.push(fromFunctionDeclaration(fn))
  }

  // Pattern 2: const arrow functions
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    if (varDecl.getInitializerIfKind(SyntaxKind.ArrowFunction)) {
      functions.push(fromArrowVariableDeclaration(varDecl))
    }
  }

  // Pattern 3: class methods
  if (includeMethods) {
    for (const cls of sourceFile.getClasses()) {
      for (const method of cls.getMethods()) {
        functions.push(fromMethodDeclaration(method))
      }
    }
  }

  // Pattern 4: object-literal function property values (opt-in, proposal 016).
  // Collect from top-level object literals only; the shared traversal recurses
  // into nested ones, so each function is collected exactly once.
  if (includeObjectLiteralFunctions) {
    const roots = sourceFile
      .getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)
      .filter((objectLiteral) => !isNestedInObjectLiteral(objectLiteral))
    for (const root of roots) {
      for (const found of collectObjectLiteralFunctions(root)) {
        const fn = fromObjectLiteralFunction(found.node, found.keyPath)
        if (fn) functions.push(fn)
      }
    }
  }

  return functions
}

/** True if `node` is nested inside another object literal (so a root walk covers it). */
function isNestedInObjectLiteral(node: Node): boolean {
  let current = node.getParent()
  while (current) {
    if (NodeClass.isObjectLiteralExpression(current)) return true
    current = current.getParent()
  }
  return false
}

/**
 * Build an ArchFunction for an object-literal function value (arrow / function
 * expression / method shorthand), named by its qualified property-key path
 * (e.g. `routes["/x"].GET`) so violations identify the subject uniquely.
 */
export function fromObjectLiteralFunction(
  node: Node,
  keyPath: readonly string[],
): ArchFunction | undefined {
  const name = qualifiedName(keyPath)
  if (
    NodeClass.isArrowFunction(node) ||
    NodeClass.isFunctionExpression(node) ||
    NodeClass.isMethodDeclaration(node)
  ) {
    return {
      getName: () => name,
      getSourceFile: () => node.getSourceFile(),
      isExported: () => false,
      isAsync: () => node.isAsync(),
      getParameters: () => node.getParameters(),
      getReturnType: () => node.getReturnType(),
      getBody: () => node.getBody(),
      getNode: () => node,
      getStartLineNumber: () => node.getStartLineNumber(),
      getScope: () => 'public',
    }
  }
  return undefined
}

/** Render a property-key path: `a.b`, bracketing non-identifier keys (`a["/x"].c`). */
function qualifiedName(keyPath: readonly string[]): string {
  if (keyPath.length === 0) return '<anonymous>'
  return keyPath
    .map((key, index) => {
      const isIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
      if (index === 0) return key
      return isIdentifier ? `.${key}` : `[${JSON.stringify(key)}]`
    })
    .join('')
}
