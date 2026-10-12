/**
 * web 包专用 depcruise 配置（src 分层治理票 01/02）。
 *
 * 与根 .dependency-cruiser.js 的差异：
 * 1. 由 lint:deps 以 `--ts-config tsconfig.depcruise.json`（仓库根）配套运行——
 *    解析 web 的 '@/' paths alias。此前 '@/' 边 unresolved，包内依赖图是断的
 *    （循环检测/分层规则对 @-import 全部失明）。
 * 2. no-circular 降为 warn：alias 解析后显形 22 条存量循环（tool-card/views 内部
 *    13+6 条、chat↔tool-card 三角 3 条）——src-governance 票 03 的裁决对象，
 *    清零后恢复 error（根配置其余包保持 error 硬卡）。
 * 3. web-ui-no-upward 豁免 ArtifactDirectiveComponents：mobi 指令渲染链
 *    （Markdown → 指令组件 → artifact inline views）的解耦需 Markdown 组件
 *    注入化接口设计，属票 03 逐边裁决（豁免仅此一处，裁决后删除）。
 * 4. 新增 features 域间隔离规则（readdir 动态生成 per-feature）：
 *    depcruise 正则不支持捕获组回引，无法用单条规则表达「features/X 不得引
 *    features/其他」。存量跨域边的 from 文件列入 EXEMPT（票号注释），
 *    票 03 逐边清零后删豁免、裸上锁防新增边。
 *
 * forbidden 规则集 require 根配置复用（新增规则只改根文件，防两份漂移）；
 * 仅对 no-circular 做 severity 覆盖、web-ui-no-upward 做豁免覆盖。
 */
const fs = require('fs')
const path = require('path')
const base = require('./.dependency-cruiser.js')

/* ===== features 域间隔离（票 02 上锁；豁免 = 票 03 裁决中的存量边）===== */
/**
 * 存量跨域边豁免清单（票 03 裁决中，清零后删除）。
 * 列表 = from 文件（实际跨域引用的发起方），按域分组；
 * 票 03 逐边四选一裁决（下沉 domain / 下沉 ui / 改 props / 并域）后逐文件移除。
 */
const FEATURE_ISOLATION_EXEMPT = [
  /* ===== chat（8 文件：blocks 系引 tool-card/turnDiff/review，容器引 workspace/composer）===== */
  '^packages/web/src/features/chat/AgentLoadingBubble\\.tsx$',
  '^packages/web/src/features/chat/artifact/ArtifactInlineViews\\.tsx$',
  '^packages/web/src/features/chat/blocks/CompactSummaryBlock\\.tsx$',
  '^packages/web/src/features/chat/blocks/ReasoningBlock\\.tsx$',
  '^packages/web/src/features/chat/blocks/ToolCallBlock\\.tsx$',
  '^packages/web/src/features/chat/blocks/ToolCallGroupBlock\\.tsx$',
  '^packages/web/src/features/chat/blocks/TurnDiffCard\\.tsx$',
  '^packages/web/src/features/chat/ChatContainer\\.tsx$',
  '^packages/web/src/features/chat/GoalBadge\\.tsx$',
  '^packages/web/src/features/chat/StatusBar\\.tsx$',
  /* ===== composer（3 文件：引 chat）===== */
  '^packages/web/src/features/composer/ChatComposer\\.tsx$',
  '^packages/web/src/features/composer/ComposerInfoPanel\\.tsx$',
  '^packages/web/src/features/composer/QuoteChipBar\\.tsx$',
  /* ===== layout（2 文件：引 workspace）===== */
  '^packages/web/src/features/layout/MobileWorkspaceList\\.tsx$',
  '^packages/web/src/features/layout/SidebarWorkspaces\\.tsx$',
  /* ===== login（1 文件：引 workspace）===== */
  '^packages/web/src/features/login/BootLogPanel\\.tsx$',
  /* ===== review（2 文件：引 tool-card）===== */
  '^packages/web/src/features/review/DiffTreePanel\\.tsx$',
  '^packages/web/src/features/review/GitReviewView\\.tsx$',
  /* ===== session（2 文件：引 chat/review 等）===== */
  '^packages/web/src/features/session/ChatPane\\.tsx$',
  '^packages/web/src/features/session/InspectorPane\\.tsx$',
  /* ===== settings（1 文件：引 workspace）===== */
  '^packages/web/src/features/settings/blocks/PwaCard\\.tsx$',
  /* ===== tool-card（3 文件：引 chat/session）===== */
  '^packages/web/src/features/tool-card/AgentDrawerContent\\.tsx$',
  '^packages/web/src/features/tool-card/PermissionFooter\\.tsx$',
  '^packages/web/src/features/tool-card/views/DiffView\\.tsx$',
  /* ===== workspace（1 文件）===== */
  '^packages/web/src/features/workspace/WorkspaceFormModal\\.tsx$',
]

const featuresDir = path.resolve(__dirname, 'packages/web/src/features')
const featureRules = fs.existsSync(featuresDir)
  ? fs.readdirSync(featuresDir).flatMap((feature) => [
      {
        name: `web-feature-isolated-${feature}`,
        comment: 'features 域间互引禁止（分层治理票 02；多域共享知识下沉 domain/ui，豁免清单为票 03 裁决中的存量边）',
        severity: 'error',
        from: {
          path: `^packages/web/src/features/${feature}/`,
          pathNot: FEATURE_ISOLATION_EXEMPT,
        },
        to: {
          path: '^packages/web/src/features/',
          pathNot: `^packages/web/src/features/${feature}/`,
        },
      },
    ])
  : []

module.exports = {
  forbidden: [
    ...base.forbidden.map((rule) => {
      if (rule.name === 'no-circular') {
        return {
          ...rule,
          severity: 'warn',
          comment: 'web 存量循环（tool-card 内部 + chat↔tool-card 三角）票 03 逐边清零后恢复 error',
        }
      }
      if (rule.name === 'web-ui-no-upward') {
        return {
          ...rule,
          from: {
            ...rule.from,
            // mobi 指令渲染链（票 03 裁决中）：Markdown(通用) → 指令组件 → chat/artifact
            pathNot: '^packages/web/src/ui/ArtifactDirectiveComponents\\.tsx$',
          },
        }
      }
      return rule
    }),
    ...featureRules,
  ],
  options: base.options,
}
