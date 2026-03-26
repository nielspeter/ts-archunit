import path from 'node:path'
import type { CheckOptions } from '../core/check-options.js'
import { importFresh } from './watch.js'

/** Minimal interface for rule builders — only needs .check() */
export interface RuleBuilderLike {
  check: (opts?: CheckOptions) => void
}

export interface LoadOptions {
  /** Use cache-busting imports for watch mode. Default: false */
  fresh?: boolean
}

/**
 * Load rule files via dynamic import (ESM).
 *
 * Rule files must export a default array of rule builders
 * or a function returning one.
 *
 * When `fresh` is true, uses cache-busting imports so that
 * re-runs in watch mode pick up file changes.
 */
export async function loadRuleFiles(
  files: string[],
  options?: LoadOptions,
): Promise<RuleBuilderLike[]> {
  const builders: RuleBuilderLike[] = []

  for (const file of files) {
    const resolved = path.resolve(file)
    const mod: unknown = options?.fresh ? await importFresh(resolved) : await import(resolved)

    const exported = extractDefault(mod)
    const items = resolveExported(exported)
    for (const item of items) {
      if (isRuleBuilderLike(item)) {
        builders.push(item)
      }
    }
  }

  return builders
}

/**
 * Resolve the exported value to an array of unknowns.
 * Supports: direct arrays, or factory functions returning arrays.
 */
function resolveExported(exported: unknown): unknown[] {
  if (Array.isArray(exported)) {
    return exported
  }
  if (typeof exported === 'function') {
    // Runtime validated: exported is a function, call it and check result
    const result: unknown = (exported as () => unknown)()
    if (Array.isArray(result)) {
      return result
    }
  }
  return []
}

function extractDefault(mod: unknown): unknown {
  if (mod === null || mod === undefined || typeof mod !== 'object') {
    return undefined
  }
  // Dynamic import returns a module namespace object — 'in' narrows safely
  if ('default' in mod) {
    return (mod as Record<string, unknown>)['default']
  }
  return undefined
}

function isRuleBuilderLike(value: unknown): value is RuleBuilderLike {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false
  }
  // Structural type check: must have a 'check' method
  return 'check' in value && typeof (value as Record<string, unknown>)['check'] === 'function'
}
