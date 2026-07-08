import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../src/shared/domain.js";
import { classifyFile, finalizeFiles, parseNameStatus, parsePatch, stableId, statusFor, untrackedFiles } from "../src/server/git-model.js";

describe("git model", () => {
  it("parses name-status output including renames and copies", () => {
    const files = parseNameStatus(["M", "app.ts", "R100", "old.ts", "new.ts", "C100", "template.ts", "copy.ts", ""].join("\0"));

    expect(files).toEqual([
      { id: stableId("app.ts"), path: "app.ts", previousPath: undefined, status: "modified", binary: false, signal: "meaningful" },
      { id: stableId("new.ts"), path: "new.ts", previousPath: "old.ts", status: "renamed", binary: false, signal: "meaningful" },
      { id: stableId("copy.ts"), path: "copy.ts", previousPath: "template.ts", status: "copied", binary: false, signal: "meaningful" },
    ]);
  });

  it("parses patch hunks and reports binary files without mutating inputs", () => {
    const files: ChangedFile[] = [
      { id: "source", path: "app.ts", status: "modified", binary: false, signal: "meaningful" },
      { id: "image", path: "image.png", status: "modified", binary: false, signal: "meaningful" },
    ];
    const parsed = parsePatch([
      "diff --git a/app.ts b/app.ts",
      "@@ -1,2 +1,2 @@",
      " export const value = 1;",
      "-old();",
      "+next();",
      "\\ No newline at end of file",
      "diff --git a/image.png b/image.png",
      "Binary files a/image.png and b/image.png differ",
    ].join("\n"), files);

    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0]).toMatchObject({
      fileId: "source",
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: "context", content: "export const value = 1;", oldLine: 1, newLine: 1 },
        { kind: "deletion", content: "old();", oldLine: 2 },
        { kind: "addition", content: "next();", newLine: 2 },
      ],
    });
    expect([...parsed.binaryFileIds]).toEqual(["image"]);
    expect(files[1]?.binary).toBe(false);
  });

  it("attributes hunks through C-quoted, spaced, and rename diff headers", () => {
    const files: ChangedFile[] = [
      { id: "unicode", path: "café.txt", status: "added", binary: false, signal: "meaningful" },
      { id: "spaced", path: "a b/c.txt", status: "modified", binary: false, signal: "meaningful" },
      { id: "quoted", path: "qu\"ote.txt", status: "added", binary: false, signal: "meaningful" },
      { id: "renamed", path: "cafe2.txt", previousPath: "café.txt", status: "renamed", binary: false, signal: "meaningful" },
      { id: "plain-unicode", path: "naïve.txt", status: "added", binary: false, signal: "meaningful" },
    ];
    const parsed = parsePatch([
      "diff --git \"a/caf\\303\\251.txt\" \"b/caf\\303\\251.txt\"",
      "@@ -0,0 +1 @@",
      "+unicode",
      "diff --git a/a b/c.txt b/a b/c.txt",
      "@@ -1 +1 @@",
      "-before",
      "+after",
      "diff --git \"a/qu\\\"ote.txt\" \"b/qu\\\"ote.txt\"",
      "@@ -0,0 +1 @@",
      "+quote",
      "diff --git \"a/caf\\303\\251.txt\" b/cafe2.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/naïve.txt b/naïve.txt",
      "@@ -0,0 +1 @@",
      "+plain",
    ].join("\n"), files);

    expect(parsed.hunks.map((hunk) => hunk.fileId)).toEqual(["unicode", "spaced", "quoted", "renamed", "plain-unicode"]);
  });

  it("creates untracked file records without duplicating known paths", () => {
    const known: ChangedFile[] = [{ id: "known", path: "known.ts", status: "modified", binary: false, signal: "meaningful" }];

    expect(untrackedFiles(["known.ts", "new.ts"], known)).toEqual([
      { id: stableId("new.ts"), path: "new.ts", status: "added", binary: false, signal: "meaningful" },
    ]);
  });

  it("finalizes binary and low-signal file classification deterministically", () => {
    const files: ChangedFile[] = [
      { id: "source", path: "src/app.ts", status: "modified", binary: false, signal: "meaningful" },
      { id: "lock", path: "package-lock.json", status: "modified", binary: false, signal: "meaningful" },
      { id: "image", path: "image.png", status: "modified", binary: false, signal: "meaningful" },
    ];
    const finalized = finalizeFiles(files, [{ id: "hunk", fileId: "source", oldStart: 1, newStart: 1, lines: [] }], new Set(["image"]));

    expect(finalized).toMatchObject([
      { path: "src/app.ts", binary: false, signal: "meaningful", signalReason: undefined },
      { path: "package-lock.json", binary: false, signal: "low-signal", signalReason: "Lockfile" },
      { path: "image.png", binary: true, signal: "low-signal", signalReason: "Binary change" },
    ]);
    expect(files[1]?.binary).toBe(false);
  });

  it("labels hunk-less changes by what they are instead of calling them binary", () => {
    const files: ChangedFile[] = [
      { id: "moved", path: "src/next.ts", previousPath: "src/prior.ts", status: "renamed", binary: false, signal: "meaningful" },
      { id: "copied", path: "src/copy.ts", previousPath: "src/original.ts", status: "copied", binary: false, signal: "meaningful" },
      { id: "empty", path: "src/empty.ts", status: "added", binary: false, signal: "meaningful" },
      { id: "mode", path: "scripts/run.sh", status: "modified", binary: false, signal: "meaningful" },
    ];
    const finalized = finalizeFiles(files, [], new Set());

    expect(finalized).toMatchObject([
      { path: "src/next.ts", binary: false, signal: "low-signal", signalReason: "Rename without content changes" },
      { path: "src/copy.ts", binary: false, signal: "low-signal", signalReason: "Copy without content changes" },
      { path: "src/empty.ts", binary: false, signal: "low-signal", signalReason: "No content changes" },
      { path: "scripts/run.sh", binary: false, signal: "low-signal", signalReason: "No content changes" },
    ]);
  });

  it("classifies statuses and low-signal paths", () => {
    expect(statusFor("A")).toBe("added");
    expect(statusFor("?")).toBe("unknown");
    expect(classifyFile("vendor/lib.js", false)).toEqual({ signal: "low-signal", reason: "Vendored dependency" });
    expect(classifyFile("dist/app.js", false)).toEqual({ signal: "low-signal", reason: "Generated output" });
    expect(classifyFile("src/app.ts", false)).toEqual({ signal: "meaningful" });
  });
});
