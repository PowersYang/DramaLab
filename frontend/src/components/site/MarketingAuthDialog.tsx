"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import AuthEntryPage from "@/components/site/AuthEntryPage";
import { buildMarketingAuthHref, stripMarketingAuthHref, type MarketingAuthMode } from "@/components/site/marketingAuthHref";

export default function MarketingAuthDialog() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const authMode = searchParams.get("auth");
  const resolvedMode = authMode === "signin" || authMode === "signup" ? authMode : null;

  useEffect(() => {
    if (!resolvedMode) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        router.replace(stripMarketingAuthHref(pathname, searchParams.toString()), { scroll: false });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pathname, resolvedMode, router, searchParams]);

  if (!resolvedMode) {
    return null;
  }

  const closeModal = () => {
    router.replace(stripMarketingAuthHref(pathname, searchParams.toString()), { scroll: false });
  };

  const switchMode = (mode: MarketingAuthMode) => {
    router.replace(
      buildMarketingAuthHref(pathname, searchParams.toString(), mode, searchParams.get("next") || undefined),
      { scroll: false },
    );
  };

  return (
    <div className="marketing-auth-backdrop fixed inset-0 z-[100] flex items-center justify-center px-4 py-6 sm:px-6">
      <button
        type="button"
        aria-label="关闭登录注册弹窗"
        className="absolute inset-0 cursor-default"
        onClick={closeModal}
      />
      <div className="relative z-[101] w-full max-w-[1160px]">
        <AuthEntryPage mode={resolvedMode} onClose={closeModal} onModeChange={switchMode} />
      </div>
    </div>
  );
}
