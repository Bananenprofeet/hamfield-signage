const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Case-insensitive natural string comparison ("file2" < "file10").
 * Falls back to a binary comparison so equal-ranking names still sort
 * deterministically on every platform.
 */
export function naturalCompare(a: string, b: string): number {
  const result = collator.compare(a, b);
  if (result !== 0) return result;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorts a copy of `items` by a string key using natural comparison. */
export function naturalSortBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => naturalCompare(key(a), key(b)));
}
