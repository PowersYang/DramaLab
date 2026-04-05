import { describe, expect, it } from "vitest";

import fs from "fs";
import os from "os";
import path from "path";

import {
  collectReferencedVendorChunks,
  findMissingVendorChunks,
  inspectNextDevCache,
} from "./nextDevCacheHealth.mjs";

describe("nextDevCacheHealth", () => {
  it("collects vendor chunk ids referenced by compiled app pages", () => {
    const compiledPage = `
      var __webpack_exports__ = __webpack_require__.X(0, [
        "vendor-chunks/next",
        "vendor-chunks/framer-motion",
        "vendor-chunks/motion-dom"
      ], () => (__webpack_exec__("demo")));
    `;

    expect(collectReferencedVendorChunks(compiledPage)).toEqual([
      "vendor-chunks/next",
      "vendor-chunks/framer-motion",
      "vendor-chunks/motion-dom",
    ]);
  });

  it("reports only the vendor chunks that are missing on disk", () => {
    const compiledPages = [
      `
        __webpack_require__.X(0, [
          "vendor-chunks/next",
          "vendor-chunks/framer-motion",
          "vendor-chunks/lucide-react"
        ], () => (__webpack_exec__("page-a")));
      `,
      `
        __webpack_require__.X(0, [
          "vendor-chunks/framer-motion",
          "vendor-chunks/motion-dom"
        ], () => (__webpack_exec__("page-b")));
      `,
    ];

    expect(
      findMissingVendorChunks(compiledPages, [
        "vendor-chunks/next",
        "vendor-chunks/lucide-react",
      ]),
    ).toEqual([
      "vendor-chunks/framer-motion",
      "vendor-chunks/motion-dom",
    ]);
  });

  it("skips reset when the dev-only vendor-chunks directory does not exist", () => {
    const frontendDir = fs.mkdtempSync(path.join(os.tmpdir(), "dramalab-next-cache-"));

    fs.mkdirSync(path.join(frontendDir, ".next", "server", "app"), { recursive: true });
    fs.writeFileSync(
      path.join(frontendDir, ".next", "server", "app", "page.js"),
      `
        __webpack_require__.X(0, [
          "vendor-chunks/next",
          "vendor-chunks/framer-motion"
        ], () => (__webpack_exec__("page")));
      `,
      "utf8",
    );

    expect(inspectNextDevCache(frontendDir)).toEqual({
      shouldReset: false,
      missingChunks: [],
    });

    fs.rmSync(frontendDir, { recursive: true, force: true });
  });
});
