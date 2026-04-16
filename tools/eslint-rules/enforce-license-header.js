/**
 * enforce-license-header 规则
 *
 * 检查 shared/src/、hub/src/、cli/src/、web/src/ 下的 .ts/.tsx 文件
 * 是否包含 Copyright Maner·Fan 版权头
 */
'use strict'

const fs = require('fs')

// 需要检查版权头的目录前缀
const SCOPE_PREFIXES = ['shared/src/', 'hub/src/', 'cli/src/', 'web/src/']

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: '检查源文件是否包含 Copyright Maner·Fan 版权头',
    },
    fixable: null,
    schema: [],
  },
  create(context) {
    // 获取文件相对路径（相对于项目根目录）
    const filePath = context.filename || context.getFilename()
    // 标准化路径分隔符
    const normalizedPath = filePath.replace(/\\/g, '/')

    // 判断文件是否在需要检查的范围内
    const inScope = SCOPE_PREFIXES.some(
      (prefix) =>
        normalizedPath.includes('/' + prefix) ||
        normalizedPath.startsWith(prefix),
    )

    if (!inScope) return {}

    // 只检查 .ts 和 .tsx 文件
    if (!/\.[jt]sx?$/.test(filePath)) return {}

    return {
      Program(node) {
        try {
          const content = fs.readFileSync(filePath, 'utf8')
          // 检查文件前 500 字符是否包含版权声明
          const header = content.substring(0, 500)
          if (!header.includes('Copyright Maner·Fan')) {
            context.report({
              node,
              message: '文件缺少 Copyright Maner·Fan 版权头',
            })
          }
        } catch {
          // 文件读取失败时不报告，避免干扰
        }
      },
    }
  },
}
