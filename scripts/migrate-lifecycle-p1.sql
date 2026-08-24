-- ============================================================================
-- 用户消息状态机 P1 一次性迁移（lifecycle 列）
--
-- 用途：将旧 messages 表的 submitted_at / queue_state 列替换为
--       lifecycle / lifecycle_at 列（SQLite 无法 DROP COLUMN，采用表重建法）。
--       表结构与索引名以 packages/hub/src/store/index.ts 的 createSchema 为准。
--
-- 用法：sqlite3 ~/.mobi/mobi.db < scripts/migrate-lifecycle-p1.sql
--       （deploy 前对现有库手动执行；执行前建议先停服并备份 db 文件）
--
-- 执行时机：deploy 前一次性执行。项目未上线，不写代码内 migration。
--
-- 状态映射：
--   queue_state = 'pending'
--     → lifecycle = 'queued'，  lifecycle_at = created_at
--   queue_state = 'consumed' 且 metadata.nativeAckAt 非空
--     → lifecycle = 'acked'，   lifecycle_at = nativeAckAt
--   queue_state = 'consumed'（无 nativeAckAt）
--     → lifecycle = 'pushed'，  lifecycle_at = COALESCE(submitted_at, created_at)
--   其他（NULL 等）
--     → lifecycle = NULL，      lifecycle_at = NULL
--
-- ⚠️ 严禁重复执行：成功后再跑会静默清空 messages 表（.bail on 已拦截，见下）。
--    若上次执行中途失败留下 messages_new，先手工 DROP TABLE messages_new 再重跑。
-- ============================================================================

-- 错误即中止（sqlite3 CLI 默认 .bail off 会继续执行导致静默清空）：
-- INSERT 报错时中止脚本，未 COMMIT 的事务随连接关闭回滚
.bail on

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE messages_new (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    local_id TEXT,
    -- native_id 物化列（STORED 生成列）：值恒等于 metadata.nativeId，供按锚点查询的索引。
    -- 部署前旧库的普通 TEXT 列（Phase 1 遗留）由人工 SQL DROP 后重建为本生成列
    native_id TEXT GENERATED ALWAYS AS (json_extract(metadata, '$.nativeId')) STORED,
    metadata TEXT,
    deleted_at INTEGER,
    is_sidechain INTEGER NOT NULL DEFAULT 0,
    parent_tool_use_id TEXT,
    category TEXT NOT NULL DEFAULT 'persistent',
    lifecycle TEXT,
    lifecycle_at INTEGER,
    position_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- 注意：显式列清单排除 native_id（STORED 生成列不可 INSERT，由 metadata 派生）
INSERT INTO messages_new (
    id,
    session_id,
    content,
    created_at,
    seq,
    local_id,
    metadata,
    deleted_at,
    is_sidechain,
    parent_tool_use_id,
    category,
    lifecycle,
    lifecycle_at,
    position_at
)
SELECT
    id,
    session_id,
    content,
    created_at,
    seq,
    local_id,
    metadata,
    deleted_at,
    is_sidechain,
    parent_tool_use_id,
    category,
    CASE
        WHEN queue_state = 'pending' THEN 'queued'
        WHEN queue_state = 'consumed' AND json_extract(COALESCE(metadata, '{}'), '$.nativeAckAt') IS NOT NULL THEN 'acked'
        WHEN queue_state = 'consumed' THEN 'pushed'
        ELSE NULL
    END,
    CASE
        WHEN queue_state = 'pending' THEN created_at
        WHEN queue_state = 'consumed' THEN COALESCE(
            json_extract(COALESCE(metadata, '{}'), '$.nativeAckAt'), submitted_at, created_at)
        ELSE NULL
    END,
    position_at
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

-- 重建 createSchema 中 messages 的全部索引（名字/谓词与代码一致）
CREATE INDEX idx_messages_session ON messages(session_id, seq);
CREATE INDEX idx_messages_session_main ON messages(session_id, seq, is_sidechain);
CREATE INDEX idx_messages_parent_tool ON messages(parent_tool_use_id);
CREATE UNIQUE INDEX idx_messages_local_id ON messages(session_id, local_id) WHERE local_id IS NOT NULL;
CREATE INDEX idx_messages_native_id ON messages(session_id, native_id) WHERE native_id IS NOT NULL;
CREATE INDEX idx_messages_session_position
    ON messages(session_id, position_at DESC, seq DESC);
CREATE INDEX idx_messages_session_queued
    ON messages(session_id) WHERE lifecycle = 'queued';

COMMIT;

PRAGMA foreign_keys = ON;
