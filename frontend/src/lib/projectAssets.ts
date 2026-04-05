import type { Character, Project, ProjectCharacterLink } from "@/store/projectStore";

function isResolvedSeriesCharacterLink(link: ProjectCharacterLink): boolean {
    return Boolean(link?.character && link.character.id);
}

function normalizeCharacterName(value?: string | null): string {
    return String(value || "").trim().toLowerCase();
}

export function isSeriesProject(project?: Project | null): boolean {
    return Boolean(project?.series_id);
}

export function getEffectiveProjectCharacters(project?: Project | null): Character[] {
    if (!project) {
        return [];
    }

    // 中文注释：系列项目优先吃到 links 里已解析的系列角色，同时补齐 project.characters 里的剩余角色，
    // 这样“收件箱确认后尚未建 link”的系列角色也能在分集里直接引用。
    if (isSeriesProject(project)) {
        const linkedCharacters = (Array.isArray(project.series_character_links) ? project.series_character_links : [])
            .filter(isResolvedSeriesCharacterLink)
            .map((link) => link.character as Character);
        const merged = [...linkedCharacters];
        const seen = new Set(linkedCharacters.map((item) => item.id));
        const seenNames = new Set(
            linkedCharacters
                .map((item) => normalizeCharacterName(item.name))
                .filter((item) => Boolean(item)),
        );
        for (const character of Array.isArray(project.characters) ? project.characters : []) {
            if (seen.has(character.id)) {
                continue;
            }
            const normalizedName = normalizeCharacterName(character.name);
            // 中文注释：系列分集里，若 project.characters 出现与系列主档同名但不同 ID 的历史角色，
            // 展示层优先保留 series link 角色，避免资产制作页出现“同名双卡”。
            if (normalizedName && seenNames.has(normalizedName)) {
                continue;
            }
            seen.add(character.id);
            if (normalizedName) {
                seenNames.add(normalizedName);
            }
            merged.push(character);
        }
        return merged;
    }

    return Array.isArray(project.characters) ? project.characters : [];
}

export function getEffectiveProjectCharacterCount(project?: Project | null): number {
    return getEffectiveProjectCharacters(project).length;
}

export function getProjectCharacterSourceHint(_project?: Project | null): string | null {
    return null;
}
