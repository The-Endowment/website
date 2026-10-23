/** Rejoining preserves the owner's existing choice. The launch flag controls
 * only the default shown to a wallet with no enrollment record. */
export function enrollmentUsesTracked(landlord: { reserved: readonly number[] } | null, trackedOpen: boolean): boolean {
  return landlord ? landlord.reserved[0] === 1 : trackedOpen;
}
