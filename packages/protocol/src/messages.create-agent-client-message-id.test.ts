import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema } from "./messages";
import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "@omp-desktop/protocol/agent-title-limits";

describe("create_agent_request clientMessageId", () => {
  it("accepts clientMessageId for stable initial prompt transfer", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-1",
      clientMessageId: "client-msg-1",
      config: {
        provider: "claude",
        cwd: "/tmp/project",
      },
      initialPrompt: "hello",
    });

    expect(parsed.type).toBe("create_agent_request");
    if (parsed.type !== "create_agent_request") {
      throw new Error("Expected create_agent_request");
    }
    expect(parsed.clientMessageId).toBe("client-msg-1");
  });

  it("accepts one-off quick ask requests", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "quick_ask_request",
      requestId: "req-quick-ask",
      config: {
        provider: "claude",
        cwd: "/tmp/project",
      },
      selectedText: "Selected content",
      question: "What does this mean?",
    });

    expect(parsed.type).toBe("quick_ask_request");
    if (parsed.type !== "quick_ask_request") {
      throw new Error("Expected quick_ask_request");
    }
    expect(parsed.question).toBe("What does this mean?");
  });

  it("accepts explicit titles up to the create-agent limit", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-title-ok",
      config: {
        provider: "claude",
        cwd: "/tmp/project",
        title: "x".repeat(MAX_EXPLICIT_AGENT_TITLE_CHARS),
      },
    });

    expect(parsed.type).toBe("create_agent_request");
    if (parsed.type !== "create_agent_request") {
      throw new Error("Expected create_agent_request");
    }
    expect(parsed.config.title).toHaveLength(MAX_EXPLICIT_AGENT_TITLE_CHARS);
  });

  it("rejects explicit titles longer than the create-agent limit", () => {
    const parsed = SessionInboundMessageSchema.safeParse({
      type: "create_agent_request",
      requestId: "req-title-too-long",
      config: {
        provider: "claude",
        cwd: "/tmp/project",
        title: "x".repeat(MAX_EXPLICIT_AGENT_TITLE_CHARS + 1),
      },
    });

    expect(parsed.success).toBe(false);
  });
});
