/**
 * Minimal client for any OpenAI-compatible chat API with tool calling, so Ask
 * Kayyro can run on a free provider. Defaults to Groq's free tier; Google
 * Gemini, OpenRouter, Together and others work by changing three settings:
 *
 *   AI_API_KEY    the provider's key (required)
 *   AI_BASE_URL   default https://api.groq.com/openai/v1
 *   AI_MODEL      default llama-3.3-70b-versatile
 *
 *   Gemini:      AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  AI_MODEL=gemini-2.5-flash
 *   OpenRouter:  AI_BASE_URL=https://openrouter.ai/api/v1  AI_MODEL=meta-llama/llama-3.3-70b-instruct:free
 */

export type AiTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatResult = {
  text: string;
  toolCalls: ToolCall[];
  assistant: ChatMessage;
  inputTokens: number;
  outputTokens: number;
};

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
export const AI_MODEL = process.env.AI_MODEL || "llama-3.3-70b-versatile";

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY);
}

export async function chat(messages: ChatMessage[], tools: AiTool[]): Promise<ChatResult> {
  try {
    return await chatOnce(messages, tools);
  } catch (e) {
    // Free models now and then emit a malformed tool call (HTTP 400); a second try nearly always works
    if (e instanceof AiProviderError && e.status === 400 && /tool_use_failed|failed_generation|tool call/i.test(e.message)) {
      return chatOnce(messages, tools);
    }
    throw e;
  }
}

/**
 * One answer as a JSON object (no tools), e.g. Kayyro Collect reading a reply.
 * Asks for JSON mode; providers that don't support it get the same request without it.
 */
export async function chatJson(messages: ChatMessage[], maxTokens = 300): Promise<string> {
  const send = (jsonMode: boolean) =>
    fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        temperature: 0,
        max_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  let res = await send(true);
  if (res.status === 400) {
    const detail = await res.text().catch(() => "");
    if (/response_format|json/i.test(detail)) res = await send(false);
    else throw new AiProviderError(`AI provider returned 400: ${detail.slice(0, 300)}`, 400);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new AiProviderError(`AI provider returned ${res.status}: ${detail}`, res.status);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

async function chatOnce(messages: ChatMessage[], tools: AiTool[]): Promise<ChatResult> {
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
      tool_choice: "auto",
      temperature: 0.2,
      max_tokens: 1500,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new AiProviderError(`AI provider returned ${res.status}: ${detail}`, res.status);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = json.choices?.[0]?.message;
  const toolCalls = (msg?.tool_calls ?? []).filter((c) => c?.function?.name);
  return {
    text: (msg?.content ?? "").trim(),
    toolCalls,
    assistant: { role: "assistant", content: msg?.content ?? null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };
}
