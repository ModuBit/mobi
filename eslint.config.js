/**
 * ESLint Flat Config — Mobi Monorepo
 *
 * 加载 @eslint/js 推荐配置、TypeScript 解析器，并注册本地自定义规则插件
 */
const js = require('@eslint/js')
const tseslint = require('typescript-eslint')
const customRules = require('./eslint-rules')

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
    ],
  },

  // 自定义规则：作用于 shared/src/ hub/src/ cli/src/ web/src/
  {
    files: ['shared/src/**/*.ts', 'shared/src/**/*.tsx',
            'hub/src/**/*.ts', 'hub/src/**/*.tsx',
            'cli/src/**/*.ts', 'cli/src/**/*.tsx',
            'web/src/**/*.ts', 'web/src/**/*.tsx'],
    plugins: {
      'mobi': customRules,
    },
    rules: {
      // 禁止跨包引用内部 src/ 路径 — error 级别
      'mobi/no-internal-import': 'error',

      // 版权头检查 — warn 级别（先警告，不阻塞）
      'mobi/enforce-license-header': 'warn',

      // 已有代码大量触发，暂时降为 warn，后续逐步修复
      '@typescript-eslint/no-unused-vars': 'warn',

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
)
