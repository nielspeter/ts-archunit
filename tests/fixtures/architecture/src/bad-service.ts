/**
 * Fixture: service that does NOT call a repository — fails mustCall(/Repository/).
 */
export function getUser(id: number): { id: number; name: string } {
  return { id, name: 'Hardcoded' }
}
