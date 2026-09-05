import type { OmpHistoryMapperHooks } from "./message-history.js";
import { mapOmpAdvisorMessageToToolCall } from "./advisor-message.js";
import { mapOmpIrcMessageToToolCall, mapOmpSystemNoticeToToolCall } from "./system-notice.js";
import { mapOmpToolDetail } from "./tool-call-mapper.js";
import { resolveOmpEmittedToolCallId } from "./tool-call-id.js";
import { mapOmpTodoToolResult } from "./todo-mapper.js";

export const OMP_HISTORY_MAPPER_HOOKS: OmpHistoryMapperHooks = {
  mapToolDetail: mapOmpToolDetail,
  mapToolResult: (toolCall, result) =>
    toolCall.toolName === "todo" ? mapOmpTodoToolResult(result) : null,
  mapCustomMessage: (message, text, provider) => {
    const item =
      mapOmpAdvisorMessageToToolCall(message, text) ??
      mapOmpSystemNoticeToToolCall(text) ??
      mapOmpIrcMessageToToolCall(text);
    return item ? { type: "timeline", provider, item } : null;
  },
  resolveToolCallId: resolveOmpEmittedToolCallId,
};
