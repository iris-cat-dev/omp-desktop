import type { WorkspaceTextSearchResponse } from "@omp-desktop/protocol/messages";

export type WorkspaceContentSearchFile = WorkspaceTextSearchResponse["payload"]["files"][number];
export type WorkspaceContentSearchMatch = WorkspaceContentSearchFile["matches"][number];

export type WorkspaceContentSearchRow =
  | {
      type: "file";
      key: string;
      file: WorkspaceContentSearchFile;
      matchCount: number;
      collapsed: boolean;
    }
  | {
      type: "match";
      key: string;
      path: string;
      match: WorkspaceContentSearchMatch;
    };

export interface HighlightedTextSegment {
  text: string;
  matched: boolean;
}

export function countWorkspaceContentSearchFileMatches(file: WorkspaceContentSearchFile): number {
  return file.matches.reduce((count, match) => count + match.ranges.length, 0);
}

export function flattenWorkspaceContentSearchResults(
  files: readonly WorkspaceContentSearchFile[],
  collapsedPaths: ReadonlySet<string>,
): WorkspaceContentSearchRow[] {
  const rows: WorkspaceContentSearchRow[] = [];
  for (const file of files) {
    const collapsed = collapsedPaths.has(file.path);
    rows.push({
      type: "file",
      key: `file:${file.path}`,
      file,
      matchCount: countWorkspaceContentSearchFileMatches(file),
      collapsed,
    });
    if (collapsed) continue;
    file.matches.forEach((match, index) => {
      rows.push({
        type: "match",
        key: `match:${file.path}:${match.lineNumber}:${index}`,
        path: file.path,
        match,
      });
    });
  }
  return rows;
}

export function splitWorkspaceContentSearchGlobs(value: string): string[] {
  const globs: string[] = [];
  let current = "";
  let braceDepth = 0;
  for (const character of value) {
    if (character === "{") braceDepth += 1;
    if (character === "}" && braceDepth > 0) braceDepth -= 1;
    if ((character === "," && braceDepth === 0) || character === "\n") {
      const glob = current.trim();
      if (glob) globs.push(glob);
      current = "";
      continue;
    }
    current += character;
  }
  const finalGlob = current.trim();
  if (finalGlob) globs.push(finalGlob);
  return [...new Set(globs)];
}

export function buildHighlightedTextSegments(
  text: string,
  ranges: readonly { start: number; length: number }[],
): HighlightedTextSegment[] {
  const normalizedRanges = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(text.length, range.start)),
      end: Math.max(0, Math.min(text.length, range.start + range.length)),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce<Array<{ start: number; end: number }>>((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);

  const segments: HighlightedTextSegment[] = [];
  let cursor = 0;
  for (const range of normalizedRanges) {
    if (range.start > cursor)
      segments.push({ text: text.slice(cursor, range.start), matched: false });
    segments.push({ text: text.slice(range.start, range.end), matched: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matched: false });
  return segments.length > 0 ? segments : [{ text, matched: false }];
}
