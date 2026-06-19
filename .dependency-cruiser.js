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
        path: '^packages/shared/src/',
      },
      to: {
        path: '^packages/(hub|cli|web)/src/',
        pathNot: 'node_modules',
      },
    },

    /* ===== hub: 只依赖 shared ===== */
    {
      name: 'hub-only-shared',
      comment: 'hub 只能依赖 shared，不允许依赖 cli/web',
      severity: 'error',
      from: {
        path: '^packages/hub/src/',
      },
      to: {
        path: '^packages/(cli|web)/src/',
        pathNot: 'node_modules',
      },
    },

    /* ===== cli: 只依赖 shared ===== */
    // 有意豁免 hub/src/index.ts：cli 嵌入式启动 hub server（hub.ts 动态 import），
    // 单一二进制架构，非协议依赖；其余 cli→hub/src/* 路径仍违规
    {
      name: 'cli-only-shared',
      comment: 'cli 只能依赖 shared，不允许依赖 hub/web（豁免 hub/src/index.ts：cli 嵌入式启动 hub server，单一二进制架构，非协议依赖）',
      severity: 'warn',
      from: {
        path: '^packages/cli/src/',
      },
      to: {
        path: '^packages/(hub|web)/src/',
        pathNot: ['node_modules', '^packages/hub/src/index\\.ts$'],
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
        path: '^packages/(hub|cli)/src/',
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
