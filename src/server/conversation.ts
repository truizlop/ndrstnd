import { readFile } from "node:fs/promises";
import { z } from "zod";

const portableConversationSchema = z.object({
  format: z.literal("ndrstnd-conversation-v1"),
  repository: z.object({ pathHint: z.string().optional(), branchHint: z.string().optional() }).optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    timestamp: z.string().datetime().optional(),
    text: z.string().min(1).max(100_000),
  })).min(1),
});

export interface ConversationContext {
  source: "portable-json" | "markdown";
  messages: Array<{ role: "user" | "assistant"; timestamp?: string; text: string }>;
}

export async function importConversation(path: string): Promise<ConversationContext> {
  const source = await readFile(path, "utf8");
  if (source.trimStart().startsWith("{")) {
    const parsed = portableConversationSchema.parse(JSON.parse(source));
    return { source: "portable-json", messages: parsed.messages };
  }
  const messages = parseMarkdownTranscript(source);
  if (messages.length === 0) throw new Error("Conversation Markdown contains no text.");
  return { source: "markdown", messages };
}

function parseMarkdownTranscript(source: string): ConversationContext["messages"] {
  const sections = source.split(/^#{1,3}\s+(User|Assistant)\s*$/im);
  if (sections.length === 1) {
    const text = source.trim();
    return text === "" ? [] : [{ role: "user", text }];
  }
  const messages: ConversationContext["messages"] = [];
  for (let index = 1; index < sections.length; index += 2) {
    const role = sections[index].toLowerCase() === "assistant" ? "assistant" : "user";
    const text = (sections[index + 1] ?? "").trim();
    if (text !== "") messages.push({ role, text: text.slice(0, 100_000) });
  }
  return messages;
}
