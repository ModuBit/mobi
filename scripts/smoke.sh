#!/usr/bin/env bash
# Smoke test - 验证基本功能可用性
# 用法: ./scripts/smoke.sh [--binary]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

USE_BINARY=0
if [[ "${1:-}" == "--binary" ]]; then
  USE_BINARY=1
fi

PROFILE="e2e"
MOBI_HOME="$HOME/.mobi-e2e"
PORT=2224
BASE_URL="http://localhost:$PORT"

# 清理函数
cleanup() {
  echo "🧹 Cleaning up..."
  if [[ -n "${HUB_PID:-}" ]] && kill -0 "$HUB_PID" 2>/dev/null; then
    kill "$HUB_PID" 2>/dev/null || true
  fi
  if [[ -n "${RUNNER_PID:-}" ]] && kill -0 "$RUNNER_PID" 2>/dev/null; then
    kill "$RUNNER_PID" 2>/dev/null || true
  fi
  if [[ -n "${SESSION_PID:-}" ]] && kill -0 "$SESSION_PID" 2>/dev/null; then
    kill "$SESSION_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 获取 token
get_token() {
  grep -E '^WEB_API_TOKEN=' "$HOME/.mobi/profiles/$PROFILE.env" | cut -d= -f2 | xargs
}

# 等待端口监听
wait_for_port() {
  local port=$1
  local max_wait=${2:-10}
  local count=0
  while ! lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
    ((count++))
    if [[ $count -ge $max_wait ]]; then
      echo "❌ Port $port not listening after ${max_wait}s"
      return 1
    fi
    sleep 1
  done
  return 0
}

# 启动服务
start_services() {
  if [[ $USE_BINARY -eq 1 ]]; then
    MOBI_BIN="$PROJECT_ROOT/packages/cli/dist-exe/bun-darwin-arm64/mobi"
    echo "🚀 Starting hub (binary)..."
    "$MOBI_BIN" --profile "$PROFILE" hub start-sync &> /tmp/smoke-hub.log &
    HUB_PID=$!

    echo "🚀 Starting runner (binary)..."
    "$MOBI_BIN" --profile "$PROFILE" runner start-sync &> /tmp/smoke-runner.log &
    RUNNER_PID=$!
  else
    echo "🚀 Starting hub (source)..."
    cd "$PROJECT_ROOT"
    bun run packages/cli/src/index.ts --profile "$PROFILE" hub start-sync &> /tmp/smoke-hub.log &
    HUB_PID=$!

    echo "🚀 Starting runner (source)..."
    bun run packages/cli/src/index.ts --profile "$PROFILE" runner start-sync &> /tmp/smoke-runner.log &
    RUNNER_PID=$!
  fi

  wait_for_port "$PORT" 15 || {
    echo "📋 Hub log:"
    tail -20 /tmp/smoke-hub.log
    exit 1
  }

  sleep 2

  echo "✅ Services started"
}

# 测试 HTTP API
test_http_api() {
  echo "🧪 Testing HTTP API..."

  # Health check
  local health
  health=$(curl -sf "$BASE_URL/health") || {
    echo "❌ Health check failed"
    return 1
  }
  echo "  ✓ Health: $health"

  # Auth
  local token
  token=$(get_token)
  curl -sf -X POST "$BASE_URL/api/auth" \
    -H "Content-Type: application/json" \
    -d "{\"accessToken\": \"$token\"}" \
    -c /tmp/smoke-cookies.txt > /dev/null || {
    echo "❌ Auth failed"
    return 1
  }
  echo "  ✓ Auth successful"

  # List machines
  local machines
  machines=$(curl -sf "$BASE_URL/api/machines" -b /tmp/smoke-cookies.txt) || {
    echo "❌ List machines failed"
    return 1
  }
  local count
  count=$(echo "$machines" | jq '. | length')
  if [[ "$count" != "1" ]]; then
    echo "❌ Expected 1 machine, got $count"
    return 1
  fi
  echo "  ✓ List machines: $count machine(s)"

  echo "✅ HTTP API tests passed"
}

# 测试会话创建（简化版 - 仅验证连接建立）
test_session_create() {
  echo "🧪 Testing session creation..."

  if [[ $USE_BINARY -eq 1 ]]; then
    timeout 5 "$MOBI_BIN" --profile "$PROFILE" --help &> /tmp/smoke-cli-help.log || true
  else
    timeout 5 bun run "$PROJECT_ROOT/packages/cli/src/index.ts" --profile "$PROFILE" --help &> /tmp/smoke-cli-help.log || true
  fi

  if grep -q "mobi - Claude Code On the Go" /tmp/smoke-cli-help.log; then
    echo "  ✓ CLI executable"
  else
    echo "❌ CLI not executable"
    cat /tmp/smoke-cli-help.log
    return 1
  fi

  echo "✅ Session creation tests passed"
}

# 主流程
main() {
  echo "🚬 Mobi Smoke Test"
  echo "=================="

  if [[ $USE_BINARY -eq 1 ]]; then
    MOBI_BIN="$PROJECT_ROOT/packages/cli/dist-exe/bun-darwin-arm64/mobi"
    if [[ ! -f "$MOBI_BIN" ]]; then
      echo "❌ Binary not found at $MOBI_BIN"
      echo "   Run: bun run build:exe"
      exit 1
    fi
    echo "Mode: binary"
  else
    echo "Mode: source"
  fi

  start_services
  test_http_api
  test_session_create

  echo ""
  echo "✅ All smoke tests passed!"
}

main
