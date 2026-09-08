import { describe, expect, it } from "vitest";

import { deriveTurnTokenStats, formatTokenCount } from "./turn-token-stats";

describe("formatTokenCount", () => {
  it("keeps small counts as-is", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(950)).toBe("950");
  });

  it("compacts thousands with a k suffix", () => {
    expect(formatTokenCount(4600)).toBe("4.6k");
    expect(formatTokenCount(1000)).toBe("1k");
    expect(formatTokenCount(12500)).toBe("12.5k");
  });

  it("compacts millions with an M suffix", () => {
    expect(formatTokenCount(1_250_000)).toBe("1.3M");
  });

  it("rounds fractional counts", () => {
    expect(formatTokenCount(12.4)).toBe("12");
  });
});

describe("deriveTurnTokenStats", () => {
  it("returns null without usage numbers", () => {
    expect(deriveTurnTokenStats(null, 1000)).toBeNull();
    expect(deriveTurnTokenStats({}, 1000)).toBeNull();
    expect(deriveTurnTokenStats({ inputTokens: 0, outputTokens: 0 }, 1000)).toBeNull();
  });

  it("sums input and output tokens", () => {
    const stats = deriveTurnTokenStats({ inputTokens: 1200, outputTokens: 3400 }, 8000);
    expect(stats?.totalTokens).toBe(4600);
  });

  it("falls back to output-only usage", () => {
    const stats = deriveTurnTokenStats({ outputTokens: 500 }, 1000);
    expect(stats?.totalTokens).toBe(500);
    expect(stats?.avgTokensPerSecond).toBeCloseTo(500);
  });

  it("derives average speed from duration", () => {
    const stats = deriveTurnTokenStats({ inputTokens: 10, outputTokens: 240 }, 8000);
    expect(stats?.avgTokensPerSecond).toBeCloseTo(30);
  });

  it("omits average speed without a usable duration", () => {
    const stats = deriveTurnTokenStats({ outputTokens: 240 }, 0);
    expect(stats?.avgTokensPerSecond).toBeNull();
  });
});
