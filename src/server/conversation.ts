import { readFile } from "node:fs/promises";
import { z } from "zod";

const MESSAGE_TEXT_LIMIT = 100_000;

const portableConversationSchema = z.object({
  format: z.literal("ndrstnd-conversation-v1"),
  repository: z.object({ pathHint: z.string().optional(), branchHint: z.string().optional() }).optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    timestamp: z.string().datetime({ offset: true }).optional(),
    text: z.string().min(1),
  })).min(1),
});

export interface ConversationContext {
  source: "portable-json" | "markdown";
  messages: Array<{ role: "user" | "assistant"; timestamp?: string; text: string }>;
}

export async function importConversation(path: string): Promise<ConversationContext> {
  const source = await readFile(path, "utf8");
  if (source.trimStart().startsWith("{")) {
    const value = parseJsonSource(path, source);
    if (value !== undefined) {
      const parsed = portableConversationSchema.safeParse(value);
      if (!parsed.success) {
        throw new Error(`Conversation file ${path} is not an ndrstnd-conversation-v1 document: ${parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`).join("; ")}`);
      }
      // Overlong messages are truncated like the markdown path instead of failing the whole import.
      return { source: "portable-json", messages: parsed.data.messages.map((message) => ({ ...message, text: message.text.slice(0, MESSAGE_TEXT_LIMIT) })) };
    }
  }
  const messages = parseMarkdownTranscript(source);
  if (messages.length === 0) throw new Error("Conversation Markdown contains no text.");
  return { source: "markdown", messages };
}

/** A .json file that does not parse deserves a clear error; other files starting with `{` fall back to the markdown reader. */
function parseJsonSource(path: string, source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    if (path.toLowerCase().endsWith(".json")) throw new Error(`Conversation file ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
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
    if (text !== "") messages.push({ role, text: text.slice(0, MESSAGE_TEXT_LIMIT) });
  }
  return messages;
}
