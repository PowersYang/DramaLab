"use client";

import { useEffect, useRef, useState } from "react";

export interface MarketingVideoClip {
  src: string;
  poster: string;
  objectPosition?: string;
}

interface MarketingVideoStageProps {
  clips: MarketingVideoClip[];
}

export default function MarketingVideoStage({ clips }: MarketingVideoStageProps) {
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    // 中文注释：固定背景需要只播放当前片段，避免多个视频同时解码造成性能抖动。
    videoRefs.current.forEach((video, index) => {
      if (!video) {
        return;
      }

      if (index === activeIndex) {
        video.currentTime = 0;
        void video.play().catch(() => {
          // 中文注释：浏览器自动播放策略可能会短暂拒绝，这里静默处理，等待用户交互后恢复。
        });
        return;
      }

      video.pause();
      video.currentTime = 0;
    });
  }, [activeIndex]);

  if (clips.length === 0) {
    return null;
  }

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#05070b]">
      {clips.map((clip, index) => (
        <video
          key={clip.src}
          ref={(node) => {
            videoRefs.current[index] = node;
          }}
          className={`absolute inset-0 h-full w-full object-cover transition-all duration-[1600ms] ease-out ${
            index === activeIndex ? "scale-100 opacity-100" : "scale-110 opacity-0"
          }`}
          style={{ objectPosition: clip.objectPosition ?? "center" }}
          autoPlay={index === 0}
          muted
          playsInline
          preload="auto"
          poster={clip.poster}
          onEnded={() => {
            setActiveIndex((current) => (current + 1) % clips.length);
          }}
        >
          <source src={clip.src} type="video/mp4" />
        </video>
      ))}

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(238,205,148,0.18),transparent_26%),radial-gradient(circle_at_82%_22%,rgba(84,117,255,0.22),transparent_28%),linear-gradient(180deg,rgba(5,7,11,0.24)_0%,rgba(5,7,11,0.58)_34%,rgba(5,7,11,0.86)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,11,0.82)_0%,rgba(5,7,11,0.42)_42%,rgba(5,7,11,0.78)_100%)]" />
      <div className="marketing-grid absolute inset-0 opacity-[0.16]" />
      <div className="marketing-noise absolute inset-0 opacity-40" />
    </div>
  );
}
