"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Coins,
  CreditCard,
  Loader2,
  QrCode,
  Receipt,
  ScanLine,
  Sparkles,
  Wallet,
} from "lucide-react";

import AdminSummaryStrip from "@/components/studio/admin/AdminSummaryStrip";
import {
  api,
  type BillingAccountSummary,
  type PaymentEventSummary,
  type BillingTransactionSummary,
  type PaymentOrderSummary,
} from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

const DISPLAY_FONT_CLASS = "font-serif tracking-[-0.04em]";
const BODY_FONT_CLASS =
  "antialiased [font-family:'PingFang_SC','Hiragino_Sans_GB','Noto_Sans_SC','Microsoft_YaHei',system-ui,sans-serif]";

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  recharge: "充值入账",
  bonus: "充值赠送",
  task_debit: "任务扣费",
  manual_adjust: "人工调整",
  refund: "退款返还",
  reversal: "冲正",
};

const TASK_TYPE_LABELS: Record<string, string> = {
  "audio.generate.project": "项目音频生成",
  "audio.generate.line": "单句音频生成",
  "art_direction.analyze": "艺术风格分析",
  "asset.generate": "资产生成",
  "asset.generate_batch": "资产批量生成",
  "asset.motion_ref.generate": "动作参考生成",
  "media.merge": "媒体合成",
  "mix.generate.bgm": "背景音乐生成",
  "mix.generate.sfx": "音效生成",
  "project.export": "项目导出",
  "project.reparse": "剧本重新解析",
  "project.sync_descriptions": "同步资产描述",
  "series.asset.generate": "系列资产生成",
  "series.assets.import": "系列资产导入",
  "series.import.confirm": "导入确认",
  "series.import.preview": "导入预览",
  "storyboard.analyze": "分镜分析",
  "storyboard.generate_all": "生成全部分镜",
  "storyboard.refine_prompt": "分镜提示词优化",
  "storyboard.render": "分镜渲染",
  "video.generate.project": "项目视频生成",
  "video.generate.frame": "分镜视频生成",
  "video.generate.asset": "资产视频生成",
  "video.polish_prompt": "视频提示词润色",
  "video.polish_r2v_prompt": "R2V 提示词润色",
  t2i: "文生图",
  i2i: "图生图",
  i2v: "图生视频",
  r2v: "视频重绘",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "待支付",
  paid: "已支付",
  cancelled: "已取消",
  expired: "已过期",
  failed: "支付失败",
};

const PAYMENT_PROVIDER_MODE_LABELS: Record<string, string> = {
  mock: "开发态 Mock",
  gateway: "正式网关",
};

const PAYMENT_EVENT_LABELS: Record<string, string> = {
  "payment_order.created": "订单已创建",
  "payment_order.paid": "支付成功并入账",
  "payment_order.cancelled": "订单已取消",
  "payment_order.expired": "二维码已过期",
};

const PAGE_SIZE = 10;
const RECHARGE_PRESETS = [6800, 12800, 32800, 64800];

const CHANNEL_META = {
  wechat: {
    label: "微信支付",
    short: "WeChat",
    accent: "from-emerald-500 via-emerald-600 to-teal-700",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    ring: "ring-emerald-500/20",
  },
  alipay: {
    label: "支付宝",
    short: "Alipay",
    accent: "from-sky-500 via-blue-600 to-indigo-700",
    tone: "border-sky-200 bg-sky-50 text-sky-700",
    ring: "ring-sky-500/20",
  },
} as const;

function formatTransactionAmount(item: BillingTransactionSummary): string {
  if (item.amount_credits === 0) {
    return "0 豆";
  }
  return `${item.direction === "credit" ? "+" : "-"}${item.amount_credits} 豆`;
}

export default function StudioBillingRoutePage() {
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const me = useAuthStore((state) => state.me);
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);
  const [credits, setCredits] = useState<BillingTransactionSummary[]>([]);
  const [debits, setDebits] = useState<BillingTransactionSummary[]>([]);
  const [paymentOrders, setPaymentOrders] = useState<PaymentOrderSummary[]>([]);
  const [orderEvents, setOrderEvents] = useState<PaymentEventSummary[]>([]);
  const [creditOffset, setCreditOffset] = useState(0);
  const [debitOffset, setDebitOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creditLoading, setCreditLoading] = useState(false);
  const [debitLoading, setDebitLoading] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [creatingPayment, setCreatingPayment] = useState(false);
  const [simulatingPayment, setSimulatingPayment] = useState(false);
  const [cancellingPayment, setCancellingPayment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAmountCents, setSelectedAmountCents] = useState<number>(RECHARGE_PRESETS[1]);
  const [selectedChannel, setSelectedChannel] = useState<"wechat" | "alipay">("wechat");
  const [activeOrder, setActiveOrder] = useState<PaymentOrderSummary | null>(null);
  const canViewAllBillingData = me?.is_platform_super_admin || me?.current_role_code === "org_admin";

  const loadAccount = async () => {
    try {
      const accountData = await api.getBillingAccount();
      setAccount(accountData);
    } catch (loadError) {
      console.error("加载账户信息失败", loadError);
    }
  };

  const loadCredits = async () => {
    setCreditLoading(true);
    try {
      const data = await api.listBillingTransactions({
        limit: PAGE_SIZE,
        direction: "credit",
        offset: creditOffset,
      });
      setCredits(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载入账记录失败");
    } finally {
      setCreditLoading(false);
    }
  };

  const loadDebits = async () => {
    setDebitLoading(true);
    try {
      const data = await api.listBillingTransactions({
        limit: PAGE_SIZE,
        direction: "debit",
        offset: debitOffset,
      });
      setDebits(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载扣费记录失败");
    } finally {
      setDebitLoading(false);
    }
  };

  const loadPaymentOrders = async () => {
    setPaymentLoading(true);
    try {
      const data = await api.listPaymentOrders({ limit: 8 });
      setPaymentOrders(data);
      setActiveOrder((current) => current ? data.find((item) => item.id === current.id) || current : data[0] || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载支付订单失败");
    } finally {
      setPaymentLoading(false);
    }
  };

  const loadActiveOrderEvents = async (orderId: string) => {
    try {
      const data = await api.listPaymentOrderEvents(orderId);
      setOrderEvents(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载支付时间线失败");
    }
  };

  useEffect(() => {
    if (!hasCapability("workspace.view")) return;
    setLoading(true);
    Promise.all([loadAccount(), loadCredits(), loadDebits(), loadPaymentOrders()]).finally(() => setLoading(false));
  }, [hasCapability]);

  useEffect(() => {
    if (loading) return;
    void loadCredits();
  }, [creditOffset]);

  useEffect(() => {
    if (loading) return;
    void loadDebits();
  }, [debitOffset]);

  useEffect(() => {
    if (!activeOrder || activeOrder.status !== "pending") {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const refreshed = await api.getPaymentOrder(activeOrder.id);
        setActiveOrder(refreshed);
        setPaymentOrders((current) => current.map((item) => item.id === refreshed.id ? refreshed : item));
        await loadActiveOrderEvents(refreshed.id);
        if (refreshed.status === "paid") {
          await Promise.all([loadAccount(), loadCredits(), loadPaymentOrders()]);
        }
      } catch {
        // 中文注释：扫码轮询失败时保持当前支付面板不闪断，避免短暂网络波动打断用户操作。
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeOrder]);

  useEffect(() => {
    if (!activeOrder) {
      setOrderEvents([]);
      return;
    }
    void loadActiveOrderEvents(activeOrder.id);
  }, [activeOrder?.id]);

  const currentOrganizationName = useMemo(() => {
    const currentWorkspace = me?.workspaces.find((item) => item.workspace_id === me.current_workspace_id);
    return currentWorkspace?.organization_name || account?.organization_id || "未绑定组织";
  }, [account?.organization_id, me]);

  const estimatedCredits = useMemo(() => {
    const base = Math.floor((selectedAmountCents / 100) * 10);
    return {
      base,
      bonus: 0,
      total: base,
    };
  }, [selectedAmountCents]);

  const summaryItems = useMemo(
    () => [
      {
        label: "当前余额",
        value: account?.balance_credits ?? 0,
        note: "当前可用算力豆余额",
        icon: Wallet,
      },
      {
        label: "累计充值",
        value: `¥${((account?.total_recharged_cents ?? 0) / 100).toFixed(2)}`,
        note: canViewAllBillingData ? "累计充值人民币金额" : "个人可见范围内的充值金额",
        icon: CreditCard,
      },
      {
        label: "累计赠送",
        value: account?.total_bonus_credits ?? 0,
        note: "平台赠送或活动入账的算力豆",
        icon: Coins,
      },
      {
        label: "累计消耗",
        value: account?.total_consumed_credits ?? 0,
        note: "任务执行与系统扣费累计消耗",
        icon: Receipt,
      },
    ],
    [account?.balance_credits, account?.total_bonus_credits, account?.total_consumed_credits, account?.total_recharged_cents, canViewAllBillingData],
  );

  const createOrder = async () => {
    setError(null);
    setCreatingPayment(true);
    try {
      const order = await api.createPaymentOrder({
        channel: selectedChannel,
        amount_cents: selectedAmountCents,
        subject: `DramaLab 算力豆充值 ¥${(selectedAmountCents / 100).toFixed(2)}`,
        description: `${currentOrganizationName} 在线充值`,
        idempotency_key: `pay-${selectedChannel}-${selectedAmountCents}-${Date.now()}`,
      });
      setActiveOrder(order);
      await loadPaymentOrders();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建支付订单失败");
    } finally {
      setCreatingPayment(false);
    }
  };

  const simulatePaid = async () => {
    if (!activeOrder) return;
    setError(null);
    setSimulatingPayment(true);
    try {
      const order = await api.simulatePaymentOrderPaid(activeOrder.id);
      setActiveOrder(order);
      await Promise.all([loadAccount(), loadCredits(), loadPaymentOrders(), loadActiveOrderEvents(order.id)]);
    } catch (simulateError) {
      setError(simulateError instanceof Error ? simulateError.message : "模拟支付失败");
    } finally {
      setSimulatingPayment(false);
    }
  };

  const cancelOrder = async () => {
    if (!activeOrder) return;
    setError(null);
    setCancellingPayment(true);
    try {
      const order = await api.cancelPaymentOrder(activeOrder.id);
      setActiveOrder(order);
      await Promise.all([loadPaymentOrders(), loadActiveOrderEvents(order.id)]);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "取消支付订单失败");
    } finally {
      setCancellingPayment(false);
    }
  };

  if (!hasCapability("workspace.view")) {
    return (
      <section className="studio-panel rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-5 text-sm leading-7 text-amber-800">
        你当前没有查看组织算力豆账本的权限。
      </section>
    );
  }

  if (loading) {
    return (
      <section className="studio-panel flex min-h-[320px] items-center justify-center">
        <Loader2 className="animate-spin text-primary" />
      </section>
    );
  }

  return (
    <div className={`${BODY_FONT_CLASS} space-y-6`}>
      {error ? (
        <section className="studio-panel p-4 rounded-none">
          <div className="rounded-none border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        </section>
      ) : null}

      <section className="relative overflow-hidden rounded-[2rem] border border-[#d8d0c2] bg-[#f6f1e8] shadow-[0_28px_90px_rgba(36,31,22,0.12)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.64),rgba(255,255,255,0.08))]" />
        <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(120,113,108,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(120,113,108,0.08)_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="relative grid xl:grid-cols-[1.2fr_0.8fr]">
          <div className="border-b border-[#d8d0c2] p-8 xl:border-b-0 xl:border-r">
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold uppercase tracking-[0.28em] text-stone-500">
              <span className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white/75 px-3 py-1">
                <Sparkles className="h-3.5 w-3.5" /> Recharge Atelier
              </span>
              <span>PC 扫码支付</span>
            </div>

            <div className="mt-6 max-w-2xl">
              <h2 className={`${DISPLAY_FONT_CLASS} text-4xl leading-none text-stone-900 md:text-5xl`}>
                把充值页做成一张
                <span className="mx-2 inline-block rotate-[-2deg] rounded-sm bg-stone-900 px-3 py-1 text-[#f6f1e8]">
                  收银票据
                </span>
                ，而不是后台表单。
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-stone-600">
                当前充值将直接进入 <span className="font-semibold text-stone-900">{currentOrganizationName}</span> 的组织账本。
                先选金额，再切换微信支付或支付宝，系统会生成一张独立二维码并自动轮询到账状态。
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-4">
              {RECHARGE_PRESETS.map((amount) => {
                const selected = selectedAmountCents === amount;
                return (
                  <button
                    key={amount}
                    onClick={() => setSelectedAmountCents(amount)}
                    className={`rounded-[1.6rem] border px-5 py-5 text-left transition-all ${
                      selected
                        ? "border-stone-900 bg-stone-900 text-[#f7f1e7] shadow-[0_18px_50px_rgba(28,25,23,0.22)]"
                        : "border-stone-300 bg-white/80 text-stone-900 hover:-translate-y-0.5 hover:border-stone-400 hover:bg-white"
                    }`}
                  >
                    <div className="text-[11px] uppercase tracking-[0.24em] opacity-60">Top-up</div>
                    <div className={`${DISPLAY_FONT_CLASS} mt-3 text-3xl`}>¥{(amount / 100).toFixed(0)}</div>
                    <div className="mt-3 text-xs opacity-80">预计到账 {Math.floor((amount / 100) * 10)} 豆起</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-[1.8rem] border border-stone-300 bg-white/85 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-stone-500">Pay Channel</div>
                    <div className={`${DISPLAY_FONT_CLASS} mt-2 text-2xl text-stone-900`}>选择扫码渠道</div>
                  </div>
                  <QrCode className="h-5 w-5 text-stone-400" />
                </div>
                <div className="mt-5 grid gap-3">
                  {(["wechat", "alipay"] as const).map((channel) => {
                    const meta = CHANNEL_META[channel];
                    const selected = selectedChannel === channel;
                    return (
                      <button
                        key={channel}
                        onClick={() => setSelectedChannel(channel)}
                        className={`rounded-[1.4rem] border p-4 text-left transition-all ${
                          selected
                            ? `border-transparent bg-gradient-to-br ${meta.accent} text-white shadow-lg ring-4 ${meta.ring}`
                            : "border-stone-200 bg-[#faf7f2] text-stone-800 hover:border-stone-400"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.2em] opacity-70">{meta.short}</div>
                            <div className="mt-1 text-lg font-semibold">{meta.label}</div>
                          </div>
                          <ScanLine className="h-4 w-4 opacity-80" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[1.8rem] border border-stone-300 bg-[#111111] p-5 text-[#f7f1e7]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Settlement Preview</div>
                    <div className={`${DISPLAY_FONT_CLASS} mt-2 text-3xl`}>到账预览</div>
                  </div>
                  <CircleDollarSign className="h-5 w-5 text-stone-500" />
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-stone-400">金额</div>
                    <div className={`${DISPLAY_FONT_CLASS} mt-2 text-3xl`}>¥{(selectedAmountCents / 100).toFixed(2)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-stone-400">基础豆</div>
                    <div className={`${DISPLAY_FONT_CLASS} mt-2 text-3xl`}>{estimatedCredits.base}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-stone-400">基础到账</div>
                    <div className={`${DISPLAY_FONT_CLASS} mt-2 text-3xl text-[#f7d577]`}>{estimatedCredits.total}</div>
                  </div>
                </div>
                <p className="mt-4 text-xs leading-6 text-stone-400">
                  赠送豆数会按后端实时活动规则结算，生成支付票据后会展示该订单的准确到账总额。
                </p>
                <button
                  onClick={() => void createOrder()}
                  disabled={creatingPayment}
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#f3e9d5] px-6 py-3 text-sm font-semibold text-stone-900 transition hover:-translate-y-0.5 hover:bg-white disabled:opacity-40"
                >
                  {creatingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                  生成 {CHANNEL_META[selectedChannel].label} 二维码
                </button>
              </div>
            </div>
          </div>

          <div className="p-8">
            <div className="rounded-[2rem] border border-stone-300 bg-white/88 p-6 shadow-[0_18px_60px_rgba(28,25,23,0.08)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-stone-500">Active Ticket</div>
                  <div className={`${DISPLAY_FONT_CLASS} mt-2 text-3xl text-stone-900`}>
                    {activeOrder?.status === "pending" ? "请打开手机扫码" : "等待生成支付票据"}
                  </div>
                </div>
                {paymentLoading ? <Loader2 className="h-4 w-4 animate-spin text-stone-400" /> : null}
              </div>

              <div className="mt-6 rounded-[1.8rem] border border-dashed border-stone-300 bg-[#faf7f2] p-5">
                {activeOrder?.qr_code_svg ? (
                  <div className="flex flex-col items-center gap-4">
                    <div
                      className="rounded-[1.6rem] bg-white p-4 shadow-[0_18px_40px_rgba(17,17,17,0.08)]"
                      dangerouslySetInnerHTML={{ __html: activeOrder.qr_code_svg }}
                    />
                    <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${CHANNEL_META[activeOrder.channel as "wechat" | "alipay"]?.tone || "border-stone-200 bg-white text-stone-700"}`}>
                      {CHANNEL_META[activeOrder.channel as "wechat" | "alipay"]?.label || activeOrder.channel}
                    </div>
                    <div className="text-center text-xs leading-6 text-stone-500">
                      <div>订单金额：¥{(activeOrder.amount_cents / 100).toFixed(2)}</div>
                      <div>预计到账：{activeOrder.total_credits} 豆</div>
                      <div>订单编号：{activeOrder.id}</div>
                      <div>状态：{PAYMENT_STATUS_LABELS[activeOrder.status] || activeOrder.status}</div>
                    </div>
                    <div className="grid w-full gap-2 rounded-[1.4rem] border border-stone-200 bg-white/80 p-3 text-xs text-stone-600">
                      <div className="flex items-center justify-between gap-3">
                        <span className="uppercase tracking-[0.2em] text-stone-400">Provider Mode</span>
                        <span className="rounded-full border border-stone-300 px-2.5 py-1 font-semibold text-stone-900">
                          {PAYMENT_PROVIDER_MODE_LABELS[activeOrder.provider_mode] || activeOrder.provider_mode}
                        </span>
                      </div>
                      <div className="leading-6">
                        {activeOrder.provider_mode === "mock"
                          ? "当前页面处于联调模式，可直接模拟支付成功，适合本地与测试环境打通到账链路。"
                          : "当前页面已切到正式网关模式，系统会等待支付平台回调确认后再执行组织账本入账。"}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {activeOrder.provider_mode === "mock" && activeOrder.status === "pending" ? (
                        <button
                          onClick={() => void simulatePaid()}
                          disabled={simulatingPayment}
                          className="rounded-full border border-stone-900 px-4 py-2 text-xs font-semibold text-stone-900 transition hover:bg-stone-900 hover:text-white disabled:opacity-40"
                        >
                          {simulatingPayment ? "模拟到账中..." : "开发态模拟支付成功"}
                        </button>
                      ) : null}
                      {activeOrder.status === "pending" ? (
                        <button
                          onClick={() => void cancelOrder()}
                          disabled={cancellingPayment}
                          className="rounded-full border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900 disabled:opacity-40"
                        >
                          {cancellingPayment ? "取消中..." : "取消订单"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : activeOrder?.qr_payload ? (
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex h-[280px] w-[280px] items-center justify-center rounded-[1.6rem] border border-dashed border-stone-300 bg-white p-6 text-center text-sm leading-7 text-stone-500">
                      当前环境还没有把二维码渲染成 SVG。
                      <br />
                      后端安装 `qrcode` 依赖后，这里会直接展示可扫码图形。
                    </div>
                    <div className="w-full rounded-[1.2rem] border border-stone-200 bg-white px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-stone-400">QR Payload</div>
                      <div className="mt-2 break-all font-mono text-xs leading-6 text-stone-700">{activeOrder.qr_payload}</div>
                    </div>
                  </div>
                ) : (
                  <div className="py-10 text-center text-sm leading-7 text-stone-500">
                    先在左侧选金额和支付渠道。
                    <br />
                    系统会生成一张独立的扫码票据，并自动追踪到账状态。
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-[1.8rem] border border-stone-200 bg-[#fcfaf6] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-stone-500">Status Timeline</div>
                    <div className="mt-2 text-base font-semibold text-stone-900">订单状态时间线</div>
                  </div>
                  <Sparkles className="h-4 w-4 text-stone-400" />
                </div>
                <div className="mt-4 space-y-3">
                  {orderEvents.length ? orderEvents.map((event, index) => (
                    <div key={event.id} className="flex gap-3">
                      <div className="flex w-6 flex-col items-center">
                        <div className="h-2.5 w-2.5 rounded-full bg-stone-900" />
                        {index !== orderEvents.length - 1 ? <div className="mt-1 h-full w-px bg-stone-200" /> : null}
                      </div>
                      <div className="flex-1 rounded-2xl border border-stone-200 bg-white px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold text-stone-900">{PAYMENT_EVENT_LABELS[event.event_type] || event.event_type}</div>
                          <div className="text-xs text-stone-500">{new Date(event.created_at).toLocaleString("zh-CN")}</div>
                        </div>
                        {(event.from_status || event.to_status) ? (
                          <div className="mt-2 text-xs text-stone-500">
                            {event.from_status ? `${PAYMENT_STATUS_LABELS[event.from_status] || event.from_status} -> ` : ""}
                            {event.to_status ? PAYMENT_STATUS_LABELS[event.to_status] || event.to_status : ""}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-stone-200 px-4 py-5 text-sm leading-7 text-stone-500">
                      生成支付票据后，这里会展示创建、过期、取消、到账等关键事件。
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {(activeOrder ? [activeOrder, ...paymentOrders.filter((item) => item.id !== activeOrder.id)] : paymentOrders).slice(0, 4).map((order) => (
                  <button
                    key={order.id}
                    onClick={() => setActiveOrder(order)}
                    className={`w-full rounded-[1.4rem] border px-4 py-4 text-left transition ${
                      activeOrder?.id === order.id ? "border-stone-900 bg-stone-900 text-[#f7f1e7]" : "border-stone-200 bg-[#faf7f2] text-stone-800 hover:border-stone-400"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.22em] opacity-60">{order.channel}</div>
                        <div className="mt-1 font-semibold">¥{(order.amount_cents / 100).toFixed(2)} / {order.total_credits} 豆</div>
                      </div>
                      <div className="text-right text-xs opacity-75">
                        <div>{PAYMENT_STATUS_LABELS[order.status] || order.status}</div>
                        <div className="mt-1">{new Date(order.created_at).toLocaleString("zh-CN")}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <AdminSummaryStrip items={summaryItems} />

      <section className={`grid gap-6 ${canViewAllBillingData ? "xl:grid-cols-2" : "xl:grid-cols-1"}`}>
        {canViewAllBillingData ? (
          <section className="studio-panel flex flex-col overflow-hidden rounded-none">
            <div className="admin-ledger-head">
              <div>
                <h3 className="text-xl font-semibold studio-strong">最近入账记录</h3>
                <p className="mt-1 text-sm studio-muted">包含充值、赠送和人工补录等入账动作。</p>
              </div>
              {creditLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <span className="admin-status-badge admin-status-badge-neutral">{credits.length} 条</span>
              )}
            </div>
            <div className="admin-governance-table flex-1 border-0 rounded-none">
              <table className="bg-white text-sm">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>时间</th>
                    <th>金额 / 豆数</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody className={creditLoading ? "opacity-50" : ""}>
                  {credits.length ? credits.map((item) => (
                    <tr key={item.id}>
                      <td className="font-semibold text-slate-900">{TRANSACTION_TYPE_LABELS[item.transaction_type] || item.transaction_type}</td>
                      <td className="text-slate-700">{new Date(item.created_at).toLocaleString("zh-CN")}</td>
                      <td className="text-emerald-700 font-semibold">
                        {formatTransactionAmount(item)}
                        <div className="mt-1 text-xs text-slate-500">{item.cash_amount_cents ? `¥${(item.cash_amount_cents / 100).toFixed(2)}` : "系统入账"}</div>
                      </td>
                      <td className="text-slate-700">{item.remark || "-"}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">当前组织还没有充值或赠送记录。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 p-4">
              <div className="text-xs text-slate-500">当前第 {Math.floor(creditOffset / PAGE_SIZE) + 1} 页</div>
              <div className="flex gap-2">
                <button
                  disabled={creditOffset === 0 || creditLoading}
                  onClick={() => setCreditOffset(Math.max(0, creditOffset - PAGE_SIZE))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  disabled={credits.length < PAGE_SIZE || creditLoading}
                  onClick={() => setCreditOffset(creditOffset + PAGE_SIZE)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section className="studio-panel flex flex-col overflow-hidden rounded-none">
          <div className="admin-ledger-head">
            <div>
              <h3 className="text-xl font-semibold studio-strong">{canViewAllBillingData ? "最近扣费记录" : "我的扣费记录"}</h3>
              <p className="mt-1 text-sm studio-muted">查看任务执行后的扣费结果与余额变化。</p>
            </div>
            {debitLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <span className="admin-status-badge admin-status-badge-neutral">{debits.length} 条</span>
            )}
          </div>
          <div className="admin-governance-table flex-1 border-0 rounded-none">
            <table className="bg-white text-sm">
              <thead>
                <tr>
                  <th>扣费类型</th>
                  <th>时间</th>
                  <th>豆数变化</th>
                  <th>余额</th>
                </tr>
              </thead>
              <tbody className={debitLoading ? "opacity-50" : ""}>
                {debits.length ? debits.map((item) => (
                  <tr key={item.id}>
                    <td className="font-semibold text-slate-900">
                      {TASK_TYPE_LABELS[item.task_type || ""] || item.task_type || TRANSACTION_TYPE_LABELS[item.transaction_type] || item.transaction_type}
                    </td>
                    <td className="text-slate-700">{new Date(item.created_at).toLocaleString("zh-CN")}</td>
                    <td className={item.amount_credits === 0 ? "text-slate-700 font-semibold" : "text-rose-700 font-semibold"}>{formatTransactionAmount(item)}</td>
                    <td className="text-slate-700">{item.balance_after}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">{canViewAllBillingData ? "当前组织还没有任务扣费记录。" : "你当前还没有算力豆扣费记录。"}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 p-4">
            <div className="text-xs text-slate-500">当前第 {Math.floor(debitOffset / PAGE_SIZE) + 1} 页</div>
            <div className="flex gap-2">
              <button
                disabled={debitOffset === 0 || debitLoading}
                onClick={() => setDebitOffset(Math.max(0, debitOffset - PAGE_SIZE))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                disabled={debits.length < PAGE_SIZE || debitLoading}
                onClick={() => setDebitOffset(debitOffset + PAGE_SIZE)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
