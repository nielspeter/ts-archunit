import type { ArchProject } from '../core/project.js'
import { DuplicateBodiesBuilder } from './duplicate-bodies.js'
import { InconsistentSiblingsBuilder } from './inconsistent-siblings.js'

/**
 * Smell detector entry points.
 * All detectors default to .warn() — smells are advisory by design.
 */
export const smells = {
  duplicateBodies(project: ArchProject): DuplicateBodiesBuilder {
    return new DuplicateBodiesBuilder(project)
  },
  inconsistentSiblings(project: ArchProject): InconsistentSiblingsBuilder {
    return new InconsistentSiblingsBuilder(project)
  },
}
