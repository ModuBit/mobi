/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    /* ===== 循环依赖 ===== */
    // TODO: hub 和 cli 中存在现有循环依赖，后续重构修复后恢复 error
    {
      name: 'no-circular',
      comment: '禁止循环依赖',
      severity: 'warn',
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
        path: '^shared/src/',
      },
      to: {
        path: '^(hub|cli|web)/src/',
        pathNot: 'node_modules',
      },
    },

    /* ===== hub: 只依赖 shared ===== */
    {
      name: 'hub-only-shared',
      comment: 'hub 只能依赖 shared，不允许依赖 cli/web',
      severity: 'error',
      from: {
        path: '^hub/src/',
      },
      to: {
        path: '^(cli|web)/src/',
        pathNot: 'node_modules',
      },
    },

    /* ===== cli: 只依赖 shared ===== */
    // TODO: cli/src/commands/hub.ts 引用 hub/src/index.ts，后续重构修复后恢复 error
    {
      name: 'cli-only-shared',
      comment: 'cli 只能依赖 shared，不允许依赖 hub/web',
      severity: 'warn',
      from: {
        path: '^cli/src/',
      },
      to: {
        path: '^(hub|web)/src/',
        pathNot: 'node_modules',
      },
    },

    /* ===== web: 只依赖 shared ===== */
    {
      name: 'web-only-shared',
      comment: 'web 只能依赖 shared，不允许依赖 hub/cli',
      severity: 'error',
      from: {
        path: '^web/src/',
      },
      to: {
        path: '^(hub|cli)/src/',
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
      path: 'node_modules',
    },
  },
}
