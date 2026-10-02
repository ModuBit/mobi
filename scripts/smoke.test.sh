#!/usr/bin/env bash
# Smoke test 的自动化测试脚本
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🧪 Testing smoke.sh script..."

# 测试 1: source 模式
echo "  Testing source mode..."
if "$SCRIPT_DIR/smoke.sh" > /tmp/smoke-test-source.log 2>&1; then
  echo "    ✓ Source mode passed"
else
  echo "    ❌ Source mode failed"
  cat /tmp/smoke-test-source.log
  exit 1
fi

# 测试 2: binary 模式
echo "  Testing binary mode..."
if "$SCRIPT_DIR/smoke.sh" --binary > /tmp/smoke-test-binary.log 2>&1; then
  echo "    ✓ Binary mode passed"
else
  echo "    ❌ Binary mode failed"
  cat /tmp/smoke-test-binary.log
  exit 1
fi

echo ""
echo "✅ All smoke test validations passed!"
