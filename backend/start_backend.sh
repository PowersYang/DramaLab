#!/bin/bash

# 阿里云服务不走代理（避免PAC配置被Python忽略）
# macOS系统代理会被requests库读取，但PAC规则不会被解析
# 显式设置NO_PROXY确保阿里云域名直连
export NO_PROXY="*.aliyuncs.com,localhost,127.0.0.1"
export no_proxy="*.aliyuncs.com,localhost,127.0.0.1"

echo "========================================"
echo "Starting Backend (FastAPI)..."
echo "Port: 17177"
echo "Proxy Bypass: *.aliyuncs.com"
echo "========================================"

# 确保在 backend 项目根目录
cd "$(dirname "$0")"

# 开发态只监听 Python 源码目录，并排除运行产物目录；否则日志写入 output/logs/app.log
# 也会触发 uvicorn 热重载，导致前端代理在请求过程中遇到 socket hang up。
python3 -m uvicorn main:create_app --factory --reload \
  --reload-dir src \
  --reload-dir . \
  --reload-include '*.py' \
  --reload-exclude 'output/*' \
  --reload-exclude 'output/**' \
  --reload-exclude '*.log' \
  --port 17177 \
  --host 0.0.0.0
