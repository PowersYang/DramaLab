"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useStudioUiStore, type TagView } from "@/store/studioUiStore";

interface TagsViewProps {
  currentMeta?: { title: string; path: string };
}

export default function TagsView({ currentMeta }: TagsViewProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { visitedViews, addVisitedView, removeVisitedView } = useStudioUiStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentMeta) {
      addVisitedView({
        title: currentMeta.title,
        path: currentMeta.path,
        name: currentMeta.title,
      });
    }
  }, [currentMeta, addVisitedView]);

  const handleClose = (e: React.MouseEvent, view: TagView) => {
    e.preventDefault();
    e.stopPropagation();
    removeVisitedView(view.path);
    if (view.path === pathname) {
      const lastView = visitedViews[visitedViews.length - 1];
      if (lastView) {
        router.push(lastView.path);
      } else {
        router.push("/studio");
      }
    }
  };

  const scroll = (direction: "left" | "right") => {
    if (scrollContainerRef.current) {
      const scrollAmount = 200;
      scrollContainerRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="tags-view-container relative flex items-center border-b border-slate-200 bg-white px-2 py-1 shadow-sm">
      <button
        onClick={() => scroll("left")}
        className="flex h-7 w-6 items-center justify-center text-slate-400 hover:text-slate-600 lg:hidden"
      >
        <ChevronLeft size={14} />
      </button>

      <div
        ref={scrollContainerRef}
        className="no-scrollbar flex flex-1 items-center gap-1 overflow-x-auto scroll-smooth px-1"
      >
        {visitedViews.map((view) => {
          const isActive = pathname === view.path;
          return (
            <Link
              key={view.path}
              href={view.path}
              className={`group relative flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-3 text-xs font-medium transition-all ${
                isActive
                  ? "bg-slate-800 text-white shadow-sm"
                  : "border border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-700"
              }`}
            >
              {isActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_4px_rgba(255,255,255,0.8)]" />
              )}
              <span>{view.title}</span>
              {visitedViews.length > 1 && (
                <button
                  onClick={(e) => handleClose(e, view)}
                  className={`flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors ${
                    isActive
                      ? "hover:bg-white/20 hover:text-white"
                      : "text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                  }`}
                >
                  <X size={10} strokeWidth={3} />
                </button>
              )}
            </Link>
          );
        })}
      </div>

      <button
        onClick={() => scroll("right")}
        className="flex h-7 w-6 items-center justify-center text-slate-400 hover:text-slate-600 lg:hidden"
      >
        <ChevronRight size={14} />
      </button>

      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
