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
