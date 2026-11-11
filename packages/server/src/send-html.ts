import fs from "node:fs";
import type { FastifyReply } from "fastify";

export function sendHtmlFile(reply: FastifyReply, file: string): FastifyReply {
  if (!fs.existsSync(file)) {
    return reply
      .code(503)
      .type("text/html")
      .send(
        `<!doctype html><html><body style="font-family:system-ui;background:#111;color:#eee;padding:2rem">
        <h1>Service Maestro</h1>
        <p>The UI has not been built yet. Run <code>npm run build</code> from the project root, then restart.</p>
        <p>Expected file: <code>${file}</code></p></body></html>`,
      );
  }
  return reply.type("text/html; charset=utf-8").send(fs.readFileSync(file));
}
