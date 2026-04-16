/**
 * no-internal-import 规则
 *
 * 禁止跨包引用 @mobi/xxx/src/ 内部路径，应使用公共入口 @mobi/xxx
 */
'use strict'

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止跨包引用内部 src/ 路径',
    },
    fixable: null,
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source !== 'string') return

        // 匹配 @mobi/包名/src/... 形式的内部路径导入
        const match = source.match(/^@mobi\/(.+?)\/src\//)
        if (match) {
          context.report({
            node,
            message: `禁止引用 @mobi/${match[1]} 的内部路径 ${source}，请使用公共入口`,
          })
        }
      },
    }
  },
}
