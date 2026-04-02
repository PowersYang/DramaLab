# DramaLab 上线配置指南

本文用于整理 DramaLab 在测试环境或正式环境上线时需要准备的配置。目标不是把所有参数都塞进 `.env`，而是把“环境变量必配”和“平台后台/数据库必配”分开说明，避免遗漏。

## 1. 配置总览

DramaLab 当前的上线配置分成三类：

- 环境变量：进程启动时必须读取的基础配置，主要位于 `backend/.env`，少量位于前端构建环境。
- 平台后台配置：需要平台超级管理员在 Studio 后台维护的配置，例如模型供应商密钥、模型目录、计费规则、充值赠送规则、任务并发限制。
- 基础设施配置：数据库、对象存储、反向代理、HTTPS、Supervisor/进程管理等。

## 2. 后端环境变量必配项

这些配置建议在 `backend/.env` 中显式配置。

### 2.1 数据库

优先二选一：

- `DATABASE_URL`
- 控制什么：控制后端完整数据库连接串；一旦配置，会优先覆盖所有 `POSTGRES_*` 拆分配置。
- 或完整的 `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`
- 控制什么：分别控制 PostgreSQL 主机、端口、数据库名、用户名和密码。

可选但推荐：

- `POSTGRES_SCHEMA`
- 控制什么：控制 DramaLab 在 PostgreSQL 中使用哪个 schema，避免与同库其他应用混用。

说明：

- 生产倾向 PostgreSQL。
- SQLite 主要用于测试，不建议承担正式环境。

### 2.2 认证与会话

必配：

- `AUTH_JWT_SECRET`
  控制什么：控制 access token、邀请 token 等 JWT 的签名密钥；必须替换为强随机值。
- `AUTH_APP_BASE_URL`
  控制什么：控制邀请链接、邮件里的跳转链接指向哪个外部站点地址。

建议显式配置：

- `AUTH_COOKIE_SECURE`
  控制什么：控制 access/refresh cookie 是否带 `Secure` 标记；HTTPS 环境建议为 `true`。
- `AUTH_ACCESS_TOKEN_TTL_MINUTES`
  控制什么：控制 access token 过期分钟数。
- `AUTH_REFRESH_TOKEN_TTL_DAYS`
  控制什么：控制 refresh session 的绝对过期天数。
- `AUTH_REFRESH_TOKEN_IDLE_TTL_DAYS`
  控制什么：控制 refresh session 的空闲过期天数。
- `AUTH_EMAIL_CODE_TTL_MINUTES`
  控制什么：控制邮箱验证码有效期。
- `AUTH_VERIFICATION_CODE_TTL_MINUTES`
  控制什么：控制通用验证码记录有效期。
- `AUTH_CAPTCHA_TTL_SECONDS`
  控制什么：控制图形验证码挑战有效期。
- `AUTH_SEND_CODE_COOLDOWN_SECONDS`
  控制什么：控制同一标识两次发验证码之间的冷却时间。
- `AUTH_SEND_CODE_LIMIT_PER_IDENTIFIER_PER_HOUR`
  控制什么：控制同一账号标识每小时最多发码次数。
- `AUTH_SEND_CODE_LIMIT_PER_IP_PER_HOUR`
  控制什么：控制同一 IP 每小时最多发码次数。
- `AUTH_PLATFORM_SUPER_ADMIN_EMAILS`
  控制什么：控制哪些邮箱登录后具备平台超级管理员身份。

强提醒：

- `AUTH_EXPOSE_TEST_CODE` 生产环境必须为 `false`。
- 如果上线后仍允许 refresh token 长期存活但未启用 HTTPS secure cookie，会放大会话泄露风险。

### 2.3 邮件验证码

如果要支持邮箱验证码登录、注册、重置密码，必须配置：

- `AUTH_EMAIL_SMTP_HOST`
- 控制什么：控制验证码邮件发送所使用的 SMTP 主机。
- `AUTH_EMAIL_SMTP_PORT`
- 控制什么：控制 SMTP 端口。
- `AUTH_EMAIL_SMTP_USER`
- 控制什么：控制 SMTP 登录账号。
- `AUTH_EMAIL_SMTP_PASSWORD`
- 控制什么：控制 SMTP 登录密码或授权码。
- `AUTH_EMAIL_FROM`
- 控制什么：控制验证码邮件发件人地址。
- `AUTH_EMAIL_SMTP_TLS`
- 控制什么：控制 SMTP 是否启用 STARTTLS。
- `AUTH_EMAIL_SMTP_SSL`
- 控制什么：控制 SMTP 是否直连 SSL。

说明：

- 当前前端在邮件未配置时会明确提示用户当前环境无法发送验证码。
- 常见组合是 `587 + TLS=true + SSL=false`，或 `465 + TLS=false + SSL=true`。

### 2.4 短信验证码

如果要支持手机号验证码登录，至少需要：

- `AUTH_SMS_PROVIDER`
- 控制什么：控制短信验证码发送实现；当前支持 `disabled`、`mock`、`webhook`。

当前支持值：

- `disabled`
- `mock`
- `webhook`

当 `AUTH_SMS_PROVIDER=webhook` 时，还需要：

- `AUTH_SMS_WEBHOOK_URL`
- 控制什么：控制短信 webhook 模式下把验证码转发到哪个外部接口。
- `AUTH_SMS_WEBHOOK_TOKEN`
- 控制什么：控制短信 webhook 模式下请求外部接口时使用的 Bearer Token。

说明：

- 当前仓库里的短信实现是 webhook 适配层，不是直接绑定某一家短信云厂商。
- 上线前需要确认你的短信网关是否接受 `phone/code/purpose` 这三个字段。

### 2.5 对象存储与媒资访问

如果要让图片/视频脱离单机磁盘并适配多实例部署，建议完整配置：

- `ALIBABA_CLOUD_ACCESS_KEY_ID`
- 控制什么：控制阿里云 OSS 等服务的 Access Key ID。
- `ALIBABA_CLOUD_ACCESS_KEY_SECRET`
- 控制什么：控制阿里云 OSS 等服务的 Access Key Secret。
- `OSS_BUCKET_NAME`
- 控制什么：控制媒体资源上传到哪个 OSS Bucket。
- `OSS_ENDPOINT`
- 控制什么：控制 OSS 所在地域与访问端点。
- `OSS_BASE_PATH`
- 控制什么：控制上传到 OSS 后统一落在哪个目录前缀下。
- `OSS_PUBLIC_BASE_URL`
- 控制什么：控制前端展示媒体时使用哪个公网 URL 前缀。

说明：

- `OSS_PUBLIC_BASE_URL` 强烈建议填写 CDN 域名或 OSS 绑定域名，避免前端直接依赖裸 OSS 地址。
- 不建议把媒体长期落在本地磁盘路径。

### 2.6 API 服务自身

基础运行配置：

- `API_HOST`
- 控制什么：控制 FastAPI 服务监听地址。
- `API_PORT`
- 控制什么：控制 FastAPI 服务监听端口。

跨区域或国际环境可选：

- `DASHSCOPE_BASE_URL`
- 控制什么：控制 DashScope 兼容接口基础地址，通常用于国际环境或代理环境。
- `KLING_BASE_URL`
- 控制什么：控制 Kling API 基础地址。
- `VIDU_BASE_URL`
- 控制什么：控制 Vidu API 基础地址。

### 2.7 支付

当前环境变量：

- `PAYMENT_PROVIDER_MODE`
- 控制什么：控制支付链路当前使用 mock 还是真实 provider 模式。

当前代码现状：

- 仅内置 `mock`
- 真实支付宝/微信支付 provider 尚未正式接通

因此：

- 测试环境可保留 `PAYMENT_PROVIDER_MODE=mock`
- 正式收费上线前，需要先补真实支付 provider、回调验签、到账确认与风控链路

## 3. 后端环境变量可选项

这些配置按是否启用对应能力决定。

### 3.1 DashScope / 基础模型能力

如果仍保留 `.env` 驱动的默认模型能力，可配置：

- `DASHSCOPE_API_KEY`
- 控制什么：控制默认 DashScope 模型能力调用的 API Key。
- `OPENAI_API_KEY`
- 控制什么：控制 OpenAI 兼容供应商调用时使用的 API Key。
- `OPENAI_BASE_URL`
- 控制什么：控制 OpenAI 兼容接口的基础地址。
- `OPENAI_MODEL`
- 控制什么：控制默认文本模型名。
- `LLM_PROVIDER`
- 控制什么：控制默认文本模型走哪个 provider 适配层。
- `LLM_REQUEST_TIMEOUT_SECONDS`
- 控制什么：控制文本模型单次请求超时。
- `LLM_MAX_RETRIES`
- 控制什么：控制文本模型单次请求失败后的重试次数。
- `DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS`
- 控制什么：控制全局默认 LLM 请求超时。
- `DEFAULT_LLM_MAX_RETRIES`
- 控制什么：控制全局默认 LLM 重试次数。

但要注意：

- 项目已经逐步收敛到“平台模型供应商配置 + 模型目录”的后台管理模式。
- 很多模型调用最终依赖平台级 provider 配置，而不是单纯依赖 `.env`。

### 3.2 视频供应商直连参数

按能力启用：

- `KLING_ACCESS_KEY`
- 控制什么：控制 Kling 供应商鉴权 access_key。
- `KLING_SECRET_KEY`
- 控制什么：控制 Kling 供应商鉴权 secret_key。
- `VIDU_API_KEY`
- 控制什么：控制 Vidu 供应商 API Key。
- `ARK_API_KEY`
- 控制什么：控制豆包 Ark / Doubao 供应商 API Key。

说明：

- 当前仓库同时存在 `.env` 示例和平台模型供应商配置两种来源。
- 上线时建议统一收口到平台后台配置，避免同一能力存在两套密钥来源。

## 4. 前端构建与运行配置

前端侧当前显式用到的环境变量不多，主要是：

- `NEXT_PUBLIC_API_URL`
- 控制什么：控制前端请求后端时优先使用的 API 根地址。
- `NEXT_PUBLIC_USE_DEV_PROXY`
- 控制什么：控制开发环境是否强制走 Next dev 代理转发。
- `DOCKER_BUILD`
- 控制什么：控制前端构建时是否按 Docker 场景调整输出目录。
- `NEXT_STATIC_EXPORT`
- 控制什么：控制前端是否以静态导出模式构建。

说明：

- `NEXT_PUBLIC_API_URL` 用于覆盖默认后端地址。
- `NEXT_PUBLIC_USE_DEV_PROXY` 主要是开发态代理控制，不建议作为正式环境长期依赖。
- 如果不是静态导出部署，通常不需要开启 `NEXT_STATIC_EXPORT`。

## 5. 不是 `.env` 配，而是要进后台配的项

这些是上线时最容易漏掉的，因为它们不是靠 `backend/.env` 自动生效。

### 5.1 平台模型供应商配置

需要在平台超级管理员后台配置：

- 供应商是否启用
- `base_url`
- 凭据字段，例如 `api_key` / `access_key` / `secret_key`
- 模型目录上下线
- 默认文本模型

对应页面：

- `/studio/model-config`

### 5.2 计费规则与充值赠送

需要在平台超级管理员后台配置：

- `BillingPricingRule`
- `BillingRechargeBonusRule`
- 手工充值策略

对应页面：

- `/studio/billing-admin`

强提醒：

- 如果没有计费规则，任务扣费链路会因为 pricing 未配置而失败。
- 这部分不是环境变量问题，是后台主数据问题。

### 5.3 任务并发限制

需要在平台超级管理员后台确认：

- 各组织各任务类型的 `max_concurrency`

对应页面：

- `/studio/task-concurrency`

说明：

- `0` 表示暂停该组织该任务类型执行。
- 新组织会初始化默认并发限制，但上线前最好人工核查。

### 5.4 平台公告与平台管理员

需要确认：

- 平台超级管理员邮箱是否已配置
- 平台公告是否需要预置

## 6. 推荐的上线核对顺序

建议按下面顺序核对，而不是只盯着 `.env`：

1. 数据库连通，schema 正确。
2. `AUTH_JWT_SECRET`、`AUTH_APP_BASE_URL`、`AUTH_COOKIE_SECURE` 已配置。
3. 邮件验证码链路可用；若启用短信，则短信 webhook 可用。
4. OSS 已配置，前端拿到的媒体 URL 可外网访问。
5. 平台超级管理员可登录 Studio。
6. `/studio/model-config` 中的供应商密钥、模型目录已配置完。
7. `/studio/billing-admin` 中的计费规则、充值赠送规则已配置完。
8. `/studio/task-concurrency` 中的组织并发限制已确认。
9. 如需收费，确认当前支付仍是 `mock` 还是真实 provider。
10. 用一个普通用户完整走一遍：
    注册/登录 -> 创建项目 -> 提交任务 -> 扣费/余额展示 -> 任务完成 -> 资源可访问

## 7. 生产环境特别提醒

- 不要在生产环境开启 `AUTH_EXPOSE_TEST_CODE=true`
- 不要继续使用默认或缺失的 `AUTH_JWT_SECRET`
- 不要让 refresh cookie 在 HTTPS 环境下仍保持 `AUTH_COOKIE_SECURE=false`
- 不要假设仅改 `.env` 就能让计费、模型、并发策略自动正确
- 不要把模型供应商密钥同时维护在 `.env` 和平台后台两套地方

## 8. 当前最小上线配置建议

如果只是先把测试环境跑稳，最小建议是：

- PostgreSQL 连接配置完整
- `AUTH_JWT_SECRET` 已替换
- `AUTH_APP_BASE_URL` 指向实际外部地址
- `AUTH_COOKIE_SECURE` 按是否 HTTPS 正确设置
- SMTP 配好
- OSS 配好
- 平台模型供应商配置已在后台补齐
- 平台计费规则已在后台补齐
- `PAYMENT_PROVIDER_MODE=mock`

如果后续要正式对外收费，再单独推进真实支付 provider 接入，不建议把“上线创作平台”和“上线真实支付”绑成同一个改动批次。
