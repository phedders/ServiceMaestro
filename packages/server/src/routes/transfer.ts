import type { FastifyInstance } from "fastify";
import { requireAuth, requirePermission } from "../auth.js";
import {
  exportSetlistBuffer,
  importSetlistFile,
  previewSetlistImport,
} from "../setlist-transfer.js";
import {
  buildChordSheetDocument,
  buildChordSheetPdf,
  buildMediaSheetPdf,
  buildSongSheetDocument,
  buildSongSheetPdf,
  type SetlistMediaType,
  type SongSheetFormat,
} from "../song-sheet.js";
import { saveSetlistToGit, saveTarpLibraryToGit } from "../git-store.js";
import { logActivity } from "../activity.js";

function queryBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

export async function transferRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/setlists/:id/export", { preHandler: requireAuth }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const format = String((request.query as { format?: string }).format ?? "json");
    try {
      const result = exportSetlistBuffer(id, format === "bundle");
      logActivity({
        request,
        user: request.user,
        action: "export",
        module: "setlists",
        status: 200,
        detail: format === "bundle" ? "Set-list bundle" : "Set-list JSON",
      });
      return reply
        .type(result.contentType)
        .header("content-disposition", `attachment; filename="${result.filename}"`)
        .send(result.buffer);
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  app.get(
    "/api/setlists/:id/songs.pdf",
    { preHandler: requireAuth },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const query = request.query as {
        fontSize?: string;
        columns?: string;
        bold?: string;
        chorusItalic?: string;
      };
      const fontSize = query.fontSize === undefined ? undefined : Number(query.fontSize);
      const columns = query.columns === undefined ? undefined : Number(query.columns);
      try {
        const result = await buildSongSheetPdf(id, {
          fontSize: Number.isFinite(fontSize) ? fontSize : undefined,
          columns: Number.isFinite(columns) ? columns : undefined,
          boldText: queryBool(query.bold, true),
          chorusItalic: queryBool(query.chorusItalic, true),
        });
        logActivity({
          request,
          user: request.user,
          action: "download_pdf",
          module: "setlists",
          status: 200,
          detail: `Big Print PDF${fontSize ? ` · ${fontSize}pt` : ""}${columns ? ` · ${columns} columns` : ""}`,
        });
        return reply
          .type("application/pdf")
          .header("content-disposition", `attachment; filename="${result.filename}"`)
          .header("cache-control", "no-store")
          .send(result.buffer);
      } catch (error) {
        return reply.code(404).send({ error: (error as Error).message });
      }
    },
  );

  app.get(
    "/api/setlists/:id/chords.pdf",
    { preHandler: requireAuth },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const query = request.query as {
        fontSize?: string;
        columns?: string;
        orientation?: string;
        chordsOnly?: string;
        bold?: string;
        chorusItalic?: string;
      };
      const fontSize = query.fontSize === undefined ? undefined : Number(query.fontSize);
      const columns = query.columns === undefined ? undefined : Number(query.columns);
      const orientation = query.orientation === "landscape" ? "landscape" : "portrait";
      const chordsOnly =
        query.chordsOnly === undefined ||
        !["0", "false", "no", "off"].includes(query.chordsOnly.toLowerCase());
      try {
        const result = await buildChordSheetPdf(id, {
          fontSize: Number.isFinite(fontSize) ? fontSize : undefined,
          columns: Number.isFinite(columns) ? columns : undefined,
          orientation,
          chordsOnly,
          boldText: queryBool(query.bold, true),
          chorusItalic: queryBool(query.chorusItalic, true),
        });
        logActivity({
          request,
          user: request.user,
          action: "download_pdf",
          module: "setlists",
          status: 200,
          detail: `Chords Print PDF${fontSize ? ` · ${fontSize}pt` : ""}${columns ? ` · ${columns} columns` : ""} · ${orientation}${chordsOnly ? "" : " · all songs"}`,
        });
        return reply
          .type("application/pdf")
          .header("content-disposition", `attachment; filename="${result.filename}"`)
          .header("cache-control", "no-store")
          .send(result.buffer);
      } catch (error) {
        return reply.code(404).send({ error: (error as Error).message });
      }
    },
  );

  app.get(
    "/api/setlists/:id/media.pdf",
    { preHandler: requireAuth },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const rawType = String((request.query as { type?: string }).type ?? "").toLowerCase();
      if (!["vocal", "lead", "score", "tab"].includes(rawType)) {
        return reply.code(400).send({ error: "Choose vocal, lead, score or tab media" });
      }
      const mediaType = rawType as SetlistMediaType;
      try {
        const result = await buildMediaSheetPdf(id, mediaType);
        logActivity({
          request,
          user: request.user,
          action: "download_pdf",
          module: "setlists",
          status: 200,
          detail: `${mediaType} media PDF with lyric fallback`,
        });
        return reply
          .type("application/pdf")
          .header("content-disposition", `attachment; filename="${result.filename}"`)
          .header("cache-control", "no-store")
          .send(result.buffer);
      } catch (error) {
        return reply.code(404).send({ error: (error as Error).message });
      }
    },
  );

  const documentRoutes: Array<{
    file: "songs.docx" | "songs.odf" | "chords.docx" | "chords.odf";
    kind: "songs" | "chords";
    format: SongSheetFormat;
    label: string;
  }> = [
    { file: "songs.docx", kind: "songs", format: "docx", label: "Big Print DOCX" },
    { file: "songs.odf", kind: "songs", format: "odf", label: "Big Print ODF" },
    { file: "chords.docx", kind: "chords", format: "docx", label: "Chords DOCX" },
    { file: "chords.odf", kind: "chords", format: "odf", label: "Chords ODF" },
  ];

  for (const route of documentRoutes) {
    app.get(
      `/api/setlists/:id/${route.file}`,
      { preHandler: requireAuth },
      async (request, reply) => {
        const id = (request.params as { id: string }).id;
        const query = request.query as {
          fontSize?: string;
          columns?: string;
          orientation?: string;
          chordsOnly?: string;
          bold?: string;
          chorusItalic?: string;
        };
        const fontSize = query.fontSize === undefined ? undefined : Number(query.fontSize);
        const columns = query.columns === undefined ? undefined : Number(query.columns);
        const common = {
          fontSize: Number.isFinite(fontSize) ? fontSize : undefined,
          columns: Number.isFinite(columns) ? columns : undefined,
          boldText: queryBool(query.bold, true),
          chorusItalic: queryBool(query.chorusItalic, true),
        };
        try {
          const result =
            route.kind === "songs"
              ? await buildSongSheetDocument(id, route.format, common)
              : await buildChordSheetDocument(id, route.format, {
                  ...common,
                  orientation: query.orientation === "landscape" ? "landscape" : "portrait",
                  chordsOnly: queryBool(query.chordsOnly, true),
                });
          logActivity({
            request,
            user: request.user,
            action: "download_document",
            module: "setlists",
            status: 200,
            detail: route.label,
          });
          return reply
            .type(result.contentType)
            .header("content-disposition", `attachment; filename="${result.filename}"`)
            .header("cache-control", "no-store")
            .send(result.buffer);
        } catch (error) {
          return reply.code(404).send({ error: (error as Error).message });
        }
      },
    );
  }

  app.post(
    "/api/setlists/import/preview",
    { preHandler: [requireAuth, requirePermission("setlists")] },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: 200 * 1024 * 1024, files: 1 } });
      if (!file) return reply.code(400).send({ error: "No file uploaded" });
      try {
        const buffer = await file.toBuffer();
        return { preview: previewSetlistImport(buffer, file.filename) };
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/setlists/import",
    { preHandler: [requireAuth, requirePermission("setlists")] },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: 200 * 1024 * 1024, files: 1 } });
      if (!file) return reply.code(400).send({ error: "No file uploaded" });
      try {
        const buffer = await file.toBuffer();
        const report = importSetlistFile(buffer, file.filename, request.user?.id ?? null);
        await saveSetlistToGit(report.setlistId).catch((error) =>
          request.log.warn({ err: error }, "git import save failed"),
        );
        await saveTarpLibraryToGit().catch((error) =>
          request.log.warn({ err: error }, "git Tarp import save failed"),
        );
        return reply.code(201).send({ report });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );
}
