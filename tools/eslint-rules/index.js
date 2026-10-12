/**
 * ESLint 自定义规则入口
 *
 * 注册所有本地自定义规则，供 eslint.config.js 使用
 */
'use strict'

const noInternalImport = require('./no-internal-import')
const enforceLicenseHeader = require('./enforce-license-header')
const filenameMatchesExport = require('./filename-matches-export')

const plugin = {
  meta: {
    name: 'mobi-eslint-rules',
    version: '0.1.0',
  },
  rules: {
    'no-internal-import': noInternalImport,
    'enforce-license-header': enforceLicenseHeader,
    'filename-matches-export': filenameMatchesExport,
  },
}

module.exports = plugin
