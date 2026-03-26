import type { SourceFile } from 'ts-morph'
import type { Slice } from '../models/slice.js'

/**
 * An edge in the slice dependency graph.
 * Represents: a file in `from` imports a file in `to`.
 */
export interface SliceEdge {
  from: string
  to: string
}

/**
 * Build a directed dependency graph between slices.
 *
 * For each file in each slice, resolve its imports. If an imported file
 * belongs to a different slice, add a directed edge from the importing
 * slice to the imported slice.
 *
 * @param slices - The resolved slices
 * @returns Unique directed edges between slices
 */
export function buildSliceDependencyGraph(slices: Slice[]): SliceEdge[] {
  // Build a reverse lookup: file path -> slice name
  const fileToSlice = new Map<string, string>()
  for (const slice of slices) {
    for (const file of slice.files) {
      fileToSlice.set(file.getFilePath(), slice.name)
    }
  }

  // Collect unique edges
  const edgeSet = new Set<string>()
  const edges: SliceEdge[] = []

  for (const slice of slices) {
    for (const file of slice.files) {
      for (const importDecl of file.getImportDeclarations()) {
        const resolved = importDecl.getModuleSpecifierSourceFile()
        if (!resolved) continue

        const targetSlice = fileToSlice.get(resolved.getFilePath())
        if (targetSlice && targetSlice !== slice.name) {
          const edgeKey = `${slice.name}->${targetSlice}`
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey)
            edges.push({ from: slice.name, to: targetSlice })
          }
        }
      }
    }
  }

  return edges
}

/**
 * Find which specific files cause a dependency from one slice to another.
 * Used for detailed violation messages.
 *
 * @returns Array of { sourceFile, importPath, fromSlice, toSlice }
 */
export function findSliceDependencyDetails(
  slices: Slice[],
  fromSliceName: string,
  toSliceName: string,
): Array<{ sourceFile: SourceFile; importPath: string }> {
  const fileToSlice = new Map<string, string>()
  for (const slice of slices) {
    for (const file of slice.files) {
      fileToSlice.set(file.getFilePath(), slice.name)
    }
  }

  const fromSlice = slices.find((s) => s.name === fromSliceName)
  if (!fromSlice) return []

  const details: Array<{ sourceFile: SourceFile; importPath: string }> = []
  for (const file of fromSlice.files) {
    for (const importDecl of file.getImportDeclarations()) {
      const resolved = importDecl.getModuleSpecifierSourceFile()
      if (!resolved) continue

      const targetSlice = fileToSlice.get(resolved.getFilePath())
      if (targetSlice === toSliceName) {
        details.push({
          sourceFile: file,
          importPath: resolved.getFilePath(),
        })
      }
    }
  }

  return details
}
