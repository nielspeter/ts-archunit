import path from 'node:path'
import type { CheckOptions } from '../core/check-options.js'

/** Minimal interface for rule builders — only needs .check() */
export interface RuleBuilderLike {
  check: (opts?: CheckOptions) => void
}

/**
 * Load rule files via dynamic import (ESM).
 *
 * Rule files must export a default array of rule builders
 * or a function returning one.
 */
export async function loadRuleFiles(files: string[]): Promise<RuleBuilderLike[]> {
  const builders: RuleBuilderLike[] = []

  for (const file of files) {
    const resolved = path.resolve(file)
    const mod: unknown = await import(resolved)

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
    return exported as unknown[]
  }
  if (typeof exported === 'function') {
    const factory = exported as (...args: unknown[]) => unknown
    const result: unknown = factory()
    if (Array.isArray(result)) {
      return result as unknown[]
    }
  }
  return []
}

function extractDefault(mod: unknown): unknown {
  if (mod === null || mod === undefined || typeof mod !== 'object') {
    return undefined
  }
  const record = mod as Record<string, unknown>
  if ('default' in record) {
    return record['default']
  }
  return undefined
}

function isRuleBuilderLike(value: unknown): value is RuleBuilderLike {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    'check' in value &&
    typeof (value as Record<string, unknown>)['check'] === 'function'
  )
}
