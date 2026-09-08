import { describe, expect, test } from "vitest";

import {
  buildHighlightedTextSegments,
  flattenWorkspaceContentSearchResults,
  splitWorkspaceContentSearchGlobs,
  type WorkspaceContentSearchFile,
} from "./content-search-model";

const files: WorkspaceContentSearchFile[] = [
  {
    path: "src/main.ts",
    matches: [
      {
        lineNumber: 2,
        text: "render render",
        ranges: [
          { start: 0, length: 6 },
          { start: 7, length: 6 },
        ],
      },
      { lineNumber: 8, text: "render", ranges: [{ start: 0, length: 6 }] },
    ],
  },
];

describe("workspace content search model", () => {
  test("keeps brace globs intact while splitting and deduplicating filters", () => {
    expect(
      splitWorkspaceContentSearchGlobs("src/**/*.{ts,tsx}, tests/**\nsrc/**/*.{ts,tsx}"),
    ).toEqual(["src/**/*.{ts,tsx}", "tests/**"]);
  });

  test("flattens expanded files and hides matches for collapsed files", () => {
    expect(flattenWorkspaceContentSearchResults(files, new Set()).map((row) => row.type)).toEqual([
      "file",
      "match",
      "match",
    ]);
    expect(flattenWorkspaceContentSearchResults(files, new Set(["src/main.ts"]))).toEqual([
      expect.objectContaining({ type: "file", matchCount: 3, collapsed: true }),
    ]);
  });

  test("clamps and merges overlapping highlight ranges", () => {
    expect(
      buildHighlightedTextSegments("abcdef", [
        { start: -2, length: 5 },
        { start: 2, length: 3 },
        { start: 20, length: 4 },
      ]),
    ).toEqual([
      { text: "abcde", matched: true },
      { text: "f", matched: false },
    ]);
  });
});
