import fs from "fs";
import path from "path";
import { inspectNextDevCache } from "./nextDevCacheHealth.mjs";

const frontendDir = path.resolve(process.cwd());
const nextDir = path.join(frontendDir, ".next");
const { shouldReset, missingChunks } = inspectNextDevCache(frontendDir);

if (!shouldReset) {
  console.log("[ensure-next-dev-cache] .next cache looks healthy.");
  process.exit(0);
}

// 仅在检测到引用缺失 chunk 时清缓存，避免每次开发启动都全量失效。
fs.rmSync(nextDir, { recursive: true, force: true });
console.log(
  `[ensure-next-dev-cache] Reset corrupted .next cache because these vendor chunks are missing: ${missingChunks.join(
    ", ",
  )}`,
);
