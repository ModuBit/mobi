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
            'packages/hub/src/**/*.ts', 'packages/hub/src/**/*.tsx',
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
)
