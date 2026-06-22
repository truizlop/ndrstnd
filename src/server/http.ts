import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AnalysisRevision, ReviewStore, StoredReviewSession } from "./store.js";
import { analyzeWithCodex, answerQuestionWithCodex } from "./analyze.js";
import { renderWorkspace } from "../web/page.js";

export interface ReviewServer {
  url: string;
  close(): Promise<void>;
}

export interface ReviewServerOptions {
  port?: number;
  session?: StoredReviewSession;
  revision?: AnalysisRevision;
  store?: ReviewStore;
}

export async function startReviewServer({ port = 0, session, revision, store }: ReviewServerOptions = {}): Promise<ReviewServer> {
  const launchToken = randomBytes(24).toString("base64url");
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (requestUrl.pathname === "/api/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    const authorized = requestUrl.searchParams.get("token") === launchToken;
    if (!authorized) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const activeRevision = session === undefined ? revision : store?.listRevisions(session.id)[0] ?? revision;

    if (session !== undefined && requestUrl.pathname === `/api/session/${session.id}` && requestUrl.searchParams.get("token") === launchToken) {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify(session));
      return;
    }

    if (activeRevision !== undefined && requestUrl.pathname === `/api/revision/${activeRevision.id}` && requestUrl.searchParams.get("token") === launchToken) {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify(activeRevision));
      return;
    }

    if (store !== undefined && session !== undefined && requestUrl.pathname === `/api/session/${session.id}/revisions`) {
      return sendJson(response, store.listRevisions(session.id));
    }
    if (store !== undefined && requestUrl.pathname === "/api/lenses") {
      return sendJson(response, store.listLenses());
    }
    if (store !== undefined && requestUrl.pathname === "/api/preferences") {
      if (request.method === "GET") return sendJson(response, { zoom: store.getPreference("zoom") });
      if (request.method === "POST") {
        try {
          const body = await readJson(request);
          if (typeof body.zoom !== "number" || !Number.isInteger(body.zoom) || body.zoom < 0 || body.zoom > 4) return sendJson(response, { error: "zoom must be an integer from 0 through 4." }, 400);
          store.setPreference("zoom", String(body.zoom));
          return sendJson(response, { zoom: body.zoom });
        } catch (error) {
          return sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 400);
        }
      }
    }
    if (store !== undefined && session !== undefined && activeRevision !== undefined && requestUrl.pathname === `/api/revision/${activeRevision.id}/questions`) {
      if (request.method === "GET") return sendJson(response, store.listQuestions(activeRevision.id));
      if (request.method === "POST") {
        try {
          const body = await readJson(request);
          const selection = typeof body.selection === "string" ? body.selection.slice(0, 20_000) : "";
          const question = typeof body.question === "string" ? body.question.slice(0, 2_000) : "";
          if (selection === "" || question === "") return sendJson(response, { error: "Selection and question are required." }, 400);
          const card = store.createQuestion(activeRevision.id, selection, question);
          const answer = await answerQuestionWithCodex(session.input, session.conversation, selection, question);
          store.answerQuestion(card.id, answer.answer, answer.provenance);
          return sendJson(response, { ...card, answer: answer.answer, provenance: answer.provenance });
        } catch (error) {
          return sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
        }
      }
    }
    if (store !== undefined && session !== undefined && requestUrl.pathname === `/api/session/${session.id}/reanalyze` && request.method === "POST") {
      try {
        const body = await readJson(request);
        const lens = store.getLens(typeof body.lensId === "string" ? body.lensId : "default") ?? store.getLens("default");
        if (lens === undefined) return sendJson(response, { error: "No default review lens is configured." }, 500);
        const document = await analyzeWithCodex(session.input, session.conversation, undefined, lens.instructions);
        const next = store.createRevision(session.id, "codex", "complete", document);
        return sendJson(response, next);
      } catch (error) {
        return sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
      }
    }

    if (requestUrl.pathname !== "/") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(session === undefined || activeRevision === undefined ? "ndrstnd is waiting for a review session." : renderWorkspace(session, activeRevision, launchToken));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("ndrstnd could not determine its local server address.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/?token=${launchToken}`,
    close: () => closeServer(server),
  };
}

function sendJson(response: import("node:http").ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readJson(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  let content = "";
  for await (const chunk of request) {
    content += chunk.toString();
    if (content.length > 50_000) throw new Error("Request is too large.");
  }
  const value = JSON.parse(content) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Request must be a JSON object.");
  return value as Record<string, unknown>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
