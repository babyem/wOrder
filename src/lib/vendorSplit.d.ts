// Typer för vendorSplit.js (ren JS så att api/telegram.js kan importera samma kod).

export interface SplitRuleItem { product_id: string; share: number }
export interface SplitRule { location: string; label: string; items: SplitRuleItem[] }

type Line = { product_id?: string; quantity: number }

export function splitQuantity(quantity: number, share: number): number
export function splitLines<T extends Line>(
  rules: SplitRule[] | null | undefined, location: string, lines: T[],
): { label: string; lines: T[] }[]
export function splitLocations<T extends Line>(
  rules: SplitRule[] | null | undefined, locations: { loc: string; items: T[] }[],
): { loc: string; items: T[] }[]
export function formatSplitText<T extends Line>(
  rules: SplitRule[] | null | undefined, location: string, lines: T[], formatLine: (line: T) => string,
): string
