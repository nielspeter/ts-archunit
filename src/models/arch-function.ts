import {
  type FunctionDeclaration,
  type VariableDeclaration,
  type SourceFile,
  type ParameterDeclaration,
  type Type,
  type Node,
  SyntaxKind,
} from 'ts-morph'

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
  }
}

/**
 * Create an ArchFunction from a VariableDeclaration whose initializer
 * is an ArrowFunction.
 *
 * Precondition: caller must verify the initializer is an ArrowFunction.
 */
export function fromArrowVariableDeclaration(decl: VariableDeclaration): ArchFunction {
  const arrow = decl.getInitializerIfKind(SyntaxKind.ArrowFunction)!
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
  }
}

/**
 * Scan a source file for all functions (both patterns).
 *
 * Returns ArchFunction wrappers for:
 * 1. FunctionDeclarations — `function foo() {}`
 * 2. VariableDeclarations with ArrowFunction initializer — `const foo = () => {}`
 */
export function collectFunctions(sourceFile: SourceFile): ArchFunction[] {
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

  return functions
}
