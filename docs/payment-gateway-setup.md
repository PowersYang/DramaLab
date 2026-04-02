# 在线支付配置说明

本文对应 DramaLab 当前已接入的 PC 扫码支付能力：

- 微信支付：`Native` 下单
- 支付宝：`alipay.trade.precreate` 预创建下单

## 1. 开关配置

在 [backend/.env](/Users/will/Documents/jishu/code/DramaLab/backend/.env) 中把：

```env
PAYMENT_PROVIDER_MODE=gateway
```

同时填写：

```env
PAYMENT_NOTIFY_BASE_URL=https://你的后端公网地址
```

这个地址必须满足：

- 可以被微信支付和支付宝公网访问
- 最终回调地址会自动拼成：
  - `https://你的后端公网地址/billing/payment-providers/wechat/notify`
  - `https://你的后端公网地址/billing/payment-providers/alipay/notify`

## 2. 微信支付 Native 配置

需要填写这些字段：

```env
WECHAT_PAY_BASE_URL=https://api.mch.weixin.qq.com
WECHAT_PAY_APP_ID=你的微信支付 appid
WECHAT_PAY_MCH_ID=你的微信支付商户号
WECHAT_PAY_MCH_SERIAL_NO=商户证书序列号
WECHAT_PAY_PRIVATE_KEY_PATH=/绝对路径/apiclient_key.pem
WECHAT_PAY_API_V3_KEY=32位 APIv3 密钥
WECHAT_PAY_PLATFORM_CERT_PATH=/绝对路径/wechatpay_platform_cert.pem
```

字段来源：

- `WECHAT_PAY_APP_ID`
  - 来自微信开放平台 / 微信支付商户平台绑定的应用信息
- `WECHAT_PAY_MCH_ID`
  - 来自微信支付商户平台
- `WECHAT_PAY_MCH_SERIAL_NO`
  - 来自商户 API 证书序列号
- `WECHAT_PAY_PRIVATE_KEY_PATH`
  - 对应商户 API 私钥 PEM 文件
- `WECHAT_PAY_API_V3_KEY`
  - 来自微信支付 APIv3 密钥配置
- `WECHAT_PAY_PLATFORM_CERT_PATH`
  - 微信支付平台证书 PEM 文件，用于回调验签

当前实现能力：

- 下单：`POST /v3/pay/transactions/native`
- 回调：
  - 验证微信支付签名
  - 使用 `APIv3 Key` 解密密文资源
  - 支付成功后幂等入账

## 3. 支付宝预创建配置

需要填写这些字段：

```env
ALIPAY_GATEWAY_URL=https://openapi.alipay.com/gateway.do
ALIPAY_APP_ID=你的支付宝 app_id
ALIPAY_APP_PRIVATE_KEY_PATH=/绝对路径/alipay_app_private_key.pem
ALIPAY_PUBLIC_KEY_PATH=/绝对路径/alipay_public_key.pem
```

字段来源：

- `ALIPAY_APP_ID`
  - 支付宝开放平台应用 ID
- `ALIPAY_APP_PRIVATE_KEY_PATH`
  - 你自己的应用私钥 PEM 文件
- `ALIPAY_PUBLIC_KEY_PATH`
  - 支付宝开放平台公钥 PEM 文件

当前实现能力：

- 下单：`alipay.trade.precreate`
- 回调：
  - RSA2 验签
  - `TRADE_SUCCESS` / `TRADE_FINISHED` 时幂等入账

## 4. 证书与密钥文件建议

建议把支付证书集中放到服务器安全目录，例如：

```text
/opt/dramalab/certs/
├── wechat/
│   ├── apiclient_key.pem
│   └── wechatpay_platform_cert.pem
└── alipay/
    ├── app_private_key.pem
    └── alipay_public_key.pem
```

然后把 `.env` 写成绝对路径。

## 5. 依赖安装

支付能力依赖这些 Python 包：

- `cryptography`
- `qrcode`

更新依赖后执行：

```bash
cd /Users/will/Documents/jishu/code/DramaLab/backend
pip install -r requirements.txt
```

说明：

- `cryptography` 用于微信/支付宝签名验签与微信回调解密
- `qrcode` 用于把 `code_url / qr_code` 渲染成可扫码 SVG
- 如果没安装 `qrcode`，后端仍可完成真实下单，但前端只会展示原始 `qr_payload`，不会展示可扫码图片

## 6. 上线前检查

至少确认这几项：

- `PAYMENT_PROVIDER_MODE=gateway`
- `PAYMENT_NOTIFY_BASE_URL` 已配置为公网可访问域名
- 微信和支付宝回调地址都已经在各自平台配置
- 服务器上证书路径真实存在，FastAPI 进程有读取权限
- 安装过最新 `requirements.txt`
- 先在测试商户 / 沙箱环境跑通：
  - 创建支付单
  - 实际支付
  - 回调到账
  - 重复回调不重复加豆
