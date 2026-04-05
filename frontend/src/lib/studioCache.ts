"use client";

interface StudioCacheEnvelope<T> {
  updatedAt: number;
  data: T;
}

const STUDIO_CACHE_PREFIX = "dramalab-studio-cache";
const AUTH_SNAPSHOT_STORAGE_KEY = "dramalab-auth-snapshot-v1";
const memoryCache = new Map<string, StudioCacheEnvelope<unknown>>();
const inflightCache = new Map<string, Promise<unknown>>();

export const STUDIO_PROJECT_SUMMARIES_CACHE_KEY = `${STUDIO_CACHE_PREFIX}:project-summaries`;
export const STUDIO_SERIES_SUMMARIES_CACHE_KEY = `${STUDIO_CACHE_PREFIX}:series-summaries`;
export const STUDIO_TASK_LIST_CACHE_KEY = `${STUDIO_CACHE_PREFIX}:task-list`;

function getScopedStudioCacheKey(key: string): string {
  if (typeof window === "undefined") {
    return `${key}:server`;
  }

  try {
    const rawSnapshot = window.sessionStorage.getItem(AUTH_SNAPSHOT_STORAGE_KEY);
    if (!rawSnapshot) {
      return `${key}:anonymous`;
    }
    const parsedSnapshot = JSON.parse(rawSnapshot) as {
      me?: { current_workspace_id?: string | null } | null;
    } | null;
    const workspaceId = parsedSnapshot?.me?.current_workspace_id;
    // 中文注释：工作台摘要必须按当前工作区分桶，否则切换 workspace 后会把上一个工作区的项目继续展示出来。
    return `${key}:${workspaceId || "anonymous"}`;
  } catch (error) {
    console.error("Failed to resolve studio cache scope:", key, error);
    return `${key}:anonymous`;
  }
}

function readSessionCache<T>(key: string): StudioCacheEnvelope<T> | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StudioCacheEnvelope<T> | null;
    if (!parsed || typeof parsed !== "object" || !("updatedAt" in parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error("Failed to read studio cache:", key, error);
    return null;
  }
}

function writeSessionCache<T>(key: string, envelope: StudioCacheEnvelope<T>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(key, JSON.stringify(envelope));
  } catch (error) {
    console.error("Failed to write studio cache:", key, error);
  }
}

export function readStudioCache<T>(key: string): StudioCacheEnvelope<T> | null {
  const scopedKey = getScopedStudioCacheKey(key);
  const memoryEnvelope = memoryCache.get(scopedKey) as StudioCacheEnvelope<T> | undefined;
  if (memoryEnvelope) {
    return memoryEnvelope;
  }

  const sessionEnvelope = readSessionCache<T>(scopedKey);
  if (sessionEnvelope) {
    memoryCache.set(scopedKey, sessionEnvelope);
  }
  return sessionEnvelope;
}

export function writeStudioCache<T>(key: string, data: T): StudioCacheEnvelope<T> {
  const scopedKey = getScopedStudioCacheKey(key);
  const envelope = {
    updatedAt: Date.now(),
    data,
  };
  memoryCache.set(scopedKey, envelope);
  writeSessionCache(scopedKey, envelope);
  return envelope;
}

export function isStudioCacheFresh(key: string, maxAgeMs: number): boolean {
  const envelope = readStudioCache(key);
  return Boolean(envelope && Date.now() - envelope.updatedAt <= maxAgeMs);
}

export async function loadStudioCacheResource<T>(
  key: string,
  loader: () => Promise<T>,
): Promise<StudioCacheEnvelope<T>> {
  const scopedKey = getScopedStudioCacheKey(key);
  const cachedPromise = inflightCache.get(scopedKey) as Promise<StudioCacheEnvelope<T>> | undefined;
  if (cachedPromise) {
    return cachedPromise;
  }

  // 中文注释：工作台多个页面会读取相同摘要数据，这里统一做前端去重，避免切页时同一资源被并发重复请求。
  const nextPromise = loader()
    .then((data) => writeStudioCache(key, data))
    .finally(() => {
      inflightCache.delete(scopedKey);
    });

  inflightCache.set(scopedKey, nextPromise);
  return nextPromise;
}
