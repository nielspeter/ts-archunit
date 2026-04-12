import { Node } from 'ts-morph'
import picomatch from 'picomatch'
import type { Predicate } from '../core/predicate.js'
import type { ArchCall } from '../models/arch-call.js'

/**
 * Normalize text for matching: replace optional chaining `?.` with `.`
 * so users don't need to account for both forms.
 *
 * Same normalization as src/helpers/matchers.ts.
 */
function normalizeText(text: string): string {
  return text.replace(/\?\./g, '.')
}

/**
 * Matches calls on an object with the given name.
 *
 * For `app.get(...)`, onObject('app') matches.
 * For `router.route.get(...)`, onObject('router.route') matches.
 *
 * @param name - Exact object name (after optional-chaining normalization)
 */
export function onObject(name: string): Predicate<ArchCall> {
  return {
    description: `on object '${name}'`,
    test: (call) => {
      const obj = call.getObjectName()
      return obj !== undefined && normalizeText(obj) === name
    },
  }
}

/**
 * Matches calls whose method name matches the given pattern.
 *
 * For `app.get(...)`, withMethod('get') matches.
 * For `app.get(...)`, withMethod(/^(get|post)$/) matches.
 * For `handleError(...)` (bare call), withMethod('handleError') matches.
 *
 * @param nameOrRegex - Exact method name or regex pattern
 */
export function withMethod(nameOrRegex: string | RegExp): Predicate<ArchCall> {
  if (typeof nameOrRegex === 'string') {
    return {
      description: `with method '${nameOrRegex}'`,
      test: (call) => {
        const method = call.getMethodName()
        return method !== undefined && normalizeText(method) === nameOrRegex
      },
    }
  }
  return {
    description: `with method matching ${String(nameOrRegex)}`,
    test: (call) => {
      const method = call.getMethodName()
      return method !== undefined && nameOrRegex.test(normalizeText(method))
    },
  }
}

/**
 * Matches calls where the argument at the given index matches a pattern.
 *
 * The pattern is matched against the argument's getText() output.
 * Use for flexible argument matching (e.g., variable references, expressions).
 *
 * @param index - Zero-based argument position
 * @param pattern - Regex or exact string to match against argument text
 */
export function withArgMatching(index: number, pattern: string | RegExp): Predicate<ArchCall> {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  return {
    description: `with argument ${String(index)} matching ${String(regex)}`,
    test: (call) => {
      const args = call.getArguments()
      if (index >= args.length) return false
      const argNode = args[index]
      if (!argNode) return false
      const argText = argNode.getText()
      return regex.test(argText)
    },
  }
}

/**
 * Matches calls where the argument at the given index is a string literal
 * matching the given glob pattern.
 *
 * Only matches when the argument is an actual string literal (quoted).
 * The glob is matched against the string content (without quotes).
 *
 * @param index - Zero-based argument position
 * @param glob - Glob pattern matched against the string literal value
 *
 * @example
 * // Match: router.get('/api/users', handler)
 * // Match: router.get('/api/users/:id', handler)
 * // No match: router.get(pathVariable, handler)
 * withStringArg(0, '/api/users/**')
 */
export function withStringArg(index: number, glob: string): Predicate<ArchCall> {
  const isMatch = picomatch(glob)
  return {
    description: `with string argument ${String(index)} matching '${glob}'`,
    test: (call) => {
      const args = call.getArguments()
      if (index >= args.length) return false
      const arg = args[index]
      if (!arg) return false
      // Use ts-morph type guard (ADR-005: no duck typing or as casts)
      if (!Node.isStringLiteral(arg)) return false
      return isMatch(arg.getLiteralValue())
    },
  }
}
