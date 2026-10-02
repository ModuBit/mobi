/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    /* ===== 循环依赖 ===== */
    // P3 已消除全部 12 条循环依赖（hub/sync 5 + cli/claude 7），severity 恢复 error 硬卡防回潮
    {
      name: 'no-circular',
      comment: '禁止循环依赖',
      severity: 'error',
      from: {},
      to: {
        circular: true,
      },
    },

    /* ===== shared: 不依赖 hub/cli/web ===== */
    {
      name: 'shared-no-upstream',
      comment: 'shared 是最底层包，不允许依赖 hub/cli/web',
      severity: 'error',
      from: {
        path: '^packages/shared/src/',
      },
      to: {
        path: '^packages/(hub|cli|web)/src/',
        pathNot: 'node_modules',
      },
    },

    /* ===== hub 规则已随 ticket-12 移除（hub 并入 daemon） ===== */

    /* ===== cli: 不依赖 web ===== */
    // hub 已并入 daemon（ticket-12），cli 对 daemon 走包名 @mobi/daemon（node_modules 边不可见）
    {
      name: 'cli-only-shared',
      comment: 'cli 不允许依赖 web（daemon/node-core/session 走包名依赖）',
      severity: 'warn',
      from: {
        path: '^packages/cli/src/',
      },
      to: {
        path: '^packages/web/src/',
        pathNot: 'node_modules',
      },
    },

    /* ===== 新包（personal-agent-rewrite ③）：依赖方向 04 §6 ===== */
    // node-core → shared only
    {
      name: 'node-core-only-shared',
      comment: 'node-core 只能依赖 shared，不允许依赖 daemon/session/hub/cli/web',
      severity: 'error',
      from: {
        path: '^packages/node-core/src/',
      },
      to: {
        path: '^packages/(daemon|session|hub|cli|web)/src/',
        pathNot: 'node_modules',
      },
    },
    // daemon → node-core + shared（与 session 互相禁止）
    {
      name: 'daemon-only-nodecore-shared',
      comment: 'daemon 只能依赖 node-core/shared，不允许依赖 session/hub/cli/web（daemon ⟂ session）',
      severity: 'error',
      from: {
        path: '^packages/daemon/src/',
      },
      to: {
        path: '^packages/(session|hub|cli|web)/src/',
        pathNot: 'node_modules',
      },
    },
    // session → node-core + shared（与 daemon 互相禁止）
    {
      name: 'session-only-nodecore-shared',
      comment: 'session 只能依赖 node-core/shared，不允许依赖 daemon/hub/cli/web（daemon ⟂ session）',
      severity: 'error',
      from: {
        path: '^packages/session/src/',
      },
      to: {
        path: '^packages/(daemon|hub|cli|web)/src/',
        pathNot: 'node_modules',
      },
    },

    /* ===== 禁止引用其他包的内部 src/ 路径 ===== */
    {
      name: 'no-internal-src-import',
      comment: '禁止引用其他包的 src/ 内部路径，应使用包公共入口',
      severity: 'error',
      from: {},
      to: {
        path: '@mobi/.+/src/',
      },
    },

    /* ===== web: 只依赖 shared ===== */
    {
      name: 'web-only-shared',
      comment: 'web 只能依赖 shared，不允许依赖 hub/cli',
      severity: 'error',
      from: {
        path: '^packages/web/src/',
      },
      to: {
        path: '^packages/(daemon|cli)/src/',
        pathNot: 'node_modules',
      },
    },

    /* ===== SnapshotSync 模块边界 ===== */
    // 快照同步 module 只决定快照内容（衔接判定/游标/缓存），历史回放由 adapter 层查 DB 后
    // 喂进来、网络发送归 socket/sse adapter、观测只记录不聚合——越界即腐化起点，CI 硬卡
    {
      name: 'snapshot-sync-boundary',
      comment: 'SnapshotSync 不触 store（DB）/ sse / socket——投递与持久化归 adapter 层，module 纯状态机',
      severity: 'error',
      from: {
        path: '^packages/daemon/src/sync/snapshotSync\\.ts$',
      },
      to: {
        path: '^packages/daemon/src/(store|sse|socket)/',
      },
    },
  ],

  options: {
    // monorepo 基础路径
    baseDir: '.',
    // 使用 tsconfig 解析路径
    tsPreCompilationDeps: true,
    // 验证依赖的模块是否确实存在
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      // dist 是 gitignored 的构建产物（如 packages/web/dist），不应纳入依赖巡检
      path: '(node_modules|dist)',
    },
  },
}
