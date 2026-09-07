export function reverseCopy<T>(items: readonly T[]): T[] {
  const reversed: T[] = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    reversed.push(items[index]);
  }
  return reversed;
}
