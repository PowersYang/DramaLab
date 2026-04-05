import type { Character, Project, ProjectCharacterLink } from "@/store/projectStore";

function isResolvedSeriesCharacterLink(link: ProjectCharacterLink): boolean {
    return Boolean(link?.character && link.character.id);
}

export function isSeriesProject(project?: Project | null): boolean {
    return Boolean(project?.series_id);
}

export function getEffectiveProjectCharacters(project?: Project | null): Character[] {
    if (!project) {
        return [];
    }

    // 中文注释：系列项目以 series_character_links 里的系列主档角色为准，单项目继续沿用原 characters。
    if (isSeriesProject(project) && Array.isArray(project.series_character_links) && project.series_character_links.length > 0) {
        return project.series_character_links
            .filter(isResolvedSeriesCharacterLink)
            .map((link) => link.character as Character);
    }

    return Array.isArray(project.characters) ? project.characters : [];
}

export function getEffectiveProjectCharacterCount(project?: Project | null): number {
    return getEffectiveProjectCharacters(project).length;
}

export function getProjectCharacterSourceHint(project?: Project | null): string | null {
    if (!isSeriesProject(project)) {
        return null;
    }

    return "当前分集展示的是系列角色主档，新增、删除和配音设置会同步到系列角色库。";
}
