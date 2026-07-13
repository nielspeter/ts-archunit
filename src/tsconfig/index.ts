import type { ArchProject } from '../core/project.js'
import { TsconfigBuilder } from './tsconfig-builder.js'

/**
 * Assert facts about a project's resolved TypeScript compiler options.
 *
 * Returns a builder with the same `.because()` / `.rule()` / `.excluding()` /
 * `.check()` / `.warn()` / `.asSeverity()` / `.violations()` surface as every
 * other rule. A flat top-level entry point like `project` — deliberately NOT a
 * `config` namespace, which would collide with the tool's own
 * `defineConfig` / `CliConfig` ("configure the tool") surface.
 *
 * @example
 * tsconfig(p)
 *   .requires({ strict: true, noUncheckedIndexedAccess: true })
 *   .because('ADR-001 requires strict mode')
 *   .check()
 */
export function tsconfig(project: ArchProject): TsconfigBuilder {
  return new TsconfigBuilder(project)
}
