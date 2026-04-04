/**
 * Drain a cloned SSE response to extract the usage object.
 * This runs asynchronously after the original response is returned to the SDK.
 *
 * Extracts from:
 * - message_start event: input_tokens, cache_creation_input_tokens,
 *   cache_read_input_tokens, cache_creation.ephemeral_*_input_tokens,
 *   model, server_tool_use
 * - message_delta event: output_tokens
 */
export async function drainUsageFromClone(clone) {
  if (!clone.body) return null;

  const reader = clone.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const usage = {};

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;

        try {
          const event = JSON.parse(line.slice(6));

          if (event.type === "message_start" && event.message?.usage) {
            const u = event.message.usage;
            usage.input_tokens = u.input_tokens ?? 0;
            usage.output_tokens = u.output_tokens ?? 0;
            usage.cache_creation_input_tokens = u.cache_creation_input_tokens ?? 0;
            usage.cache_read_input_tokens = u.cache_read_input_tokens ?? 0;
            usage.cache_creation = u.cache_creation || {};
            usage.server_tool_use = u.server_tool_use || {};
            usage.service_tier = u.service_tier || "";
            usage.speed = u.speed || "";
            usage._model = event.message.model || "";
          }

          if (event.type === "message_delta" && event.usage) {
            usage.output_tokens = event.usage.output_tokens ?? usage.output_tokens;
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return usage.input_tokens !== undefined ? usage : null;
}
