/**
 * djb2 hash of the first 200 characters of a string.
 * Used for loop/duplicate detection — fast, allocation-free.
 */
export function djb2(str: string): number {
  let hash = 5381;
  const len = Math.min(str.length, 200);
  for (let i = 0; i < len; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}
