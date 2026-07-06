import { describe, expect, it } from "vitest";
import { deriveEvidenceOrder } from "../src/server/evidence-ordering.js";
import type { ChangedFile, DiffHunk } from "../src/shared/domain.js";

describe("evidence ordering", () => {
  it("places a function definition before another hunk that calls it", () => {
    const files: ChangedFile[] = [
      { id: "impl", path: "src/server/runner.ts", status: "modified", binary: false, signal: "meaningful" },
      { id: "caller", path: "src/web/page.ts", status: "modified", binary: false, signal: "meaningful" },
    ];
    const hunks: DiffHunk[] = [
      { id: "call", fileId: "caller", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "renderPage(runJob());", newLine: 1 }] },
      { id: "def", fileId: "impl", oldStart: 1, newStart: 1, lines: [{ kind: "addition", content: "export function runJob() { return true; }", newLine: 1 }] },
    ];

    const order = deriveEvidenceOrder(hunks, files);

    expect(order.constraints).toContainEqual({ beforeEvidenceId: "def", afterEvidenceId: "call", reason: "symbol", symbol: "runJob" });
    expect(order.orderedEvidenceIds.indexOf("def")).toBeLessThan(order.orderedEvidenceIds.indexOf("call"));
  });

  it("orders shared before server before web", () => {
    const files: ChangedFile[] = [
      { id: "web", path: "src/web/page.ts", status: "modified", binary: false, signal: "meaningful" },
      { id: "shared", path: "src/shared/analysis-schema.ts", status: "modified", binary: false, signal: "meaningful" },
      { id: "server", path: "src/server/analysis-core.ts", status: "modified", binary: false, signal: "meaningful" },
    ];
    const hunks = files.map((file) => ({ id: file.id, fileId: file.id, oldStart: 1, newStart: 1, lines: [{ kind: "addition" as const, content: `const ${file.id}Value = true;`, newLine: 1 }] }));

    expect(deriveEvidenceOrder(hunks, files).orderedEvidenceIds).toEqual(["shared", "server", "web"]);
  });

  it("places tests after implementation hunks", () => {
    const files: ChangedFile[] = [
      { id: "test", path: "test/runner.test.ts", status: "modified", binary: false, signal: "meaningful" },
      { id: "impl", path: "src/server/runner.ts", status: "modified", binary: false, signal: "meaningful" },
    ];
    const hunks = files.map((file) => ({ id: file.id, fileId: file.id, oldStart: 1, newStart: 1, lines: [{ kind: "addition" as const, content: "const value = true;", newLine: 1 }] }));

    expect(deriveEvidenceOrder(hunks, files).orderedEvidenceIds).toEqual(["impl", "test"]);
  });
});
