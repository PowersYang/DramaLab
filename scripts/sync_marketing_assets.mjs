import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const resourceRoot = path.join(repoRoot, "resources", "site", "marketing");
const publicRoot = path.join(repoRoot, "frontend", "public");

const assetPairs = [
  {
    source: path.join(resourceRoot, "videos"),
    target: path.join(publicRoot, "videos", "marketing"),
  },
  {
    source: path.join(resourceRoot, "images"),
    target: path.join(publicRoot, "images", "marketing"),
  },
];

const ensureDirectory = (directory) => {
  mkdirSync(directory, { recursive: true });
};

const hasFiles = (directory) => {
  if (!existsSync(directory)) {
    return false;
  }

  return readdirSync(directory).some((entry) => statSync(path.join(directory, entry)).isFile());
};

for (const { source, target } of assetPairs) {
  if (!hasFiles(source)) {
    console.error(`[sync-marketing-assets] Missing source assets in ${source}`);
    process.exit(1);
  }

  // 中文注释：public 下这两个目录只做发布镜像，每次同步前清空，避免旧资源残留造成环境漂移。
  rmSync(target, { recursive: true, force: true });
  ensureDirectory(target);
  for (const entry of readdirSync(source)) {
    cpSync(path.join(source, entry), path.join(target, entry), { recursive: true, force: true });
  }
  console.log(`[sync-marketing-assets] Synced ${source} -> ${target}`);
}
