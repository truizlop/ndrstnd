import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importConversation } from "../src/server/conversation.js";

describe("importConversation", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("imports only documented portable conversation message fields", async () => {
    directory = await mkdtemp(join(tmpdir(), "ndrstnd-conversation-"));
    const path = join(directory, "conversation.json");
    await writeFile(path, JSON.stringify({
      format: "ndrstnd-conversation-v1",
      messages: [{ role: "user", text: "Add a trailer", toolOutput: "must not be retained" }],
    }));

    await expect(importConversation(path)).resolves.toEqual({ source: "portable-json", messages: [{ role: "user", text: "Add a trailer" }] });
  });

  it("accepts offset timestamps and truncates overlong messages instead of rejecting them", async () => {
    directory = await mkdtemp(join(tmpdir(), "ndrstnd-conversation-"));
    const path = join(directory, "conversation.json");
    await writeFile(path, JSON.stringify({
      format: "ndrstnd-conversation-v1",
      messages: [{ role: "user", timestamp: "2026-07-08T10:00:00+02:00", text: "x".repeat(150_000) }],
    }));

    const conversation = await importConversation(path);
    expect(conversation.messages[0].timestamp).toBe("2026-07-08T10:00:00+02:00");
    expect(conversation.messages[0].text).toHaveLength(100_000);
  });

  it("explains what is wrong with a JSON file that is not a portable conversation", async () => {
    directory = await mkdtemp(join(tmpdir(), "ndrstnd-conversation-"));
    const missingFormat = join(directory, "missing-format.json");
    await writeFile(missingFormat, JSON.stringify({ messages: [{ role: "user", text: "hello" }] }));
    await expect(importConversation(missingFormat)).rejects.toThrow(/not an ndrstnd-conversation-v1 document.*format/);

    const broken = join(directory, "broken.json");
    await writeFile(broken, '{"format": "ndrstnd-conversation-v1", messages: oops}');
    await expect(importConversation(broken)).rejects.toThrow(/is not valid JSON/);
  });

  it("reads a markdown transcript that happens to open with a brace", async () => {
    directory = await mkdtemp(join(tmpdir(), "ndrstnd-conversation-"));
    const path = join(directory, "conversation.md");
    await writeFile(path, "{context} We discussed the change in chat.\n");

    await expect(importConversation(path)).resolves.toEqual({
      source: "markdown",
      messages: [{ role: "user", text: "{context} We discussed the change in chat." }],
    });
  });

  it("imports readable Markdown transcripts with explicit roles", async () => {
    directory = await mkdtemp(join(tmpdir(), "ndrstnd-conversation-"));
    const path = join(directory, "conversation.md");
    await writeFile(path, "# User\nBuild the feature.\n\n# Assistant\nI added the feature.\n");

    await expect(importConversation(path)).resolves.toEqual({
      source: "markdown",
      messages: [{ role: "user", text: "Build the feature." }, { role: "assistant", text: "I added the feature." }],
    });
  });
});
