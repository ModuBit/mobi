/**
 * ESLint Flat Config — Mobi Monorepo
 *
 * 加载 @eslint/js 推荐配置、TypeScript 解析器，并注册本地自定义规则插件
 */
const js = require('@eslint/js')
const tseslint = require('typescript-eslint')
const customRules = require('./tools/eslint-rules')

module.exports = tseslint.config(
  // 基础推荐配置
  js.configs.recommended,

  // TypeScript 推荐配置（已包含 TS 解析器）
  ...tseslint.configs.recommended,

  // 全局忽略
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.output/**',
      '**/*.generated.ts',
      '**/*.generated.d.ts',
    ],
  },

  // 自定义规则：作用于 packages/*/src/
  {
    files: ['packages/shared/src/**/*.ts', 'packages/shared/src/**/*.tsx',
            'packages/node-core/src/**/*.ts', 'packages/node-core/src/**/*.tsx',
            'packages/daemon/src/**/*.ts', 'packages/daemon/src/**/*.tsx',
            'packages/session/src/**/*.ts', 'packages/session/src/**/*.tsx',
            'packages/cli/src/**/*.ts', 'packages/cli/src/**/*.tsx',
            'packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx'],
    plugins: {
      'mobi': customRules,
    },
    rules: {
      // 禁止跨包引用内部 src/ 路径 — error 级别
      'mobi/no-internal-import': 'error',

      // 版权头检查 — warn 级别（先警告，不阻塞）
      'mobi/enforce-license-header': 'warn',

      // 已有代码大量触发，暂时降为 warn，后续逐步修复
      // 约定：以 _ 开头的变量/参数/解构视为「有意未用」，不再报警（TS 标准 convention）
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],

      // 允许 any 类型（已有代码中大量使用）
      '@typescript-eslint/no-explicit-any': 'warn',

      // 以下规则已有代码大量触发，暂时降为 warn，后续逐步修复
      'prefer-const': 'warn',
      'no-empty': 'warn',
      'no-prototype-builtins': 'warn',
      'no-control-regex': 'warn',
      'no-useless-escape': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },

  // 文件命名规范（ui 治理票）：文件名须是「某个主导出组件的名字」（组件文件，
  // PascalCase）或 camelCase（模块文件：hook / 工具 / 常量表 / 多组件模块）。
  // 现只挂 web 包（其他包的 class 文件命名分歧留待下一轮统一后接入）。
  // 规范见 docs/conventions/web.md「文件命名」节。
  {
    files: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx'],
    plugins: {
      'mobi': customRules,
    },
    rules: {
      'mobi/filename-matches-export': 'error',
    },
  },

  // registry 后端依赖门禁（shadcn 底座票 04）：shadcn 生态的原语后端包只允许被
  // registry 组件源码消费，业务代码直接 import → error。registry 组件统一落
  // packages/web/src/ui/shadcn/（该目录是组件体系名，非来源名；组件归属见
  // packages/web/registry.json）。2026-10-15 起自管组件迁落 ui/base/（归 base 体系），
  // 门禁随之覆盖 ui/base/**。新增后端家族（如 @ark-ui/*）时扩充 group。
  {
    files: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx'],
    ignores: ['packages/web/src/ui/shadcn/**', 'packages/web/src/ui/base/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '@radix-ui/*',
            'radix-ui',
            '@base-ui/react',
            '@base-ui-components/*',
            '@ark-ui/*',
            '@react-aria/*',
            'react-aria-components',
          ],
          message: 'shadcn registry 后端包只能被 registry 组件源码（packages/web/src/ui/shadcn/ 与自管件 packages/web/src/ui/base/）消费（组件选型规范见 docs/conventions/web.md「组件选型」章）',
        }],
      }],
    },
  },
)
