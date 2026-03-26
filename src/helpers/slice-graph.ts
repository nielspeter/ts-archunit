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
 * Build a reverse lookup map: file path -> slice name.
 * Shared by buildSliceDependencyGraph and findSliceDependencyDetails.
 */
export function buildFileToSliceMap(slices: Slice[]): Map<string, string> {
  const fileToSlice = new Map<string, string>()
  for (const slice of slices) {
    for (const file of slice.files) {
      fileToSlice.set(file.getFilePath(), slice.name)
    }
  }
  return fileToSlice
}

/**
 * Build a directed dependency graph between slices.
 *
 * For each file in each slice, resolve its imports. If an imported file
 * belongs to a different slice, add a directed edge from the importing
 * slice to the imported slice.
 *
 * @param slices - The resolved slices
 * @param fileToSlice - Pre-built file-to-slice map (optional, built internally if not provided)
 * @returns Unique directed edges between slices
 */
export function buildSliceDependencyGraph(
  slices: Slice[],
  fileToSlice?: Map<string, string>,
): SliceEdge[] {
  const map = fileToSlice ?? buildFileToSliceMap(slices)

  // Collect unique edges
  const edgeSet = new Set<string>()
  const edges: SliceEdge[] = []

  for (const slice of slices) {
    for (const file of slice.files) {
      for (const importDecl of file.getImportDeclarations()) {
        const resolved = importDecl.getModuleSpecifierSourceFile()
        if (!resolved) continue

        const targetSlice = map.get(resolved.getFilePath())
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
 * @param slices - The resolved slices
 * @param fromSliceName - Source slice name
 * @param toSliceName - Target slice name
 * @param fileToSlice - Pre-built file-to-slice map (optional, built internally if not provided)
 * @returns Array of { sourceFile, importPath, importLine }
 */
export function findSliceDependencyDetails(
  slices: Slice[],
  fromSliceName: string,
  toSliceName: string,
  fileToSlice?: Map<string, string>,
): Array<{ sourceFile: SourceFile; importPath: string; importLine: number }> {
  const map = fileToSlice ?? buildFileToSliceMap(slices)

  const fromSlice = slices.find((s) => s.name === fromSliceName)
  if (!fromSlice) return []

  const details: Array<{ sourceFile: SourceFile; importPath: string; importLine: number }> = []
  for (const file of fromSlice.files) {
    for (const importDecl of file.getImportDeclarations()) {
      const resolved = importDecl.getModuleSpecifierSourceFile()
      if (!resolved) continue

      const targetSlice = map.get(resolved.getFilePath())
      if (targetSlice === toSliceName) {
        details.push({
          sourceFile: file,
          importPath: resolved.getFilePath(),
          importLine: importDecl.getStartLineNumber(),
        })
      }
    }
  }

  return details
}
