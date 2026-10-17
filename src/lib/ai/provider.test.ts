import http from "node:http";

/** Ask Kayyro's AI client against a fake OpenAI-compatible server. Run: npx tsx src/lib/ai/provider.test.ts */

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const seen: { auth?: string; body?: { model: string; tools: { function: { name: string } }[]; messages: { role: string }[] } }[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      seen.push({ auth: req.headers.authorization, body });
      res.setHeader("Content-Type", "application/json");
      if (req.headers.authorization === "Bearer bad") {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: { message: "bad key" } }));
        return;
      }
      const sawTool = body.messages.some((m: { role: string }) => m.role === "tool");
      res.end(
        JSON.stringify(
          sawTool
            ? { choices: [{ message: { content: "You sold AED 100." } }], usage: { prompt_tokens: 30, completion_tokens: 8 } }
            : {
                choices: [
                  {
                    message: {
                      content: null,
                      tool_calls: [{ id: "c1", type: "function", function: { name: "sales_summary", arguments: '{"from":"2026-10-01","to":"2026-10-31"}' } }],
                    },
                  },
                ],
                usage: { prompt_tokens: 50, completion_tokens: 12 },
              }
        )
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;

  process.env.AI_BASE_URL = `http://127.0.0.1:${port}/v1/`;
  process.env.AI_MODEL = "test-model";
  process.env.AI_API_KEY = "good";
  const { chat, aiConfigured, AiProviderError } = await import("./provider");
  const { AI_TOOLS } = await import("./tools");

  assert(aiConfigured(), "configured when AI_API_KEY is set");

  const first = await chat([{ role: "system", content: "s" }, { role: "user", content: "sales this month?" }], AI_TOOLS);
  assert(first.toolCalls.length === 1 && first.toolCalls[0].function.name === "sales_summary", "tool call is read");
  assert(JSON.parse(first.toolCalls[0].function.arguments).from === "2026-10-01", "tool arguments parse");
  assert(first.inputTokens === 50 && first.outputTokens === 12, "token counts are read");
  assert(seen[0].auth === "Bearer good" && seen[0].body?.model === "test-model", "key and model are sent");
  assert((seen[0].body?.tools.length ?? 0) === AI_TOOLS.length && seen[0].body?.tools[0].function.name === AI_TOOLS[0].name, "every tool is offered");

  const second = await chat(
    [
      { role: "user", content: "q" },
      first.assistant,
      { role: "tool", tool_call_id: "c1", content: "{}" },
    ],
    AI_TOOLS
  );
  assert(second.text === "You sold AED 100." && !second.toolCalls.length, "final answer is read");

  process.env.AI_API_KEY = "bad";
  let status = 0;
  try {
    await chat([{ role: "user", content: "q" }], AI_TOOLS);
  } catch (e) {
    if (e instanceof AiProviderError) status = e.status;
  }
  assert(status === 401, "a rejected key surfaces as a 401 provider error");

  delete process.env.AI_API_KEY;
  assert(!aiConfigured(), "not configured without a key");

  server.close();
  console.log("provider.test.ts: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
