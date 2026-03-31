#!/bin/bash

echo "========================================"
echo "Starting Frontend (Next.js)..."
echo "========================================"

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT/frontend"

# 若本机装了 nvm，则优先使用仓库声明的 Node 版本，避免 PATH 中旧版 /usr/local/bin/node 抢前。
if [ -f "$REPO_ROOT/.nvmrc" ] && [ -d "$HOME/.nvm/versions/node" ]; then
    REQUESTED_NODE_MAJOR_MINOR_PATCH="$(tr -d '[:space:]' < "$REPO_ROOT/.nvmrc")"
    NVM_NODE_DIR="$(find "$HOME/.nvm/versions/node" -maxdepth 1 -type d -name "v${REQUESTED_NODE_MAJOR_MINOR_PATCH}*" | sort -V | tail -n 1)"
    if [ -n "$NVM_NODE_DIR" ] && [ -x "$NVM_NODE_DIR/bin/node" ]; then
        export PATH="$NVM_NODE_DIR/bin:$PATH"
    fi
fi

# Next 14 运行时最低要求 Node 18.17.0；版本过低直接失败，避免开发时再踩隐式兼容坑。
CURRENT_NODE_VERSION="$(node -v 2>/dev/null | sed 's/^v//')"
REQUIRED_NODE_VERSION="18.17.0"
if [ -z "$CURRENT_NODE_VERSION" ]; then
    echo "❌ Node.js is not installed. Please install Node >= ${REQUIRED_NODE_VERSION}."
    exit 1
fi

LOWEST_VERSION="$(printf '%s\n' "$REQUIRED_NODE_VERSION" "$CURRENT_NODE_VERSION" | sort -V | head -n 1)"
if [ "$LOWEST_VERSION" != "$REQUIRED_NODE_VERSION" ]; then
    echo "❌ Detected Node ${CURRENT_NODE_VERSION}. This project requires Node >= ${REQUIRED_NODE_VERSION}."
    exit 1
fi

# 检查 node_modules 是否存在
if [ ! -d "node_modules" ]; then
    echo "⚠️  node_modules not found. Installing dependencies..."
    npm install
    echo "✅ Dependencies installed."
fi

npm run dev
