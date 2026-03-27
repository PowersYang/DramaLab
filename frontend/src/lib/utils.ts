import { API_URL } from "./api";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function getAssetUrl(path: string | null | undefined): string {
    if (!path) return "";
    const normalizedPath = path.trim();
    if (!normalizedPath) return "";

    // 兼容 OSS 签名地址、浏览器 blob/data URL，以及后端直接返回的根路径静态资源地址。
    if (
        normalizedPath.startsWith("http://")
        || normalizedPath.startsWith("https://")
        || normalizedPath.startsWith("blob:")
        || normalizedPath.startsWith("data:")
    ) {
        return normalizedPath;
    }

    if (normalizedPath.startsWith("/api-proxy/files/")) {
        return normalizedPath;
    }

    if (normalizedPath.startsWith("/files/")) {
        return `${API_URL}${normalizedPath}`;
    }

    // Remove leading slash if present to avoid double slashes with API_URL/files/
    const cleanPath = normalizedPath.startsWith("/") ? normalizedPath.slice(1) : normalizedPath;
    return `${API_URL}/files/${cleanPath}`;
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
