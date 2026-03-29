export const PROJECT_REFRESH_PATH_STORAGE_KEY = "dramalab-project-refresh-path";

export function isPageReloadNavigation(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const navigationEntry = window.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigationEntry?.type) {
        return navigationEntry.type === "reload";
    }

    const legacyNavigation = window.performance.navigation;
    return legacyNavigation?.type === legacyNavigation.TYPE_RELOAD;
}
