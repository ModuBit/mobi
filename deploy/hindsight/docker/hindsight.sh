#!/usr/bin/env bash
# hindsight 自部署管理脚本：start / stop / restart / status / logs / pull / backup
set -euo pipefail
cd "$(dirname "$0")"

API="http://localhost:8888"
HEALTH="$API/health"
DATA_DIR="$HOME/.hindsight/data"     # 容器 bind mount 的数据目录（与 docker-compose.yaml 保持一致）
BACKUP_DIR="$HOME/.hindsight/backups"

health() { curl -sf -o /dev/null "$HEALTH"; }

wait_ready() {
    # 首次启动要下载本地 embedding/reranker 模型（走 HF mirror，数百 MB），上限给足 30 分钟
    local timeout=${1:-1800} i=0
    printf '等待 API 就绪（最长 %ss）…\n' "$timeout"
    until health; do
        i=$((i + 5))
        if [ "$i" -ge "$timeout" ]; then
            echo "超时未就绪，看日志：$0 logs" >&2
            docker compose logs --tail 50 hindsight >&2 || true
            exit 1
        fi
        sleep 5
    done
    echo "API 就绪：$HEALTH"
    echo "控制台：http://localhost:9999（密钥见 .env 的 HINDSIGHT_CP_ACCESS_KEY）"
}

env_value() {
    # 读取 .env 中某变量最后一个生效值（未注释行）
    grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-
}

check_env() {
    # 按 .env 实际启用的 provider 检查必填项——云/本地方案切换无需改本脚本
    [ -f .env ] || { echo "⚠️  没有 .env，先 cp .env.example .env" >&2; exit 1; }

    # 任何生效行还带着模板占位（你的 xxx-key / 改成随机长串）都不放行
    if grep -qE '^[A-Z_]+=.*(你的|改成随机长串)' .env 2>/dev/null; then
        echo "⚠️  .env 还有未填项（key / 访问密钥），先编辑 .env" >&2
        exit 1
    fi

    local missing=() provider var provider_upper
    # LLM key 所有 provider 共用同一个变量名
    [ -n "$(env_value HINDSIGHT_API_LLM_API_KEY)" ] || missing+=("HINDSIGHT_API_LLM_API_KEY")
    # embeddings/reranker：local 不需要 key，云上方案要求 <段>_<PROVIDER>_API_KEY
    for section in EMBEDDINGS RERANKER; do
        provider=$(env_value "HINDSIGHT_API_${section}_PROVIDER")
        [ -n "$provider" ] && [ "$provider" != local ] || continue
        # 不用 bash4 的 ${var^^}：兼容 macOS 系统 bash 3.2
        provider_upper=$(printf '%s' "$provider" | tr '[:lower:]' '[:upper:]')
        var="HINDSIGHT_API_${section}_${provider_upper}_API_KEY"
        [ -n "$(env_value "$var")" ] || missing+=("$var")
    done

    [ ${#missing[@]} -eq 0 ] || {
        echo "⚠️  .env 缺少必填项：${missing[*]}（按当前启用的 provider）" >&2
        exit 1
    }
}

# ── 数据迁移（换 embedding 模型的无损重建）──
# 原理：document-transfer 导出 ZIP（刻意不含向量）→ 清库按新模型重建 schema →
#       导入时重放 retain 管线、按当前模型重嵌入（源码实证：不调 LLM、不重新提取）
# 注意：维度是全表列类型，删 bank 改不了它——必须清整个数据目录；
#       import 会按 zip 文件名自动重建同名 bank，bank id 保持不变
API_KEY=""

require_api() {
    [ -n "$API_KEY" ] || API_KEY=$(env_value HINDSIGHT_API_TENANT_API_KEY)
    [ -n "$API_KEY" ] || { echo "⚠️  .env 缺少 HINDSIGHT_API_TENANT_API_KEY" >&2; exit 1; }
    health || { echo "⚠️  API 未就绪，先 $0 start" >&2; exit 1; }
}

api() { curl -sfS -H "Authorization: Bearer $API_KEY" "$@"; }

json_get() { # 从 stdin 的 JSON 按点分路径取值，取不到输出空串
    python3 -c '
import json, sys
cur = json.load(sys.stdin)
for k in sys.argv[1].split("."):
    cur = cur.get(k) if isinstance(cur, dict) else None
    if cur is None:
        break
print(cur if cur is not None else "")' "$1"
}

list_bank_ids() {
    api "$API/v1/default/banks" | python3 -c '
import json, sys
d = json.load(sys.stdin)
items = d.get("items") or d.get("banks") or (d if isinstance(d, list) else [])
print("\n".join(b["id"] for b in items if isinstance(b, dict) and b.get("id")))'
}

wait_op() { # $1=bank_id $2=operation_id：轮询直到完成，最终 JSON 存 LAST_OP_JSON
    local i=0 status
    while :; do
        LAST_OP_JSON=$(api "$API/v1/default/banks/$1/operations/$2")
        status=$(printf '%s' "$LAST_OP_JSON" | json_get status)
        case "$status" in
        completed) return 0 ;;
        failed | canceled | cancelled)
            echo "⚠️  操作失败（$status）：$2" >&2
            printf '%s\n' "$LAST_OP_JSON" >&2
            return 1 ;;
        esac
        i=$((i + 3))
        [ "$i" -lt 600 ] || { echo "⚠️  操作超时：$2" >&2; return 1; }
        sleep 3
    done
}

export_all() { # $1=输出目录：导出全部 bank 的 transfer archive（含 observations/知识页）
    local ids id op url out="$1"
    mkdir -p "$out"
    ids=$(list_bank_ids)
    [ -n "$ids" ] || { echo "没有 bank，无需导出" >&2; return 1; }
    echo "发现 bank：$(echo "$ids" | tr '\n' ' ')"
    for id in $ids; do
        echo "导出 $id …"
        op=$(api -X POST "$API/v1/default/banks/$id/document-transfer/export?include_observations=true&include_knowledge_base=true" | json_get operation_id)
        wait_op "$id" "$op" || return 1
        url=$(printf '%s' "$LAST_OP_JSON" | json_get result_metadata.download_url)
        case "$url" in /*) url="$API$url" ;; esac
        api "$url" -o "$out/$id.zip" || return 1
        echo "  → $out/$id.zip（$(du -h "$out/$id.zip" | cut -f1)）"
    done
}

import_all() { # $1=archive 目录：逐个导入（bank 按 zip 文件名自动重建）
    local dir="$1" zip id op
    for zip in "$dir"/*.zip; do
        [ -e "$zip" ] || { echo "⚠️  $dir 下没有 archive" >&2; return 1; }
        id=$(basename "$zip" .zip)
        echo "导入 $id …"
        op=$(api -X POST -F "file=@$zip" \
            "$API/v1/default/banks/$id/document-transfer?on_conflict=skip" | json_get operation_id)
        wait_op "$id" "$op" || return 1
    done
}

latest_transfer_dir() {
    ls -d "$BACKUP_DIR"/transfer-* 2>/dev/null | sort | tail -1
}

case "${1:-status}" in
start)
    check_env
    docker compose up -d
    wait_ready
    ;;
stop)
    # down 只删容器，宿主 $DATA_DIR 保留，数据不丢
    docker compose down
    echo "已停止（数据目录 $DATA_DIR 保留）"
    ;;
restart)
    check_env
    docker compose down
    docker compose up -d
    wait_ready 180
    ;;
status)
    docker compose ps
    if health; then
        echo "API: ✅ $HEALTH"
    else
        echo "API: ❌ 无响应（容器未起或还在初始化，看 $0 logs）"
    fi
    if [ -d "$DATA_DIR" ] && [ -n "$(ls -A "$DATA_DIR" 2>/dev/null)" ]; then
        echo "数据目录: $DATA_DIR ($(du -sh "$DATA_DIR" | cut -f1))"
    else
        echo "数据目录: $DATA_DIR 为空（从未启动过）"
    fi
    ;;
logs)    docker compose logs -f --tail 200 hindsight
    ;;
pull)
    docker compose pull
    docker compose up -d
    wait_ready 180
    ;;
backup)
    # 热备份：PG 在 WAL 模式下直接拷可能不一致，稳妥起见先停再备，备完恢复原状态
    mkdir -p "$BACKUP_DIR"
    was_running=$(docker compose ps -q hindsight | grep -q . && echo yes || echo no)
    [ "$was_running" = yes ] && docker compose stop >/dev/null
    tar czf "$BACKUP_DIR/hindsight-data-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$DATA_DIR" .
    [ "$was_running" = yes ] && docker compose start >/dev/null
    echo "备份完成：$BACKUP_DIR/"
    ;;
banks)
    require_api
    list_bank_ids
    ;;
export)
    # 原子步骤①：导出全部 bank 到 $BACKUP_DIR/transfer-<时间戳>/
    require_api
    dir="$BACKUP_DIR/transfer-$(date +%Y%m%d-%H%M%S)"
    export_all "$dir" && echo "导出完成：$dir"
    ;;
import)
    # 原子步骤②：导入 archive 目录（默认最近一次 export），bank 自动按原 id 重建
    require_api
    dir=${2:-$(latest_transfer_dir)}
    if [ -z "$dir" ] || [ ! -d "$dir" ]; then
        echo "用法：$0 import [archive目录]（默认最近一次 export 的目录）" >&2
        exit 1
    fi
    import_all "$dir" && echo "导入完成：$dir"
    ;;
reembed)
    # 一键无损重建：换 embedding 模型后跑一次（先改好 .env 再执行）
    check_env
    require_api
    echo "该操作将：导出全部 bank → 停服并把 $DATA_DIR 挪走 → 按当前 .env 空库启动（新 embedding 维度）→ 导入重嵌入"
    echo "⚠️  导入前 mobi 侧 recall 不可用；耗时取决于记忆量和 embedding 提供商"
    printf '确认继续？(y/N) '
    read -r answer
    [ "$answer" = y ] || exit 1
    dir="$BACKUP_DIR/transfer-$(date +%Y%m%d-%H%M%S)"
    export_all "$dir" || exit 1
    docker compose stop
    mv "$DATA_DIR" "$DATA_DIR.bak-$(date +%Y%m%d-%H%M%S)"
    docker compose up -d
    wait_ready 600
    if ! import_all "$dir"; then
        echo "⚠️  导入失败：旧数据保留在 $DATA_DIR.bak-*，回滚 = stop 后 mv 回 $DATA_DIR 再 start" >&2
        exit 1
    fi
    echo "重建完成（bank id 不变）。recall 验证正常后可删除 $DATA_DIR.bak-* 与 $dir"
    ;;
*)
    echo "用法：$0 {start|stop|restart|status|logs|pull|backup|banks|export|import|reembed}"
    exit 1
    ;;
esac
