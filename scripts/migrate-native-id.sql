-- Rewind Phase 1 一次性迁移：messages 表加 native_id 列（SCHEMA_VERSION 1 → 2）
--
-- 适用：存量 ~/.mobi/mobi.db（user_version=1）。新装库由 createSchema 直接建出该列，无需本脚本。
-- 执行方式（先停 hub/runner，备份后）：
--   sqlite3 ~/.mobi/mobi.db < scripts/migrate-native-id.sql
-- 验证：
--   sqlite3 ~/.mobi/mobi.db "PRAGMA user_version;"          -- 应输出 2
--   sqlite3 ~/.mobi/mobi.db "PRAGMA table_info(messages);"  -- 应含 native_id

ALTER TABLE messages ADD COLUMN native_id TEXT;
PRAGMA user_version = 2;
