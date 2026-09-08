import { describe, expect, it } from "vitest";
import {
  StructuredAgentFallbackError,
  StructuredAgentResponseError,
} from "../../agent/agent-response-loop.js";
import type { CheckoutDiffCompare, CheckoutDiffResult } from "../../../utils/checkout-git.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import {
  createGitMetadataGenerator,
  type StructuredTextGeneration,
  type StructuredTextGenerationRequest,
} from "./git-metadata-generator.js";

type DiffSource = Pick<WorkspaceGitService, "getCheckoutDiff" | "resolveRepoRoot">;

function createDiffSource(result: CheckoutDiffResult) {
  const diffCalls: Array<{ cwd: string; options: CheckoutDiffCompare }> = [];
  const diffSource: DiffSource = {
    getCheckoutDiff: async (cwd, options) => {
      diffCalls.push({ cwd, options });
      return result;
    },
    // buildMetadataPrompt reads paseo.json overrides from here; an unknown root
    // means no override applies, so the default style is used.
    resolveRepoRoot: async () => "/tmp/git-metadata-generator-test-missing-root",
  };
  return { diffSource, diffCalls };
}

function createGeneration(handler: (request: StructuredTextGenerationRequest<unknown>) => unknown) {
  const generateCalls: Array<StructuredTextGenerationRequest<unknown>> = [];
  const generation: StructuredTextGeneration = {
    generate: async <T>(request: StructuredTextGenerationRequest<T>): Promise<T> => {
      generateCalls.push(request as StructuredTextGenerationRequest<unknown>);
      return handler(request as StructuredTextGenerationRequest<unknown>) as T;
    },
  };
  return { generation, generateCalls };
}

const readNoRecentCommitSubjects = async (): Promise<readonly string[]> => [];

function createGenerator(
  diffSource: DiffSource,
  generation: StructuredTextGeneration,
  readRecentCommitSubjects = readNoRecentCommitSubjects,
) {
  return createGitMetadataGenerator({
    workspaceGitService: diffSource,
    generation,
    readRecentCommitSubjects,
  });
}

const DIFF_WITH_ONE_FILE: CheckoutDiffResult = {
  diff: "diff --git a/src/foo.ts b/src/foo.ts\n+added\n",
  structured: [
    {
      path: "src/foo.ts",
      isNew: false,
      isDeleted: false,
      additions: 3,
      deletions: 1,
      hunks: [],
      status: "ok",
    },
  ],
};

describe("createGitMetadataGenerator", () => {
  it("generateCommitMessage returns the generated message from a staged-diff prompt", async () => {
    const { diffSource, diffCalls } = createDiffSource(DIFF_WITH_ONE_FILE);
    const { generation, generateCalls } = createGeneration(() => ({
      message: "Fix the flaky retry test",
    }));
    const recentCommitCalls: Array<{ cwd: string; limit: number }> = [];
    const generator = createGenerator(diffSource, generation, async (cwd, limit) => {
      recentCommitCalls.push({ cwd, limit });
      return [
        "feat: add repository browser",
        "fix: preserve selected account",
        "test: cover provider fallback",
      ];
    });

    const message = await generator.generateCommitMessage("/repo");

    expect(message).toBe("Fix the flaky retry test");
    expect(diffCalls).toEqual([
      { cwd: "/repo", options: { mode: "staged", includeStructured: true } },
    ]);
    expect(recentCommitCalls).toEqual([{ cwd: "/repo", limit: 12 }]);
    expect(generateCalls[0]).toMatchObject({
      cwd: "/repo",
      schemaName: "CommitMessage",
      agentTitle: "Commit generator",
    });
    expect(generateCalls[0].maxRetries).toBe(0);
    expect(generateCalls[0].prompt).toContain("M\tsrc/foo.ts\t(+3 -1)");
    expect(generateCalls[0].prompt).toContain("diff --git a/src/foo.ts");
    expect(generateCalls[0].prompt).toContain("feat: add repository browser");
  });

  it("accepts a complete multiline commit message longer than 72 characters", async () => {
    const { diffSource } = createDiffSource(DIFF_WITH_ONE_FILE);
    const detailedMessage =
      "feat: add context selection to QuickAsk\n\n" +
      "- Let users choose whether to include conversation context.\n" +
      "- Pass the selected context option when asking about quoted text.";
    const { generation } = createGeneration((request) =>
      request.schema.parse({ message: detailedMessage }),
    );

    await expect(
      createGenerator(diffSource, generation).generateCommitMessage("/repo"),
    ).resolves.toBe(detailedMessage);
  });

  it("limits commit patch context to keep generation responsive", async () => {
    const unreachableTail = "UNREACHABLE_PATCH_TAIL";
    const { diffSource } = createDiffSource({
      ...DIFF_WITH_ONE_FILE,
      diff: `${"x".repeat(30_000)}${unreachableTail}`,
    });
    const { generation, generateCalls } = createGeneration(() => ({
      message: "feat: summarize the change",
    }));
    const generator = createGenerator(diffSource, generation);

    await generator.generateCommitMessage("/repo");

    expect(generateCalls[0].prompt).toContain("diff truncated to 12000 chars");
    expect(generateCalls[0].prompt).not.toContain(unreachableTail);
  });
  it("generateCommitMessage falls back to a default message when generation exhausts its providers", async () => {
    const { diffSource } = createDiffSource(DIFF_WITH_ONE_FILE);
    const { generation } = createGeneration(() => {
      throw new StructuredAgentFallbackError([]);
    });
    const generator = createGenerator(diffSource, generation);

    await expect(generator.generateCommitMessage("/repo")).resolves.toBe("Update files");
  });

  it("generateCommitMessage falls back when the generated response cannot be validated", async () => {
    const { diffSource } = createDiffSource(DIFF_WITH_ONE_FILE);
    const { generation } = createGeneration(() => {
      throw new StructuredAgentResponseError("invalid", {
        lastResponse: "{}",
        validationErrors: ["message: required"],
      });
    });
    const generator = createGenerator(diffSource, generation);

    await expect(generator.generateCommitMessage("/repo")).resolves.toBe("Update files");
  });

  it("generateCommitMessage rethrows errors that are not structured-generation failures", async () => {
    const { diffSource } = createDiffSource(DIFF_WITH_ONE_FILE);
    const { generation } = createGeneration(() => {
      throw new Error("network down");
    });
    const generator = createGenerator(diffSource, generation);

    await expect(generator.generateCommitMessage("/repo")).rejects.toThrow("network down");
  });

  it("generatePullRequestText returns the generated title and body from a base-diff prompt", async () => {
    const { diffSource, diffCalls } = createDiffSource(DIFF_WITH_ONE_FILE);
    const { generation, generateCalls } = createGeneration(() => ({
      title: "Add retry with backoff",
      body: "Retries transient failures up to twice.",
    }));
    const generator = createGenerator(diffSource, generation);

    const result = await generator.generatePullRequestText("/repo", "main");

    expect(result).toEqual({
      title: "Add retry with backoff",
      body: "Retries transient failures up to twice.",
    });
    expect(diffCalls).toEqual([
      { cwd: "/repo", options: { mode: "base", baseRef: "main", includeStructured: true } },
    ]);
    expect(generateCalls[0]).toMatchObject({
      cwd: "/repo",
      schemaName: "PullRequest",
      agentTitle: "PR generator",
    });
    expect(generateCalls[0].prompt).toContain("Write a pull request title and body");
  });

  it("generatePullRequestText falls back to default PR text when generation fails", async () => {
    const { diffSource } = createDiffSource(DIFF_WITH_ONE_FILE);
    const { generation } = createGeneration(() => {
      throw new StructuredAgentFallbackError([]);
    });
    const generator = createGenerator(diffSource, generation);

    await expect(generator.generatePullRequestText("/repo")).resolves.toEqual({
      title: "Update changes",
      body: "Automated PR generated by Paseo.",
    });
  });
});
