/**
 * web 包专用 depcruise 配置（src 分层治理票 01/02）。
 *
 * 与根 .dependency-cruiser.js 的差异：
 * 1. 由 lint:deps 以 `--ts-config tsconfig.depcruise.json`（仓库根）配套运行——
 *    解析 web 的 '@/' paths alias。此前 '@/' 边 unresolved，包内依赖图是断的
 *    （循环检测/分层规则对 @-import 全部失明）。
 * 2. 22 条存量循环已清零（票 03 批次 5：views 类型抽离 types.ts / resultText 下沉
 *    domain / buildBubbleItems 渲染器注入 + renderContext Context 注入），no-circular
 *    恢复根配置的 error 硬卡。
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

/* ===== features 域间隔离（票 02 上锁、票 03 清零后裸上锁）===== */
/**
 * 存量跨域边已全部清零（票 03 五批次）：
 * 1. 通用资产下沉 ui/（16 件：toolIcons/agentPalette/pierreTheme/present/Logo/
 *    MobiWordmark/useThemeLocaleToggle/usePwaMode/InstallButton/ContextRing/
 *    ClearStateButton/AgentLoadingBubble/StatusBar/WorkspaceFormModal/
 *    SandboxHtmlFrame/QuoteListCard 等）；
 * 2. 纯逻辑下沉 domain/tool/resultText + core/data/hooks（useDirectoryListing/useFileMediaSrc）；
 * 3. 单消费方归位（ElicitationFormCard/QueuedMessagesBar→composer、LiveSystemNoticeBar→
 *    session、AssignWorkspaceModal→layout）；
 * 4. tool-card 并入 chat 域（边界画错裁决：工具卡是对话流呈现子域）；
 * 5. 组装链上提 pages/session/（session 域全域 + ChatContainer + ChatComposer +
 *    ComposerInfoPanel——组装权归 pages 层）；
 * 6. 渲染器注入化破 22 条循环（views/types + blocks/types + renderContext）。
 */
const FEATURE_ISOLATION_EXEMPT = []

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
