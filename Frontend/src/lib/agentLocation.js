/**
 * Resolve the store location linked to a sales agent (managerUserId or legacy manager name match).
 * @param {Array<{ id: string, manager?: string, managerUserId?: string, address?: string, name?: string }>} locations
 * @param {{ id?: string, name?: string } | null | undefined} user
 * @returns {{ id: string, name: string, address?: string, manager?: string, managerUserId?: string } | null}
 */
export function findAgentStoreLocation(locations, user) {
  if (!user?.id) return null
  const byLink = locations.find((l) => l.managerUserId === user.id)
  if (byLink) return byLink
  const name = (user.name || "").trim()
  if (!name) return null
  return locations.find((l) => !l.managerUserId && String(l.manager || "").trim() === name) ?? null
}
