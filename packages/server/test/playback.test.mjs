import test from "node:test";
import assert from "node:assert/strict";
import {
  nextPlaybackPage,
  parseImageListContent,
  parseTarpItemContent,
  serializeImageListContent,
  serializeTarpItemContent,
} from "@sm/shared";

test("bounce playback walks forwards then backwards", () => {
  let pageIndex = 0;
  let direction = 1;
  const visited = [];
  for (let step = 0; step < 9; step += 1) {
    const next = nextPlaybackPage(pageIndex, 4, "bounce", direction);
    pageIndex = next.pageIndex;
    direction = next.direction;
    visited.push(pageIndex);
  }
  assert.deepEqual(visited, [1, 2, 3, 2, 1, 0, 1, 2, 3]);
});

test("single stops on the final page and loop wraps", () => {
  const single = nextPlaybackPage(0, 2, "single", 1);
  assert.equal(single.done, false);
  assert.equal(single.pageIndex, 1);
  assert.equal(nextPlaybackPage(1, 2, "single", 1).done, true);
  assert.equal(nextPlaybackPage(2, 3, "loop", 1).pageIndex, 0);
});

test("legacy image-list and Tarp loop flags migrate to playback modes", () => {
  const legacyImageList = JSON.stringify({
    folder: "backgrounds",
    images: ["backgrounds/one.png"],
    autoplay: true,
    loop: false,
    delaySeconds: 6,
  });
  assert.equal(parseImageListContent(legacyImageList)?.mode, "single");

  const legacyTarp = JSON.stringify({
    presentationId: "presentation-1",
    autoplay: true,
    loop: true,
    delaySeconds: 6,
  });
  assert.equal(parseTarpItemContent(legacyTarp)?.mode, "loop");

  const bounceList = serializeImageListContent({
    folder: "backgrounds",
    images: ["backgrounds/one.png"],
    autoplay: true,
    mode: "bounce",
    delaySeconds: 4,
  });
  assert.equal(parseImageListContent(bounceList)?.mode, "bounce");

  const bounceTarp = serializeTarpItemContent({
    presentationId: "presentation-1",
    autoplay: true,
    mode: "bounce",
    delaySeconds: 4,
  });
  assert.equal(parseTarpItemContent(bounceTarp)?.mode, "bounce");
});
