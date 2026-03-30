"use client";

import axios from "axios";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import AuthCaptchaField from "@/components/site/AuthCaptchaField";
import MarketingShell from "@/components/site/MarketingShell";
import { useAuthStore } from "@/store/authStore";

interface AuthEntryPageProps {
  mode: "signin" | "signup";
}

const AUTH_COPY = {
  signin: {
    eyebrow: "Sign In",
    title: "使用邮箱或手机号登录到 DramaLab",
    description: "支持邮箱或手机号登录，并且都可以选择验证码或密码方式。超级管理员、团队成员和受邀用户都不需要再次填写显示名称。",
    codeAction: "发送登录验证码",
    verifyAction: "验证并进入工作台",
    loadingAction: "登录中...",
    resendAction: "重新发送验证码",
    switchPrompt: "还没有账号？",
    switchAction: "去注册",
    switchHref: "/signup",
    notice: "登录即表示你同意接收与账号安全、登录提醒和工作区邀请相关的通知邮件。",
  },
  signup: {
    eyebrow: "Sign Up",
    title: "注册你的 DramaLab 账号",
    description: "支持邮箱或手机号注册，且都可以选择验证码或密码方式。首次注册会创建你的个人空间。",
    codeAction: "发送注册验证码",
    verifyAction: "验证并创建账号",
    loadingAction: "注册中...",
    resendAction: "重新发送验证码",
    switchPrompt: "已经有账号？",
    switchAction: "去登录",
    switchHref: "/signin",
    notice: "注册即表示你同意接收与账号、安全验证和工作区邀请相关的通知邮件。",
  },
} as const;

type AuthMethod = "password" | "email_code";
type PasswordStage = "signin" | "forgot";
type AuthChannel = "email" | "phone";
const SEND_CODE_COOLDOWN_SECONDS = 60;

const normalizeAuthError = (error: unknown, isSignUp: boolean) => {
  const detail =
    axios.isAxiosError(error)
      ? typeof error.response?.data?.detail === "string"
        ? error.response?.data?.detail
        : error.message
      : error instanceof Error
        ? error.message
        : String(error || "");
  const message = detail || "";

  if (message.includes("Account already exists")) {
    return "该账号已经注册，请直接前往登录。";
  }
  if (message.includes("reserved for platform administration")) {
    return "该邮箱属于系统管理保留账号，不能通过公开入口注册。";
  }
  if (message.includes("Account not found")) {
    return "该账号尚未注册，请先完成注册或确认邮箱是否填写正确。";
  }
  if (message.includes("Email delivery is not configured")) {
    return "当前环境还没有配置验证码邮件发送，请先补齐 SMTP 配置后再登录。";
  }
  if (message.includes("SMS delivery is not configured")) {
    return "当前环境还没有配置短信验证码发送，请先开启测试验证码回显或接入短信服务。";
  }
  if (message.includes("Email or password is incorrect")) {
    return "邮箱或密码不正确，请重新输入。";
  }
  if (message.includes("Current password is incorrect")) {
    return "当前密码不正确，请重新输入。";
  }
  if (message.includes("Password must be at least 6 characters")) {
    return "密码至少需要 6 位。";
  }
  if (message.includes("Captcha is required")) {
    return "请先完成图形验证码。";
  }
  if (message.includes("Captcha is incorrect")) {
    return "图形验证码不正确，请重新输入。";
  }
  if (message.includes("Captcha is invalid or expired")) {
    return "图形验证码已失效，请刷新后重试。";
  }
  if (message.includes("Too many verification code requests. Please retry in")) {
    return message.replace("Too many verification code requests. Please retry in ", "验证码发送过于频繁，请在 ").replace(" seconds.", " 秒后再试。");
  }
  if (message.includes("Too many verification code requests for this account")) {
    return "该账号发送验证码过于频繁，请一小时后再试。";
  }
  if (message.includes("Too many verification code requests from this network")) {
    return "当前网络发送验证码过于频繁，请一小时后再试。";
  }

  return isSignUp ? "注册失败，请稍后重试。" : "登录失败，请稍后重试。";
};

export default function AuthEntryPage({ mode }: AuthEntryPageProps) {
  const searchParams = useSearchParams();
  const sendEmailCode = useAuthStore((state) => state.sendEmailCode);
  const getAuthCaptcha = useAuthStore((state) => state.getAuthCaptcha);
  const verifyEmailCode = useAuthStore((state) => state.verifyEmailCode);
  const signInWithPassword = useAuthStore((state) => state.signInWithPassword);
  const signUpWithPassword = useAuthStore((state) => state.signUpWithPassword);
  const resetPasswordWithCode = useAuthStore((state) => state.resetPasswordWithCode);

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [captchaId, setCaptchaId] = useState("");
  const [captchaSvg, setCaptchaSvg] = useState<string | null>(null);
  const [captchaCode, setCaptchaCode] = useState("");
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [sendCooldown, setSendCooldown] = useState(0);
  const [step, setStep] = useState<"email" | "verify">("email");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupKind, setSignupKind] = useState<"individual_creator" | "org_admin">("individual_creator");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("password");
  const [passwordStage, setPasswordStage] = useState<PasswordStage>("signin");
  const [authChannel, setAuthChannel] = useState<AuthChannel>("email");

  // 中文注释：登录完成后优先回到原始受保护页面，注册默认进入工作台。
  const nextPath = searchParams.get("next") || "/studio";
  const isSignUp = mode === "signup";
  const copy = AUTH_COPY[mode];
  const isOrgSignup = isSignUp && signupKind === "org_admin";
  const identifierLabel = authChannel === "email" ? "邮箱" : "手机号";
  const identifierPlaceholder = authChannel === "email" ? "you@studio.com" : "例如：13800138000";
  const methodPasswordLabel = authChannel === "email" ? "邮箱密码" : "手机号密码";
  const methodCodeLabel = authChannel === "email" ? "邮箱验证码" : "手机验证码";

  const refreshCaptcha = async () => {
    setCaptchaLoading(true);
    try {
      const payload = await getAuthCaptcha();
      setCaptchaId(payload.captcha_id);
      setCaptchaSvg(payload.image_svg);
      setCaptchaCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "图形验证码加载失败，请刷新页面重试。");
    } finally {
      setCaptchaLoading(false);
    }
  };

  useEffect(() => {
    void refreshCaptcha();
  }, []);

  useEffect(() => {
    if (sendCooldown <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSendCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [sendCooldown]);

  const handlePasswordSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (!isSignUp && passwordStage === "forgot") {
        await resetPasswordWithCode({
          channel: authChannel,
          identifier: email,
          code,
          newPassword,
          captchaId,
          captchaCode,
        });
      } else if (isSignUp) {
        await signUpWithPassword({
          channel: authChannel,
          identifier: email,
          password,
          captchaId,
          captchaCode,
          displayName: displayName || undefined,
          signupKind,
          organizationName: isOrgSignup ? organizationName || undefined : undefined,
        });
      } else {
        await signInWithPassword({ channel: authChannel, identifier: email, password, captchaId, captchaCode });
      }
      window.location.assign(nextPath);
    } catch (err) {
      setError(normalizeAuthError(err, isSignUp));
      await refreshCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendResetCode = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await sendEmailCode(email, "reset_password", authChannel, { captchaId, captchaCode });
      setDebugCode(result.debug_code || null);
      setStep("verify");
      setSendCooldown(SEND_CODE_COOLDOWN_SECONDS);
      await refreshCaptcha();
    } catch (err) {
      setError(normalizeAuthError(err, false));
      await refreshCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendCode = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await sendEmailCode(email, mode, authChannel, { captchaId, captchaCode });
      setDebugCode(result.debug_code || null);
      setStep("verify");
      setSendCooldown(SEND_CODE_COOLDOWN_SECONDS);
      await refreshCaptcha();
    } catch (err) {
      setError(normalizeAuthError(err, isSignUp));
      await refreshCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // 中文注释：只有注册流程才向后端传显示名称，避免老用户登录时误触资料更新。
      await verifyEmailCode(email, code, {
        channel: authChannel,
        purpose: mode,
        displayName: isSignUp ? displayName || undefined : undefined,
        signupKind: isSignUp ? signupKind : undefined,
        organizationName: isOrgSignup ? organizationName || undefined : undefined,
      });
      window.location.assign(nextPath);
    } catch (err) {
      setError(normalizeAuthError(err, isSignUp));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MarketingShell ctaMode="auth">
      <section className="mx-auto flex min-h-[70vh] max-w-7xl items-center px-6 py-16 lg:px-10">
        <div className="grid w-full gap-10 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="studio-panel p-10">
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-sm font-semibold text-slate-500">
              <Link
                href="/signin"
                prefetch
                className={`rounded-full px-4 py-2 transition-colors ${!isSignUp ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950"}`}
              >
                登录
              </Link>
              <Link
                href="/signup"
                prefetch
                className={`rounded-full px-4 py-2 transition-colors ${isSignUp ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950"}`}
              >
                注册
              </Link>
            </div>

            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.24em] text-primary">{copy.eyebrow}</p>
            <h1 className="mt-4 text-4xl font-bold text-slate-950">{copy.title}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">{copy.description}</p>
            <div className="mt-6 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              {isSignUp
                ? "默认推荐使用邮箱 + 密码注册；如果需要无密码体验，仍可切换到邮箱验证码。"
                : "默认推荐使用邮箱 + 密码登录；验证码登录继续保留，方便临时免密进入。"}
            </div>
          </div>

          <div className="studio-panel p-10">
            <div className="space-y-4">
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-sm font-semibold text-slate-500">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMethod("password");
                    setError(null);
                    setDebugCode(null);
                    setStep("email");
                  }}
                  className={`rounded-full px-4 py-2 transition-colors ${authMethod === "password" ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950"}`}
                >
                  {methodPasswordLabel}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMethod("email_code");
                    setError(null);
                    setPasswordStage("signin");
                  }}
                  className={`rounded-full px-4 py-2 transition-colors ${authMethod === "email_code" ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950"}`}
                >
                  {methodCodeLabel}
                </button>
              </div>

              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 text-sm font-semibold text-slate-500">
                <button
                  type="button"
                  onClick={() => setAuthChannel("email")}
                  className={`rounded-full px-4 py-2 transition-colors ${authChannel === "email" ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950"}`}
                >
                  邮箱
                </button>
                <button
                  type="button"
                  onClick={() => setAuthChannel("phone")}
                  className={`rounded-full px-4 py-2 transition-colors ${authChannel === "phone" ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950"}`}
                >
                  手机号
                </button>
              </div>

              {isSignUp ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setSignupKind("individual_creator")}
                    className={`rounded-[1.5rem] border px-4 py-4 text-left transition-colors ${
                      signupKind === "individual_creator"
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <div className="text-sm font-semibold">注册个人创作空间</div>
                    <div className={`mt-2 text-xs leading-6 ${signupKind === "individual_creator" ? "text-slate-200" : "text-slate-500"}`}>
                      适合个人 AI 短剧创作者，注册后自动创建个人组织和默认工作区。
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSignupKind("org_admin")}
                    className={`rounded-[1.5rem] border px-4 py-4 text-left transition-colors ${
                      signupKind === "org_admin"
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <div className="text-sm font-semibold">创建团队空间</div>
                    <div className={`mt-2 text-xs leading-6 ${signupKind === "org_admin" ? "text-slate-200" : "text-slate-500"}`}>
                      适合公司负责人或管理员，注册后自动成为团队管理员，可邀请制作成员加入。
                    </div>
                  </button>
                </div>
              ) : null}

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">{identifierLabel}</span>
                <input
                  type={authChannel === "email" ? "email" : "tel"}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={identifierPlaceholder}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary/50"
                />
              </label>

              <AuthCaptchaField
                captchaSvg={captchaSvg}
                captchaCode={captchaCode}
                onChange={setCaptchaCode}
                onRefresh={() => void refreshCaptcha()}
                disabled={submitting}
                loading={captchaLoading}
              />

              {authMethod === "password" ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">密码</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={isSignUp ? "至少 6 位，建议包含字母和数字" : "输入你的登录密码"}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary/50"
                  />
                </label>
              ) : null}

              {authMethod === "password" && !isSignUp && passwordStage === "forgot" ? (
                <>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-800">验证码</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="输入 6 位验证码"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm tracking-[0.28em] text-slate-900 outline-none transition-colors focus:border-primary/50"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-800">新密码</span>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="至少 6 位，重置后立即生效"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary/50"
                    />
                  </label>
                </>
              ) : null}

              {isSignUp ? (
                <>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-800">显示名称</span>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder={isOrgSignup ? "例如：王制片，团队内会显示这个名称" : "例如：Will，首次注册时会用于创建个人空间"}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary/50"
                    />
                  </label>

                  {isOrgSignup ? (
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-slate-800">团队 / 公司名称</span>
                      <input
                        type="text"
                        value={organizationName}
                        onChange={(event) => setOrganizationName(event.target.value)}
                        placeholder="例如：银河短剧工作室"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary/50"
                      />
                    </label>
                  ) : null}
                </>
              ) : null}

              {authMethod === "email_code" && step === "verify" ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">验证码</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="输入 6 位验证码"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm tracking-[0.28em] text-slate-900 outline-none transition-colors focus:border-primary/50"
                  />
                </label>
              ) : null}

              {debugCode ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  当前环境开启了调试验证码回显：<span className="font-semibold">{debugCode}</span>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-2">
                {authMethod === "password" ? (
                  <>
                    <button
                      disabled={
                        !email.trim() ||
                        (
                          !isSignUp &&
                          passwordStage === "forgot"
                            ? !code.trim() || !newPassword.trim()
                            : !password.trim()
                        ) ||
                        !captchaId.trim() ||
                        !captchaCode.trim() ||
                        (isSignUp && (!displayName.trim() || (isOrgSignup && !organizationName.trim()))) ||
                        submitting
                      }
                      onClick={() => void handlePasswordSubmit()}
                      className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {submitting ? copy.loadingAction : isSignUp ? "创建账号并进入工作台" : passwordStage === "forgot" ? "重置密码并登录" : "登录并进入工作台"}
                    </button>
                    {!isSignUp ? (
                      <>
                        <button
                          type="button"
                          disabled={!email.trim() || sendCooldown > 0 || submitting}
                          onClick={() => void handleSendResetCode()}
                          className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
                        >
                          {sendCooldown > 0 ? `${sendCooldown}s 后重发重置码` : "发送重置验证码"}
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => {
                            setPasswordStage(passwordStage === "forgot" ? "signin" : "forgot");
                            setError(null);
                            setDebugCode(null);
                            setCode("");
                            setNewPassword("");
                          }}
                          className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700"
                        >
                          {passwordStage === "forgot" ? "返回密码登录" : "忘记密码"}
                        </button>
                      </>
                    ) : null}
                  </>
                ) : step === "email" ? (
                  <button
                    disabled={!email.trim() || !captchaId.trim() || !captchaCode.trim() || sendCooldown > 0 || (isSignUp && (!displayName.trim() || (isOrgSignup && !organizationName.trim()))) || submitting}
                    onClick={() => void handleSendCode()}
                    className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {submitting ? "发送中..." : sendCooldown > 0 ? `${sendCooldown}s 后可重发` : copy.codeAction}
                  </button>
                ) : (
                  <>
                    <button
                      disabled={!email.trim() || !code.trim() || !captchaId.trim() || !captchaCode.trim() || (isSignUp && (!displayName.trim() || (isOrgSignup && !organizationName.trim()))) || submitting}
                      onClick={() => void handleVerify()}
                      className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {submitting ? copy.loadingAction : copy.verifyAction}
                    </button>
                    <button
                      disabled={sendCooldown > 0 || submitting}
                      onClick={() => void handleSendCode()}
                      className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700"
                    >
                      {sendCooldown > 0 ? `${sendCooldown}s 后可重发` : copy.resendAction}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="mt-8 text-sm text-slate-500">{copy.notice}</div>
            {authMethod === "password" && !isSignUp && passwordStage === "forgot" ? (
              <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                忘记密码时，先发送验证码，再输入验证码和新密码完成重置。已有老账号如果从未设置过密码，可先尝试默认初始密码 `123456`。
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-slate-500">{copy.switchPrompt}</span>
              <Link href={copy.switchHref} className="font-semibold text-primary">
                {copy.switchAction}
              </Link>
              <Link href="/" className="font-semibold text-slate-600">
                返回官网
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
