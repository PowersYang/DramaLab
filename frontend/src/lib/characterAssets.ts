import type { AssetUnit, Character, ImageAsset, ImageVariant } from "@/store/projectStore";

type CharacterPanelKey = "full_body" | "three_view" | "headshot";

const PANEL_CONFIG = {
    full_body: {
        legacyKey: "full_body_asset",
        unitKey: "full_body",
        urlKey: "full_body_image_url",
        syncedUrlKeys: ["image_url"],
        updatedAtKey: "full_body_updated_at",
    },
    three_view: {
        legacyKey: "three_view_asset",
        unitKey: "three_views",
        urlKey: "three_view_image_url",
        syncedUrlKeys: [],
        updatedAtKey: "three_view_updated_at",
    },
    headshot: {
        legacyKey: "headshot_asset",
        unitKey: "head_shot",
        urlKey: "headshot_image_url",
        syncedUrlKeys: ["avatar_url"],
        updatedAtKey: "headshot_updated_at",
    },
} as const;

const PANEL_ORDER: CharacterPanelKey[] = ["full_body", "three_view", "headshot"];

const parseVariantTimestamp = (value: string | number | undefined | null) => {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
};

const sortVariantsByCreatedAt = (variants: ImageVariant[]) => {
    return [...variants].sort((left, right) => {
        return parseVariantTimestamp(right.created_at) - parseVariantTimestamp(left.created_at);
    });
};

// 角色图片在 legacy/unit 两套容器里都会出现；这里统一去重合并，避免预览和选中逻辑读出两份状态。
export const mergeCharacterPanelVariants = (
    legacyAsset?: ImageAsset | null,
    unitAsset?: AssetUnit | null,
): ImageVariant[] => {
    const merged = new Map<string, ImageVariant>();

    [...(legacyAsset?.variants || []), ...(unitAsset?.image_variants || [])].forEach((variant) => {
        if (!variant?.id || merged.has(variant.id)) {
            return;
        }
        merged.set(variant.id, variant);
    });

    return sortVariantsByCreatedAt(Array.from(merged.values()));
};

export const getCharacterPanelSelectedVariant = (
    legacyAsset?: ImageAsset | null,
    unitAsset?: AssetUnit | null,
): ImageVariant | null => {
    const mergedVariants = mergeCharacterPanelVariants(legacyAsset, unitAsset);
    if (!mergedVariants.length) {
        return null;
    }

    const selectedId = legacyAsset?.selected_id || unitAsset?.selected_image_id || null;
    if (!selectedId) {
        return mergedVariants[0];
    }

    return mergedVariants.find((variant) => variant.id === selectedId) || mergedVariants[0];
};

export const getCharacterPanelVariants = (character: Character, panelKey: CharacterPanelKey): ImageVariant[] => {
    const config = PANEL_CONFIG[panelKey];
    return mergeCharacterPanelVariants(
        character[config.legacyKey] as ImageAsset | null | undefined,
        character[config.unitKey] as AssetUnit | null | undefined,
    );
};

// 角色工作台始终优先从主素材进入，只有主素材完全缺失时才回退到其它分面。
export const getPreferredCharacterPanel = (character: Character): CharacterPanelKey => {
    const rankedPanels = PANEL_ORDER.map((panelKey, index) => {
        const config = PANEL_CONFIG[panelKey];
        const variants = getCharacterPanelVariants(character, panelKey);
        const selectedVariant = getCharacterPanelSelectedVariant(
            character[config.legacyKey] as ImageAsset | null | undefined,
            character[config.unitKey] as AssetUnit | null | undefined,
        );
        const previewUrl = character[config.urlKey] as string | undefined;
        const latestVariantTime = variants.reduce((latest, variant) => {
            return Math.max(latest, parseVariantTimestamp(variant.created_at));
        }, 0);
        const updatedAtTime = parseVariantTimestamp(character[config.updatedAtKey] as string | number | undefined);
        const selectedTime = parseVariantTimestamp(selectedVariant?.created_at);
        const variantCount = variants.length || (previewUrl ? 1 : 0);

        return {
            panelKey,
            index,
            variantCount,
            freshestTime: Math.max(latestVariantTime, updatedAtTime, selectedTime),
            hasPreview: previewUrl || selectedVariant?.url ? 1 : 0,
        };
    }).sort((left, right) => {
        if (left.panelKey === "full_body" && right.panelKey !== "full_body" && left.hasPreview) {
            return -1;
        }
        if (right.panelKey === "full_body" && left.panelKey !== "full_body" && right.hasPreview) {
            return 1;
        }
        if (left.freshestTime !== right.freshestTime) {
            return right.freshestTime - left.freshestTime;
        }
        if (left.variantCount !== right.variantCount) {
            return right.variantCount - left.variantCount;
        }
        if (left.hasPreview !== right.hasPreview) {
            return right.hasPreview - left.hasPreview;
        }
        return left.index - right.index;
    });

    return rankedPanels[0]?.panelKey || "full_body";
};

export const getCharacterPreviewImage = (character: Character) => {
    const selectedFullBody = getCharacterPanelSelectedVariant(character.full_body_asset, character.full_body);
    const selectedHeadshot = getCharacterPanelSelectedVariant(character.headshot_asset, character.head_shot);
    const selectedThreeView = getCharacterPanelSelectedVariant(character.three_view_asset, character.three_views);

    return {
        previewPath:
            selectedFullBody?.url
            || character.full_body_image_url
            || selectedHeadshot?.url
            || character.headshot_image_url
            || character.avatar_url
            || selectedThreeView?.url
            || character.three_view_image_url
            || character.image_url,
        previewTimestamp:
            selectedFullBody?.created_at
            || character.full_body_updated_at
            || selectedHeadshot?.created_at
            || character.headshot_updated_at
            || selectedThreeView?.created_at
            || character.three_view_updated_at,
    };
};

// 候选图点击后先把 store 内角色对象同步成最新选中项，保证弹窗和卡片预览立即一致。
export const applyCharacterVariantSelection = (
    character: Character,
    panelKey: CharacterPanelKey,
    variantId: string,
): Character => {
    const config = PANEL_CONFIG[panelKey];
    const legacyAsset = (character[config.legacyKey] as ImageAsset | undefined) || { selected_id: null, variants: [] };
    const unitAsset = (character[config.unitKey] as AssetUnit | undefined) || { selected_image_id: null, image_variants: [] };
    const mergedVariants = mergeCharacterPanelVariants(legacyAsset, unitAsset);
    const selectedVariant = mergedVariants.find((variant) => variant.id === variantId);

    if (!selectedVariant) {
        return character;
    }

    const nextCharacter: Character = {
        ...character,
        [config.legacyKey]: {
            ...legacyAsset,
            selected_id: variantId,
            variants: legacyAsset.variants?.length ? legacyAsset.variants : mergedVariants,
        },
        [config.unitKey]: {
            ...unitAsset,
            selected_image_id: variantId,
            image_variants: unitAsset.image_variants?.length ? unitAsset.image_variants : mergedVariants,
        },
        [config.urlKey]: selectedVariant.url,
    };

    config.syncedUrlKeys.forEach((key) => {
        (nextCharacter as any)[key] = selectedVariant.url;
    });

    return nextCharacter;
};
