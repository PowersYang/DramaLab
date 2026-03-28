"use client";

interface CreativeCanvasProps {
    theme?: "light" | "dark";
}

export default function CreativeCanvas({ theme = "light" }: CreativeCanvasProps) {
    // 制作区背景简化为纯色，避免网格线和动态特效干扰操作视线。
    const backgroundColor = theme === "light" ? "#f4f5f7" : "#0f172a";

    return (
        <div
            className="absolute inset-0 z-0 h-full w-full"
            style={{ backgroundColor }}
            aria-hidden="true"
        />
    );
}
