/**
 * web 包专用 depcruise 配置（src 分层治理票 01）。
 *
 * 与根 .dependency-cruiser.js 的差异：
 * 1. 由 lint:deps 以 `--ts-config tsconfig.depcruise.json`（仓库根）配套运行——
 *    解析 web 的 '@/' paths alias。此前 '@/' 边 unresolved，包内依赖图是断的
 *    （循环检测/分层规则对 @-import 全部失明）。
 * 2. no-circular 降为 warn：alias 解析后显形 22 条存量循环（tool-card/views 内部
 *    13+6 条、chat↔tool-card 三角 3 条）——src-governance 票 03 的裁决对象，
 *    清零后恢复 error（根配置其余包保持 error 硬卡）。
 *
 * forbidden 规则集 require 根配置复用（新增规则只改根文件，防两份漂移）；
 * 仅对 no-circular 做 severity 覆盖。
 */
const base = require('./.dependency-cruiser.js')

module.exports = {
  forbidden: base.forbidden.map((rule) =>
    rule.name === 'no-circular'
      ? { ...rule, severity: 'warn', comment: 'web 存量循环（tool-card 内部 + chat↔tool-card 三角）票 03 逐边清零后恢复 error' }
      : rule,
  ),
  options: base.options,
}
