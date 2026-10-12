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

  // 同一语义组件禁止在多个 registry 目录重复实现（shadcn 底座票 04，
  // 规范见 docs/conventions/web.md「组件选型」章），只作用于 registry 目录内文件
  {
    files: [
      'packages/web/src/ui/shadcn/**/*.{ts,tsx}',
      'packages/web/src/ui/arc/**/*.{ts,tsx}',
    ],
    plugins: {
      'mobi': customRules,
    },
    rules: {
      'mobi/no-duplicate-registry-component': 'error',
    },
  },

  // registry 后端依赖门禁（shadcn 底座票 04）：shadcn 生态的原语后端包只允许被
  // 组件源码目录消费，业务代码直接 import → error。白名单目录尚不存在时规则
  // 同样成立（= 完全禁止），首个组件 add 进目录后自动获得豁免。
  // 新增后端家族（如 @ark-ui/*）时扩充 group。
  {
    files: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx'],
    ignores: ['packages/web/src/ui/shadcn/**', 'packages/web/src/ui/arc/**'],
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
          message: 'shadcn registry 后端包只能被 src/ui/shadcn/ 或 src/ui/arc/ 消费（组件选型规范见 docs/conventions/web.md「组件选型」章）',
        }],
      }],
    },
  },
)
