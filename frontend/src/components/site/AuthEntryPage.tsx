"use client";

import axios from "axios";
import Image from "next/image";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import AuthCaptchaField from "@/components/site/AuthCaptchaField";
import type { MarketingAuthMode } from "@/components/site/marketingAuthHref";
import { useAuthStore } from "@/store/authStore";

interface AuthEntryPageProps {
  mode: MarketingAuthMode;
  onClose?: () => void;
  onModeChange?: (mode: MarketingAuthMode) => void;
}

type AuthMethod = "password" | "email_code";
type PasswordStage = "signin" | "forgot";
type AuthChannel = "email" | "phone";

const SEND_CODE_COOLDOWN_SECONDS = 60;
const PHONE_IDENTIFIER_PATTERN = /^\+?\d{11,15}$/;
const AUTH_SUCCESS_REDIRECT = "/studio";

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
    return "该账号尚未注册，请先完成注册或确认账号是否填写正确。";
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

const inferAuthChannel = (identifier: string): AuthChannel => {
  return PHONE_IDENTIFIER_PATTERN.test(identifier.trim()) ? "phone" : "email";
};

const isVerificationMethod = (authMethod: AuthMethod, passwordStage: PasswordStage) => {
  return authMethod === "email_code" || passwordStage === "forgot";
};

export default function AuthEntryPage({ mode, onClose }: AuthEntryPageProps) {
  const sendEmailCode = useAuthStore((state) => state.sendEmailCode);
  const getAuthCaptcha = useAuthStore((state) => state.getAuthCaptcha);
  const verifyEmailCode = useAuthStore((state) => state.verifyEmailCode);
  const signInWithPassword = useAuthStore((state) => state.signInWithPassword);
  const signUpWithPassword = useAuthStore((state) => state.signUpWithPassword);
  const resetPasswordWithCode = useAuthStore((state) => state.resetPasswordWithCode);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [captchaId, setCaptchaId] = useState("");
  const [captchaSvg, setCaptchaSvg] = useState<string | null>(null);
  const [captchaCode, setCaptchaCode] = useState("");
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [sendCooldown, setSendCooldown] = useState(0);
  const [step, setStep] = useState<"input" | "verify">("input");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("password");
  const [passwordStage, setPasswordStage] = useState<PasswordStage>("signin");

  const isSignUp = mode === "signup";
  const channel = useMemo(() => inferAuthChannel(identifier), [identifier]);
  const usingVerificationFlow = isVerificationMethod(authMethod, passwordStage);
  const shouldSubmitVerifyCode = authMethod === "email_code";
  const primaryActionText = isSignUp ? "注册" : passwordStage === "forgot" ? "重置密码" : "登录";
  const primaryActionLabel = isSignUp ? "主注册按钮" : "主登录按钮";
  const runPrimaryAction = () => void (shouldSubmitVerifyCode ? handleVerify() : handlePasswordSubmit());

  const refreshCaptcha = useCallback(async () => {
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
  }, [getAuthCaptcha]);

  useEffect(() => {
    void refreshCaptcha();
  }, [refreshCaptcha]);

  useEffect(() => {
    // 中文注释：切换登录/注册后直接回到最简弹窗状态，避免把另一种模式的输入残留带过来。
    setPassword("");
    setNewPassword("");
    setCode("");
    setError(null);
    setDebugCode(null);
    setStep("input");
    setAuthMethod("password");
    setPasswordStage("signin");
  }, [mode]);

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
          channel,
          identifier,
          code,
          newPassword,
          captchaId,
          captchaCode,
        });
      } else if (isSignUp) {
        await signUpWithPassword({
          channel,
          identifier,
          password,
          captchaId,
          captchaCode,
        });
      } else {
        await signInWithPassword({
          channel,
          identifier,
          password,
          captchaId,
          captchaCode,
        });
      }
      window.location.assign(AUTH_SUCCESS_REDIRECT);
    } catch (err) {
      setError(normalizeAuthError(err, isSignUp));
      await refreshCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendCode = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const purpose = passwordStage === "forgot" ? "reset_password" : mode;
      const result = await sendEmailCode(identifier, purpose, channel, { captchaId, captchaCode });
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
      await verifyEmailCode(identifier, code, {
        channel,
        purpose: mode,
      });
      window.location.assign(AUTH_SUCCESS_REDIRECT);
    } catch (err) {
      setError(normalizeAuthError(err, isSignUp));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative mx-auto h-[380px] w-full max-w-[730px] overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,#080b11_0%,#0d1320_100%)] text-[#f8f4ea] shadow-[0_32px_110px_rgba(0,0,0,0.55)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(241,216,171,0.16),transparent_26%),radial-gradient(circle_at_82%_18%,rgba(46,168,255,0.18),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))]" />
      <div className="grid h-full grid-cols-[214px_minmax(0,1fr)]">
        <div className="relative h-full overflow-hidden border-r border-white/8 bg-[radial-gradient(circle_at_42%_18%,rgba(241,216,171,0.22),transparent_24%),radial-gradient(circle_at_76%_20%,rgba(71,132,255,0.18),transparent_26%),linear-gradient(180deg,#070a11_0%,#0c111c_56%,#111927_100%)]">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0)),radial-gradient(circle_at_50%_95%,rgba(241,216,171,0.16),transparent_30%)]" />
          <Image
            src="/images/auth/login-character.png"
            alt="登录弹窗角色立绘"
            fill
            priority
            sizes="214px"
            className="object-contain object-bottom"
          />
        </div>

        <div className="relative flex h-full flex-col bg-[linear-gradient(180deg,rgba(13,18,29,0.9)_0%,rgba(10,15,25,0.96)_100%)] px-5 py-4">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(46,168,255,0.09),transparent_28%),radial-gradient(circle_at_88%_22%,rgba(241,216,171,0.07),transparent_24%)]" />
          <div className="flex items-center justify-between gap-3">
            <div />

            {onClose ? (
              <button
                type="button"
                aria-label="关闭弹窗"
                onClick={onClose}
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] text-[#93a6bf] transition-[color,background-color,border-color] hover:border-[#29405b] hover:bg-[#101a28] hover:text-[#f8f4ea]"
              >
                <X size={18} />
              </button>
            ) : null}
          </div>

          <div className="relative mt-3 flex justify-center">
            <div className="inline-flex items-center rounded-full border border-white/8 bg-[#101723]/95 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <button
                type="button"
                onClick={() => {
                  setAuthMethod("password");
                  setPasswordStage("signin");
                  setStep("input");
                  setError(null);
                }}
                className={`rounded-full px-5 py-2 text-[13px] font-semibold transition-colors ${
                  authMethod === "password"
                    ? "border border-[#64c6ff]/50 bg-[linear-gradient(135deg,#47b6ff_0%,#1d89f0_55%,#1666d7_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_28px_rgba(46,168,255,0.36)]"
                    : "text-[#9eabc0] hover:text-[#f8f4ea]"
                }`}
              >
                密码登录
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMethod("email_code");
                  setPasswordStage("signin");
                  setStep("input");
                  setError(null);
                }}
                className={`rounded-full px-5 py-2 text-[13px] font-semibold transition-colors ${
                  authMethod === "email_code"
                    ? "border border-[#64c6ff]/50 bg-[linear-gradient(135deg,#47b6ff_0%,#1d89f0_55%,#1666d7_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_28px_rgba(46,168,255,0.36)]"
                    : "text-[#9eabc0] hover:text-[#f8f4ea]"
                }`}
              >
                短信登录
              </button>
            </div>
          </div>

          <form
            className="mt-3 flex-1 flex flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              if (submitting) {
                return;
              }
              runPrimaryAction();
            }}
          >
            <div className="flex-1 space-y-2.5">
              <input
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="请输入邮箱 / 手机号"
                className="h-10 w-full rounded-[14px] border border-[#243349] bg-[#0f1724] px-3 text-[13px] text-[#f8f4ea] outline-none transition-[border-color,box-shadow,background-color,color] placeholder:text-[#63758d] focus:border-[#47b6ff] focus:bg-[#111b2a] focus:text-[#fffaf0] focus:shadow-[0_0_0_3px_rgba(71,182,255,0.14)]"
              />

              {authMethod === "password" && passwordStage === "signin" ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入密码"
                    className="h-10 min-w-0 rounded-[14px] border border-[#243349] bg-[#0f1724] px-3 text-[13px] text-[#f8f4ea] outline-none transition-[border-color,box-shadow,background-color,color] placeholder:text-[#63758d] focus:border-[#47b6ff] focus:bg-[#111b2a] focus:text-[#fffaf0] focus:shadow-[0_0_0_3px_rgba(71,182,255,0.14)]"
                  />
                  {!isSignUp ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordStage("forgot");
                        setStep("input");
                        setCode("");
                        setNewPassword("");
                        setError(null);
                      }}
                      className="px-1 text-[12px] font-semibold text-[#f1d8ab] transition-colors hover:text-[#ffe7ba]"
                    >
                      忘记密码?
                    </button>
                  ) : null}
                </div>
              ) : null}

              {usingVerificationFlow ? (
                <>
                  {step === "verify" || passwordStage === "forgot" ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="请输入验证码"
                      className="h-10 w-full rounded-[14px] border border-[#243349] bg-[#0f1724] px-3 text-[13px] tracking-[0.12em] text-[#f8f4ea] outline-none transition-[border-color,box-shadow,background-color,color] placeholder:tracking-normal placeholder:text-[#63758d] focus:border-[#47b6ff] focus:bg-[#111b2a] focus:text-[#fffaf0] focus:shadow-[0_0_0_3px_rgba(71,182,255,0.14)]"
                    />
                  ) : (
                    <div className="grid grid-cols-[minmax(0,1fr)_124px] gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        placeholder="请输入验证码"
                        className="h-10 min-w-0 rounded-[14px] border border-[#243349] bg-[#0f1724] px-3 text-[13px] tracking-[0.12em] text-[#f8f4ea] outline-none transition-[border-color,box-shadow,background-color,color] placeholder:tracking-normal placeholder:text-[#63758d] focus:border-[#47b6ff] focus:bg-[#111b2a] focus:text-[#fffaf0] focus:shadow-[0_0_0_3px_rgba(71,182,255,0.14)]"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSendCode()}
                        disabled={submitting || sendCooldown > 0}
                        className="h-10 rounded-[14px] border border-[#365273] bg-[linear-gradient(180deg,#132235_0%,#0d1826_100%)] text-[13px] font-semibold text-[#d9e3f2] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-[border-color,color,box-shadow,background-color] hover:border-[#5f83ad] hover:bg-[linear-gradient(180deg,#182b40_0%,#102032_100%)] hover:text-[#f1d8ab] hover:shadow-[0_12px_24px_rgba(10,22,38,0.28)] disabled:cursor-not-allowed disabled:border-[#223246] disabled:bg-[linear-gradient(180deg,#111926_0%,#0d1520_100%)] disabled:text-[#5d7188]"
                      >
                        {sendCooldown > 0 ? `${sendCooldown}s 后重试` : passwordStage === "forgot" ? "发送重置码" : "获取验证码"}
                      </button>
                    </div>
                  )}
                </>
              ) : null}

              {passwordStage === "forgot" ? (
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="设置新密码"
                  className="h-10 w-full rounded-[14px] border border-[#243349] bg-[#0f1724] px-3 text-[13px] text-[#f8f4ea] outline-none transition-[border-color,box-shadow,background-color,color] placeholder:text-[#63758d] focus:border-[#47b6ff] focus:bg-[#111b2a] focus:text-[#fffaf0] focus:shadow-[0_0_0_3px_rgba(71,182,255,0.14)]"
                />
              ) : null}

              <AuthCaptchaField
                captchaSvg={captchaSvg}
                captchaCode={captchaCode}
                onChange={setCaptchaCode}
                onRefresh={() => void refreshCaptcha()}
                disabled={submitting}
                loading={captchaLoading}
                variant="compact"
              />

              {error ? (
                <div className="rounded-[12px] border border-[#6a2a32] bg-[rgba(84,22,26,0.42)] px-3 py-2 text-[12px] text-[#ffb8a0]">{error}</div>
              ) : null}

              {debugCode ? (
                <div className="text-[11px] text-[#5f7188]">测试验证码：{debugCode}</div>
              ) : null}
            </div>

            <div className="mt-3">
              <button
                type="submit"
                aria-label={primaryActionLabel}
                disabled={submitting}
                className="h-11 w-full rounded-[14px] border border-[#72ccff]/45 bg-[linear-gradient(135deg,#47b6ff_0%,#1e84f2_45%,#0f58be_100%)] text-[14px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_20px_40px_rgba(18,93,196,0.36)] transition-[transform,box-shadow,filter,border-color] hover:-translate-y-[1px] hover:border-[#9fdcff]/60 hover:brightness-110 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_24px_46px_rgba(31,112,232,0.42)] disabled:cursor-not-allowed disabled:border-[#2a3b50] disabled:bg-[linear-gradient(135deg,#22344a_0%,#1b2b3f_100%)] disabled:text-[#7f94ac] disabled:shadow-none"
              >
                {submitting ? "提交中..." : primaryActionText}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
