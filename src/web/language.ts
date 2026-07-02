import type { ChangedFile } from "../shared/domain.js";
import { getSingletonHighlighter, type BundledLanguage, type Highlighter } from "shiki";

export function resolveLanguage(path: string): BundledLanguage {
  const byExtension: Record<string, BundledLanguage> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", json: "json", css: "css", html: "html", htm: "html", md: "markdown", mdx: "mdx", yml: "yaml", yaml: "yaml", swift: "swift", py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", sh: "shellscript", zsh: "shellscript", bash: "shellscript", sql: "sql", xml: "xml", vue: "vue", svelte: "svelte",
  };
  const extension = path.toLowerCase().split(".").at(-1) ?? "";
  return byExtension[extension] ?? "text";
}

export async function syntaxHighlighter(files: ChangedFile[]): Promise<Highlighter> {
  const highlighter = await getSingletonHighlighter({ themes: ["github-light"], langs: [] });
  await Promise.all([...new Set(files.map((file) => resolveLanguage(file.path)))].map((language) => highlighter.loadLanguage(language)));
  return highlighter;
}
