import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function getAssetUrl(path: string | null | undefined): string {
    if (!path) return "";
    const normalizedPath = path.trim();
    if (!normalizedPath) return "";

    // 资源已经统一切到 OSS/CDN 绝对地址；这里只保留浏览器可直接消费的 URL 原样透传。
    if (
        normalizedPath.startsWith("http://")
        || normalizedPath.startsWith("https://")
        || normalizedPath.startsWith("blob:")
        || normalizedPath.startsWith("data:")
    ) {
        return normalizedPath;
    }

    // 如果这里仍收到相对路径，说明后端没有正确返回稳定 OSS 地址；
    // 直接原样返回，便于尽早暴露问题，而不是悄悄拼接已下线的本地静态资源路由。
    return normalizedPath;
}

export function normalizeComparableAssetPath(path: string | null | undefined): string {
    if (!path) return "";

    const normalizedPath = path.trim();
    if (!normalizedPath) return "";

    const withoutHash = normalizedPath.split("#")[0] || "";
    const withoutQuery = withoutHash.split("?")[0] || "";
    if (!withoutQuery) return "";

    if (
        withoutQuery.startsWith("blob:")
        || withoutQuery.startsWith("data:")
    ) {
        return withoutQuery;
    }

    if (withoutQuery.startsWith("http://") || withoutQuery.startsWith("https://")) {
        try {
            const parsed = new URL(withoutQuery);
            return decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
        } catch {
            return withoutQuery;
        }
    }

    return withoutQuery.replace(/^\/+/, "");
}

export function getAssetUrlWithTimestamp(path: string | null | undefined, timestamp?: number): string {
    const baseUrl = getAssetUrl(path);
    if (!baseUrl) return "";

    // If URL already has query params, append with & otherwise with ?
    const separator = baseUrl.includes('?') ? '&' : '?';
    return baseUrl + separator + `t=${timestamp || 0}`;
}

export function extractErrorDetail(error: any, fallback = "未知错误"): string {
    return error?.response?.data?.detail
        || error?.response?.data?.message
        || error?.message
        || fallback;
}
