-- ============================================================================
-- 「项目」→「工作区」更名 SQL（仅适用于已按「项目」命名实体化的库）
--
-- 前置：停掉 hub / runner 进程，避免 WAL 与写竞争。
-- 用法：sqlite3 ~/.mobi-dev/mobi.db < scripts/rename-projects-to-workspaces.sql
--       sqlite3 ~/.mobi/mobi.db      < scripts/rename-projects-to-workspaces.sql
--
-- 适用判别：sqlite_master 里有 projects 表、sessions 有 project_id 列。
-- 若库还是更老的 group_key schema（无 projects 表），请改跑
--   bun scripts/migrate-workspaces.ts
-- （它兼容三种存量形态：group_key / project 命名 / 已是 workspace，且自带备份与回填）
--
-- 注意：
-- - ALTER TABLE ... RENAME 不会连带改索引名，旧索引需删除后按新名重建
-- - 幂等性：本脚本不可重复执行（RENAME 二次执行会报错），重跑请用 migrate-workspaces.ts
-- ============================================================================

-- 1. 表改名（数据原样保留）
ALTER TABLE projects RENAME TO workspaces;

-- 2. 旧命名索引清理（先删后建，避免与新建重名冲突）
DROP INDEX IF EXISTS idx_projects_namespace;
DROP INDEX IF EXISTS idx_projects_machine;
DROP INDEX IF EXISTS idx_sessions_project;

-- 3. 列改名
ALTER TABLE sessions RENAME COLUMN project_id TO workspace_id;

-- 4. 按新名重建索引（与 packages/daemon/src/store/index.ts createSchema 逐条一致）
CREATE INDEX IF NOT EXISTS idx_workspaces_namespace ON workspaces(namespace);
CREATE INDEX IF NOT EXISTS idx_workspaces_machine ON workspaces(machine_id);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);
