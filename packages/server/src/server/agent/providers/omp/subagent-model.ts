export function buildOmpModelId(provider: unknown, model: unknown): string | null {
  if (typeof provider !== "string" || typeof model !== "string") return null;
  const normalizedProvider = provider.trim();
  const normalizedModel = model.trim();
  return normalizedProvider && normalizedModel ? `${normalizedProvider}/${normalizedModel}` : null;
}

export function readOmpAssistantModel(message: {
  role?: unknown;
  provider?: unknown;
  model?: unknown;
  responseModel?: unknown;
}): string | null {
  if (message.role !== "assistant") return null;
  return (
    buildOmpModelId(message.provider, message.responseModel) ??
    buildOmpModelId(message.provider, message.model)
  );
}
