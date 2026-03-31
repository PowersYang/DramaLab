import { describe, expect, it } from "vitest";

import { applyCharacterVariantSelection, getCharacterPreviewImage, getPreferredCharacterPanel } from "@/lib/characterAssets";
import type { Character } from "@/store/projectStore";

describe("characterAssets", () => {
    it("uses unit-selected variants when legacy variants are empty", () => {
        const character: Character = {
            id: "char_1",
            name: "Hero",
            full_body_image_url: "oss://hero-a",
            full_body_asset: {
                selected_id: "imgv_b",
                variants: [],
            },
            full_body: {
                selected_image_id: "imgv_b",
                image_variants: [
                    { id: "imgv_a", url: "oss://hero-a", created_at: "2026-03-30T10:00:00Z" },
                    { id: "imgv_b", url: "oss://hero-b", created_at: "2026-03-31T10:00:00Z" },
                ],
            },
        };

        expect(getCharacterPreviewImage(character)).toEqual({
            previewPath: "oss://hero-b",
            previewTimestamp: "2026-03-31T10:00:00Z",
        });
    });

    it("patches legacy and unit selected ids together for optimistic updates", () => {
        const character: Character = {
            id: "char_2",
            name: "Hero",
            full_body_image_url: "oss://hero-a",
            image_url: "oss://hero-a",
            full_body_asset: {
                selected_id: "imgv_a",
                variants: [
                    { id: "imgv_a", url: "oss://hero-a", created_at: "2026-03-30T10:00:00Z" },
                    { id: "imgv_b", url: "oss://hero-b", created_at: "2026-03-31T10:00:00Z" },
                ],
            },
            full_body: {
                selected_image_id: "imgv_a",
                image_variants: [
                    { id: "imgv_a", url: "oss://hero-a", created_at: "2026-03-30T10:00:00Z" },
                    { id: "imgv_b", url: "oss://hero-b", created_at: "2026-03-31T10:00:00Z" },
                ],
            },
        };

        const updated = applyCharacterVariantSelection(character, "full_body", "imgv_b");

        expect(updated.full_body_asset?.selected_id).toBe("imgv_b");
        expect(updated.full_body?.selected_image_id).toBe("imgv_b");
        expect(updated.full_body_image_url).toBe("oss://hero-b");
        expect(updated.image_url).toBe("oss://hero-b");
    });

    it("opens the workbench on full body first when the master asset already exists", () => {
        const character: Character = {
            id: "char_3",
            name: "Hero",
            full_body_image_url: "oss://hero-full",
            three_view_image_url: "oss://hero-sheet-4",
            full_body_asset: {
                selected_id: "full_single",
                variants: [
                    { id: "full_single", url: "oss://hero-full", created_at: "2026-03-31T10:00:00Z" },
                ],
            },
            three_views: {
                selected_image_id: "sheet_4",
                image_variants: [
                    { id: "sheet_1", url: "oss://hero-sheet-1", created_at: "2026-03-31T10:00:00Z" },
                    { id: "sheet_2", url: "oss://hero-sheet-2", created_at: "2026-03-31T10:01:00Z" },
                    { id: "sheet_3", url: "oss://hero-sheet-3", created_at: "2026-03-31T10:02:00Z" },
                    { id: "sheet_4", url: "oss://hero-sheet-4", created_at: "2026-03-31T10:03:00Z" },
                ],
            },
        };

        expect(getPreferredCharacterPanel(character)).toBe("full_body");
    });
});
