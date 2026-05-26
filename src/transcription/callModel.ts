import { Ollama, type ChatRequest } from "ollama";
import { z } from "zod";

const ollama = new Ollama({
  host: process.env.OLLAMA_HOST ?? "http://ollama-api:11434",
});

export async function callModel<T extends z.ZodTypeAny>(
  zSchema: T,
  request: ChatRequest,
): Promise<z.infer<T>> {
  const stream = await ollama.chat({
    ...request,
    stream: true,
  });

  let content = "";
  for await (const part of stream) {
    content += part.message.content;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Ollama returned invalid JSON:\n${content}`);
  }

  return zSchema.parse(parsed);
}
