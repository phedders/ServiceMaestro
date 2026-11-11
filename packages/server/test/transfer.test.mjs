import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { parseSetlistFile } from "../dist/setlist-transfer.js";

const MANIFEST = {
  format: "sm.setlist",
  formatVersion: 1,
  exportedAt: new Date().toISOString(),
  generator: "test",
  selfContained: false,
  setlist: {
    name: "Sunday AM",
    serviceDate: "2026-11-15",
    serviceTime: "10:30",
    notes: null,
  },
  items: [
    {
      position: 0,
      kind: "text",
      title: "Welcome",
      content: "Welcome to church.",
      maxLines: 4,
      transpose: 0,
    },
  ],
};

test("parses a reference JSON set list", () => {
  const parsed = parseSetlistFile(Buffer.from(JSON.stringify(MANIFEST)), "service.json");
  assert.equal(parsed.manifest.setlist.name, "Sunday AM");
  assert.equal(parsed.manifest.items.length, 1);
  assert.equal(parsed.files.size, 0);
});

test("parses a bundle and keeps asset bytes", () => {
  const entry = {
    ...MANIFEST,
    selfContained: true,
    assets: [
      {
        id: "a1",
        kind: "score_pdf",
        title: "Score",
        format: "pdf",
        mime: "application/pdf",
        sha256: "abc",
        bytes: 3,
        path: "assets/a1.pdf",
      },
    ],
  };
  const zip = zipSync({
    "manifest.json": strToU8(JSON.stringify(entry)),
    "assets/a1.pdf": new Uint8Array([1, 2, 3]),
  });
  const parsed = parseSetlistFile(Buffer.from(zip), "service.sm-bundle.zip");
  assert.equal(parsed.manifest.selfContained, true);
  assert.equal(parsed.files.get("assets/a1.pdf")?.length, 3);
});

test("rejects an unknown format version", () => {
  assert.throws(
    () =>
      parseSetlistFile(
        Buffer.from(JSON.stringify({ ...MANIFEST, formatVersion: 99 })),
        "bad.json",
      ),
    /Invalid set list file/,
  );
});
