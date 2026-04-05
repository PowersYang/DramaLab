import fs from "fs";
import path from "path";

const VENDOR_CHUNK_PATTERN = /"vendor-chunks\/[^"]+"/g;

/**
 * 从编译产物里提取所有被引用的 vendor chunk 标识，便于和磁盘文件做一致性比对。
 */
export function collectReferencedVendorChunks(compiledPageSource) {
  return Array.from(
    new Set((compiledPageSource.match(VENDOR_CHUNK_PATTERN) || []).map((match) => match.slice(1, -1))),
  );
}

/**
 * 计算当前编译页里引用了、但实际 vendor-chunks 目录中不存在的 chunk。
 */
export function findMissingVendorChunks(compiledPages, existingChunkIds) {
  const referencedChunkIds = Array.from(
    new Set(compiledPages.flatMap((compiledPage) => collectReferencedVendorChunks(compiledPage))),
  );
  const existingChunkIdSet = new Set(existingChunkIds);

  return referencedChunkIds.filter((chunkId) => !existingChunkIdSet.has(chunkId)).sort();
}

/**
 * 读取 `.next/server/app` 下的编译页内容，专门覆盖 App Router 的服务端产物。
 */
export function readCompiledAppPages(frontendDir) {
  const appServerDir = path.join(frontendDir, ".next", "server", "app");
  if (!fs.existsSync(appServerDir)) {
    return [];
  }

  const collectedSources = [];

  /**
   * 递归扫描编译页，避免某个子路由的坏缓存漏检。
   */
  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".js")) {
        collectedSources.push(fs.readFileSync(entryPath, "utf8"));
      }
    }
  }

  walk(appServerDir);
  return collectedSources;
}

/**
 * 读取 `.next/server/vendor-chunks` 目录里的现有 chunk 标识。
 */
export function readExistingVendorChunkIds(frontendDir) {
  const vendorChunkDir = path.join(frontendDir, ".next", "server", "vendor-chunks");
  if (!fs.existsSync(vendorChunkDir)) {
    return [];
  }

  return fs
    .readdirSync(vendorChunkDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => `vendor-chunks/${entry.name.replace(/\.js$/, "")}`);
}

/**
 * 判断当前目录是否存在 Next dev 专用的 vendor chunk 目录。
 */
export function hasVendorChunkDirectory(frontendDir) {
  return fs.existsSync(path.join(frontendDir, ".next", "server", "vendor-chunks"));
}

/**
 * 判断当前 `.next` 是否已经进入“引用了不存在 chunk”的损坏状态。
 */
export function inspectNextDevCache(frontendDir) {
  const compiledPages = readCompiledAppPages(frontendDir);
  if (compiledPages.length === 0 || !hasVendorChunkDirectory(frontendDir)) {
    return { shouldReset: false, missingChunks: [] };
  }

  const missingChunks = findMissingVendorChunks(compiledPages, readExistingVendorChunkIds(frontendDir));
  return {
    shouldReset: missingChunks.length > 0,
    missingChunks,
  };
}
