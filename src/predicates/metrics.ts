import type { ClassDeclaration } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'
import type { ArchFunction } from '../models/arch-function.js'
import { cyclomaticComplexity, linesOfCode, methodCount } from '../helpers/complexity.js'

/**
 * Predicate: class has a method (or constructor/getter/setter) with
 * cyclomatic complexity above threshold.
 */
export function haveCyclomaticComplexity(opts: {
  greaterThan: number
}): Predicate<ClassDeclaration> {
  return {
    description: `have a method with cyclomatic complexity > ${String(opts.greaterThan)}`,
    test(cls: ClassDeclaration): boolean {
      const bodies = [
        ...cls.getMethods().map((m) => m.getBody()),
        ...cls.getConstructors().map((c) => c.getBody()),
        ...cls.getGetAccessors().map((g) => g.getBody()),
        ...cls.getSetAccessors().map((s) => s.getBody()),
      ]
      return bodies.some((body) => cyclomaticComplexity(body) > opts.greaterThan)
    },
  }
}

/**
 * Predicate: function has cyclomatic complexity above threshold.
 * Uses ArchFunction.getBody() — works for all function kinds.
 */
export function haveComplexity(opts: { greaterThan: number }): Predicate<ArchFunction> {
  return {
    description: `have cyclomatic complexity > ${String(opts.greaterThan)}`,
    test(fn: ArchFunction): boolean {
      return cyclomaticComplexity(fn.getBody()) > opts.greaterThan
    },
  }
}

/**
 * Predicate: class has more than N lines of code (span lines).
 */
export function haveMoreLinesThan(threshold: number): Predicate<ClassDeclaration> {
  return {
    description: `have more than ${String(threshold)} lines`,
    test(cls: ClassDeclaration): boolean {
      return linesOfCode(cls) > threshold
    },
  }
}

/**
 * Predicate: function has more than N lines of code (span lines).
 */
export function haveMoreFunctionLinesThan(threshold: number): Predicate<ArchFunction> {
  return {
    description: `have more than ${String(threshold)} lines`,
    test(fn: ArchFunction): boolean {
      return linesOfCode(fn.getNode()) > threshold
    },
  }
}

/**
 * Predicate: class has more than N methods.
 */
export function haveMoreMethodsThan(threshold: number): Predicate<ClassDeclaration> {
  return {
    description: `have more than ${String(threshold)} methods`,
    test(cls: ClassDeclaration): boolean {
      return methodCount(cls) > threshold
    },
  }
}
