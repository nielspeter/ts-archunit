import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { project } from '../../src/core/project.js'
import type { ArchProject } from '../../src/core/project.js'

/**
 * Load a test fixture project by fixture directory name.
 * @param fixtureName - Name of the directory under tests/fixtures/
 */
export function loadFixture(fixtureName: string): ArchProject {
  const testsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  return project(path.resolve(testsDir, `fixtures/${fixtureName}/tsconfig.json`))
}
