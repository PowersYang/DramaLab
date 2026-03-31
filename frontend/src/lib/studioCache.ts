"use client";

interface StudioCacheEnvelope<T> {
  updatedAt: number;
  data: T;
}

const STUDIO_CACHE_PREFIX = "dramalab-studio-cache";
const memoryCache = new Map<string, StudioCacheEnvelope<unknown>>();
const inflightCache = new Map<string, Promise<unknown>>();

export const STUDIO_PROJECT_SUMMARIES_CACHE_KEY = `${STUDIO_CACHE_PREFIX}:project-summaries`;
export const STUDIO_SERIES_SUMMARIES_CACHE_KEY = `${STUDIO_CACHE_PREFIX}:series-summaries`;
export const STUDIO_TASK_LIST_CACHE_KEY = `${STUDIO_CACHE_PREFIX}:task-list`;

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
  const memoryEnvelope = memoryCache.get(key) as StudioCacheEnvelope<T> | undefined;
  if (memoryEnvelope) {
    return memoryEnvelope;
  }

  const sessionEnvelope = readSessionCache<T>(key);
  if (sessionEnvelope) {
    memoryCache.set(key, sessionEnvelope);
  }
  return sessionEnvelope;
}

export function writeStudioCache<T>(key: string, data: T): StudioCacheEnvelope<T> {
  const envelope = {
    updatedAt: Date.now(),
    data,
  };
  memoryCache.set(key, envelope);
  writeSessionCache(key, envelope);
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
  const cachedPromise = inflightCache.get(key) as Promise<StudioCacheEnvelope<T>> | undefined;
  if (cachedPromise) {
    return cachedPromise;
  }

  // 中文注释：工作台多个页面会读取相同摘要数据，这里统一做前端去重，避免切页时同一资源被并发重复请求。
  const nextPromise = loader()
    .then((data) => writeStudioCache(key, data))
    .finally(() => {
      inflightCache.delete(key);
    });

  inflightCache.set(key, nextPromise);
  return nextPromise;
}

