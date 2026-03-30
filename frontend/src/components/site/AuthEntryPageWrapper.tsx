"use client";

import { Suspense } from "react";
import AuthEntryPage from "./AuthEntryPage";

interface AuthEntryPageWrapperProps {
  mode: "signin" | "signup";
}

export default function AuthEntryPageWrapper({ mode }: AuthEntryPageWrapperProps) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AuthEntryPage mode={mode} />
    </Suspense>
  );
}
