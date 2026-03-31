"use client";

import { useEffect } from "react";

import AuthEntryPage from "@/components/site/AuthEntryPage";
import { useMarketingAuthStore } from "@/store/marketingAuthStore";

export default function MarketingAuthDialog() {
  const resolvedMode = useMarketingAuthStore((state) => state.mode);
  const closeModal = useMarketingAuthStore((state) => state.close);
  const switchMode = useMarketingAuthStore((state) => state.open);

  useEffect(() => {
    if (!resolvedMode) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeModal, resolvedMode]);

  if (!resolvedMode) {
    return null;
  }

  return (
    <div className="marketing-auth-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(46,168,255,0.08),transparent_30%),radial-gradient(circle_at_18%_18%,rgba(241,216,171,0.07),transparent_26%),rgba(3,6,12,0.76)] backdrop-blur-[10px] px-4 py-6 sm:px-6">
      <button
        type="button"
        aria-label="关闭登录注册弹窗"
        className="absolute inset-0 cursor-default"
        onClick={closeModal}
      />
      <div className="relative z-[101] w-full max-w-[730px]">
        <AuthEntryPage mode={resolvedMode} onClose={closeModal} onModeChange={switchMode} />
      </div>
    </div>
  );
}
