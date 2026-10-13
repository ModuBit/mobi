---
version: alpha
name: Mobi
description: Mobi 远程控制 Claude Code 的净白纸感设计系统
# 中性阶 —— **层次靠明度，色相不含倾向**（chroma ≤ 3）。规格值，代码单源见 tokens.ts 的
# NEUTRAL_LIGHT / NEUTRAL_DARK（二者由 palette-consistency 守卫锁死）。
colors:
  # 三层表面：画布（页面底）< 容器（卡片/侧栏）< 抬升（Modal/浮层）
  canvas: "#f0f0f4"       # 画布层：消息流所在的那一层
  paper: "#f9f9fb"        # 容器层：卡片 / 侧栏 / 输入框本体
  elevated: "#ffffff"     # 抬升层：Modal / 菜单 / 浮层（唯一允许纯白）
  # 交互高亮三档（hover < selected < pressed），全站唯一来源
  hover: "#e9e9ee"
  selected: "#e1e1e7"
  pressed: "#d5d5dc"
  # 墨色四级：一切文字与主交互
  ink: "#17171b"
  ink-secondary: "#4c4c52"
  ink-tertiary: "#83838a"
  ink-quaternary: "#adadb4"
  primary: "#3a3a41"       # 实心墨按钮：重要性靠深度的灰表达，不靠色相
  on-primary: "#ffffff"    # 压在 solid primary 上的浅字（antd 按主色亮度自动取）
  # 语义色 —— 低饱和土地色谱，双档同族（dark 只提亮，见 colors-dark）
  success: "#3f7a3a"      # 苔藓绿
  warning: "#c96442"      # 赤陶橙
  danger: "#b53333"       # 砖红
  bash-glow: "#e8703a"    # Bash 模式发光边框专用暖橙（信号色，不是装饰）
  # 描边 —— 1px 极淡，与高亮档共阶梯
  hairline: "#e6e6eb"
  hairline-strong: "#d9d9e0"
  hairline-active: "#83838a"
# 暗色模式（自定义扩展键，spec 静默接受）。Light 为规范值，Dark 见正文说明
colors-dark:
  canvas: "#131316"
  paper: "#1a1a1e"
  elevated: "#25252a"
  hover: "#232328"
  selected: "#2f2f35"
  pressed: "#3e3e45"
  ink: "#f6f6f8"
  ink-secondary: "#d2d2d8"
  ink-tertiary: "#898990"
  ink-quaternary: "#5d5d65"
  primary: "#f6f6f8"
  on-primary: "#131316"
  success: "#6cc06f"
  warning: "#e5925f"
  danger: "#e26060"
  hairline: "#2f2f35"
  hairline-strong: "#3e3e45"
  hairline-active: "#898990"
typography:
  body:
    fontFamily: "Alibaba PuHuiTi 3.0"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  body-md:
    fontFamily: "Alibaba PuHuiTi 3.0"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Alibaba PuHuiTi 3.0"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  headline-md:
    fontFamily: "Alibaba PuHuiTi 3.0"
    fontSize: 20px
    fontWeight: 500
    lineHeight: 1.3
  label-md:
    fontFamily: "Alibaba PuHuiTi 3.0"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
  # 聊天气泡专属：等宽优先，中文回落正文体（项目独有特征）
  chat:
    fontFamily: "JetBrains Mono"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  # 等宽 —— 代码、时间戳、CLI 输出、数字
  mono:
    fontFamily: "JetBrains Mono"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  mono-sm:
    fontFamily: "JetBrains Mono"
    fontSize: 11.5px
    fontWeight: 400
    lineHeight: 1.4
motion:
  # spring 动效预设——与 components/motion/presets.ts 一一对应（有一致性测试守卫）
  ui:       { bounce: 0, duration: 0.35 }   # 状态切换默认档
  momentum: { bounce: 0, duration: 0.3 }     # 拖拽释放沉降
  gentle:   { bounce: 0, duration: 0.5 }     # 大面积元素
# 按角色命名取档（uiarc 同法），不做 xs/sm/md/lg 的数值阶梯——「该选哪号」的犹豫本身就是摩擦。
# 主体三档等差 8px（control → panel → surface）：每跳的观感增幅一致，才不会出现「这一跳小、
# 下一跳大」的突档（旧值 8/10/14 正是这样：+2 再 +4）。control=14 的锚：mobi 控件高 36px ×
# uiarc 的控件比值（18/44）≈ 14——照搬 uiarc 的 18px 会在这个高度上变成胶囊。
rounded:
  square: 4px        # 方角档：复选框、小标记等要保留方角的元素
  icon: 6px          # 图标键档：侧栏 / 标题栏 / 工具条里的纯图标按钮（比控件档收一档，才不像药丸）
  control-sm: 10px   # 控件小号档 = control − 4（小尺寸控件；uiarc 同法用「控件档 − 4」表达这一档）
  control: 14px      # 控件档：按钮 / 输入 / Select
  panel: 22px        # 面板档：卡片 / 悬浮面板 / 菜单
  surface: 30px      # 大表面档：Modal
  pill: 9999px       # 圆形档：头像 / 状态点 / 徽标
spacing:
  xs: 4px
  sm: 8px
  base: 12px
  md: 16px
  lg: 24px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "{spacing.base}"
  button-primary-hover:
    backgroundColor: "{colors.ink-secondary}"
  button-default:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    padding: "{spacing.base}"
  button-default-hover:
    backgroundColor: "{colors.pressed}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.elevated}"
    rounded: "{rounded.control}"
  button-danger-hover:
    backgroundColor: "#9d2c2c"   # danger 深一档；dark 模式见正文
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
  button-text-hover:
    backgroundColor: "{colors.hairline}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "{spacing.base}"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.panel}"
    padding: "{spacing.lg}"
  surface-layout:
    backgroundColor: "{colors.canvas}"
  divider:
    backgroundColor: "{colors.hairline}"
  meta-text:
    textColor: "{colors.ink-tertiary}"
    typography: "{typography.body-sm}"
  chip-success:
    backgroundColor: "{colors.success}"
    rounded: "{rounded.pill}"
  chip-warning:
    backgroundColor: "{colors.warning}"
    rounded: "{rounded.pill}"
  chip-danger:
    backgroundColor: "{colors.danger}"
    rounded: "{rounded.pill}"
  bash-mode-border:
    backgroundColor: "{colors.bash-glow}"
  modal:
    backgroundColor: "{colors.elevated}"
    rounded: "{rounded.surface}"
  checkbox:
    rounded: "{rounded.square}"
---

## Overview

Mobi 是 Claude Code 的远程驾驶舱。它的视觉是**净白纸 + 净墨**：一块没有色相倾向的纸，上面铺着近乎纯黑的墨，配以从土地里取色的低饱和强调。

气质是「**手工日志本 + 终端**」的混合：大面积留白与克制的中性灰，承载密集的等宽字体对话与代码。它自信地不讨好第一眼——按钮没有阴影，边框淡到只剩一道灰，强调色不是鲜艳的品牌色而是墨本身。唯一允许「发光」的地方是 Bash 命令模式边框和像素粒子悬停效果，因为它们对应真实的运行态。

**层次靠明度，不靠色相**：体系里只有中性阶与四个语义色两组颜色，中性阶的色度被压到几乎为零（chroma ≤ 5），全部层级信息由明度承载——纸面之间差 2–3 L* 就能分出「这是哪一层」而不成为硬边界。配色因此改得动：换一档明度，全站跟着走。

面向两类读者：开发者（在桌面端长时间盯着会话流）和移动端用户（单手快速操作）。因此密度偏高、留白慷慨、移动端按压反馈用 `opacity` 而非高亮块。

## Colors

单一墨阶 + 三层白纸 + 土地色谱强调色。**唯一数值来源是 `src/core/config/theme/tokens.ts`**（`NEUTRAL_LIGHT` / `NEUTRAL_DARK` / `SEMANTIC_*`），本节是它的规格；antd token、`--mobi-*` CSS 变量都是它的投影，守卫测试逐档比对（`tests/core/config/theme/palette-consistency.test.ts`）。Light 与 Dark 是**对称映射**的同一套体系，不是两套调色板。

- **墨阶 {colors.ink} → {colors.ink-quaternary}**：一切文字与主交互的来源。底色纸太白，故墨不用 `#000` 而用 `#17171b`——纯黑在纸面上会「凿」出洞感。四级灰阶承担全部信息层级（正文 / 次级 / 辅助 / 占位与装饰）。
- **三层纸**：画布 {colors.canvas}（页面底、消息流）→ 容器 {colors.paper}（卡片 / 侧栏 / 输入框）→ 抬升 {colors.elevated}（Modal / 菜单，唯一允许纯白）。每跳 2–4 L*，**同屏三层都看得见**——这是本项目区分层次的主要手段（旧体系靠「暖奶油 vs 暖白」的温度差，色差只有 1–2 L*，层级几乎不可见）。
- **交互高亮三档** {colors.hover} / {colors.selected} / {colors.pressed}：hover 是指点未确认，selected 比它深半档，pressed 再深半档。三档与三层纸同属中性阶，**禁止自造 hover 色**（详见「Hover & Selected」）。
- **Primary {colors.primary}** 是主色，但它是**墨灰** {colors.primary}，不是鲜艳品牌色。primary 按钮就是这块灰。这是整套设计最反直觉也最关键的决策：交互的「重要性」靠**深度的灰**表达，而非色相。
- **语义色**全部低饱和、土地取色：success 是苔藓绿 {colors.success}，warning 是赤陶橙 {colors.warning}，danger 是砖红 {colors.danger}。绝不用饱和的原色红绿。**每族只有一颗种子**，其九件套（Bg / Border / Hover / Active / Text）由 `spreadSemantic` 从种子按固定比例混合生成——手写九个数必然漂（旧 dark 的 `colorSuccessBorder` 与 `colorSuccessBgHover` 就抄成了同一个值）。
- **Bash glow {colors.bash-glow}** 是唯一允许「发光」的暖橙，仅用于 Sender 进入 Bash 模式时的发光边框——它是运行态信号，不是装饰。
- **Hairline {colors.hairline}** 是描边：卡片与分隔线 `hairline`，实控件边界 `hairline-strong`，focus 边框 `hairline-active`。分隔靠留白与 1px 淡线，**永远不用粗实线**。
- **固定深色舞台**（反色气泡 / 登录页终端面板）：它们是「浅色主题里的深色块」，取净墨档且不随主题切换，经 `--mobi-stage-*` 变量取色。

### Dark 模式

Dark 不是把 Light 反相，而是**对称映射同一套语义**：墨与纸互换（ink → `#f6f6f8`，paper → `#1a1a1e`），明度关系整体压暗但方向不变（越亮越靠前），语义色同色相提亮以在暗底上可读（success `#3f7a3a` → `#6cc06f`）。见 frontmatter 的 `colors-dark` 扩展键。切换通过 `html[data-theme='dark']`，CSS 变量与 antd token 同步驱动。

**双档同族**是硬约束：语义色的色相两档必须一致（只许动明度与彩度）。旧的 dark 直接用了 Tailwind 的高饱和色（success `#4ade80` C69 vs light 的 C44、warning `#f97316` C82 vs C53），两档看上去不是一套语言——守卫测试锁死「两档色相差 ≤ 20°」。

## Buttons

按钮的视觉重量就是语义权重。墨色深浅不是装饰——它是在回答「用户在这里最想完成的下一件事是什么」。**选型先于调色**：先判定动作属于哪一级，颜色是判定的结果。

### 语义分级（四级，没有 warning 按钮）

| 形态 | 语义 | 判定问题 | 典型例子 |
|------|------|----------|----------|
| **primary**（实心墨） | 当前视图唯一的主推进动作 | 去掉它这个界面就「走不下去」了吗？ | 发送消息、表单提交、对话框确认、权限批准、恢复会话 |
| **default**（灰底） | 其余一切常规动作 | 独立存在、不推进主流程的动作 | 发送测试通知、验证连接、取消、替换、刷新 |
| **text**（无底） | 行内轻操作 | 去掉底色后这个动作仍可被理解吗？ | 复制、重试、展开、行内链接式动作 |
| **danger** | 破坏性动作 | 误按的代价是什么？ | 删除会话、清空数据 |

分级规则：

- **一屏只允许一个 primary**（Modal 内单独算一屏）。两个实心墨块并排 = 层级失败，必有一方降为 default。
- primary 给「推进任务」的动作，不给「出现频率高」的动作——发送是 primary，不是因为点得多，而是因为它推进对话。
- **没有真正的默认动作时，全部用 default，不硬造 primary**。设置页卡片里的独立动作（发送测试通知）没有「走下去」的方向，人人平等。
- 同一组内的旁路动作（取消之于确认、替换之于验证）永远不给 primary，哪怕它看起来更常用。
- **warning 色不做按钮**。antd 没有这个形态，语义上也不需要——警告是状态提示（Alert/状态点）的职责，不是动作的职责。按钮只有上面四级。
- 破坏性动作常态用 text 或 default + danger 字色，**solid danger 只出现在两类场景**：用户已明确表达意图的确认步骤（确认对话框的确认键），以及**视图的主推进本身就是破坏性动作**（如权限的 defaultToNo 模式主位拒绝，`PermissionFooter` 的 `denyFirst`）——让红色出现在「最后一声警告」或「唯一的危险出路」上，而不是入口上。
- **选择态例外**：picker / toggle 里的 primary（VirtualKeyPicker 的修饰键选中、DesktopStreamSurface 的控制权获取）表达「已选中 / 可进入」的**状态指示**，不是动作推荐，不受「一屏一个」约束。但同一组内其他普通动作按钮仍按四级判定，不借选择态抬升。

### 颜色与交互态

交互反馈只有一条规则：**hover 背景加深一档（dark 模式提亮一档），active 再一档**。不浮起、不加边框粗细、不变字号、零阴影（见 Elevation）。

颜色配置的唯一来源是 `src/core/config/theme/tokens.ts` + `components.ts`，下表与其数值一一对应：

**Light**

| 形态 | rest | hover | active |
|------|------|-------|--------|
| primary | 底 {colors.primary} `#3a3a41` / 字 on-primary `#fff` | 底 ink-secondary `#4c4c52` | 底 ink `#17171b` |
| default | 底/边 {colors.selected} `#e1e1e7` / 字 ink-secondary `#4c4c52` | 底/边 `#d5d5dc` / 字 ink `#17171b` | 底/边 `#adadb4` |
| text | 无底 / 字 ink-secondary | 底 {colors.hover} `#e9e9ee` | 底 `#e1e1e7` |
| danger（solid） | 底 {colors.danger} `#b53333` / 字 `#fff` | 底 `#9d2c2c` | 底 `#882424` |

**Dark（对称反转，不是新调色板）**

| 形态 | rest | hover | active |
|------|------|-------|--------|
| primary | 底 ink `#f6f6f8` / 字 `#131316` | 底 ink-secondary `#d2d2d8` | 底 ink `#f6f6f8` |
| default | 底/边 `#2f2f35` / 字 `#d2d2d8` | 底/边 `#3e3e45` / 字 ink | 底/边 `#5d5d65` |
| text | 无底 / 字 `#d2d2d8` | 底 `#2f2f35` | 底 `#3e3e45` |
| danger（solid） | 底 `#e26060` / 字 `#131316` | 底 `#d25757` | 底 `#e26060` |

- **disabled**：字 `colorTextDisabled`（= ink-quaternary，light `#adadb6` / dark `#5d5d65`），背景不动——disabled 是「失去资格」，不是「换一种颜色的重要」。
- **danger 字色形态**（text/default + danger 字）：字走 `colorErrorText` 系（light `#b53333` / dark `#e26060`），hover 字不变、出淡红底（`colorErrorBg` 系）。红色只出现在字与淡底上。
- 实心 primary 的文字颜色由主题对称决定：**Light 白字、Dark 墨字**——都是「纸色压在墨上 / 墨色压在纸上」的同一逻辑，不是两套规则。
- 图标按钮（IconButton）走 text 档词汇：透明底、ink-secondary 字，hover 出 primaryBg 淡底。
- **两字按钮不加空格**：antd `autoInsertSpace` 已全局关闭（`ThemeProvider` ConfigProvider `button={{ autoInsertSpace: false }}`）。antd 的「连 接」式排版惯例与全站三字以上按钮（无空格）字距节奏不一致，统一取无空格的紧凑节奏。

## Hover & Selected

悬浮与选中的高亮是全站同一套三档阶梯，**唯一来源是 `tokens.ts` 的 fill 系 token**（antd 内部组件与业务组件全部走它，双主题对称）：

| 档 | token | Light | Dark | 语义 |
|----|-------|-------|------|------|
| **hover** | `colorBgTextHover` = `colorFillQuaternary` = `{colors.hover}` | `#e9e9ee` | `#232328` | 指点过但未确认——最淡的一层 |
| **selected** | `colorPrimaryBg`（= `colorFillTertiary`）= `{colors.selected}` | `#e1e1e7` | `#2f2f35` | 当前选中/激活——比 hover 深一档 |
| **pressed / 按住** | `colorFillSecondary` / `colorPrimaryBgHover` = `{colors.pressed}` | `#d5d5dc` | `#3e3e45` | 按压瞬时态或强调过渡 |

规则：

- **hover 与 selected 必须是不同的两档**——同一元素两个状态同色，用户无法分辨「停在上面」和「已选中」（实锤过：effort 菜单曾把 selected 写成 hover 同色同值）。
- **selected 永远比 hover 深半档**（light 加深 / dark 提亮），这是「鲜艳」在纸感体系里的表达——不靠饱和度靠明度差。
- 任何列表行、菜单项、下拉选项、卡片可点区都落在这套阶梯上，**禁止自造 hover 色**：不直接写 rgba 黑白 alpha（antd 默认冷灰）、不硬编码 hex、不把 `colorPrimaryBg` 借作 hover（它会与选中撞色）。要走 token：hover 用 `colorBgTextHover`，选中用 `colorPrimaryBg`。
- antd 内部组件的高亮由全局 token 自动统一（`colorFill*` 已统一覆盖 antd 的默认冷灰）；自定义 CSS 变量引用 `var(--ant-color-bg-text-hover)` / `var(--ant-color-fill-*)` 同样自动跟随。
- 选中态的入口若同时可 hover（如侧栏选中行），hover 不得把选中底色洗掉——写条件保持 `selected` 档（参照 `sidebarProjects.styles` / `mobileMenu.styles` 的模式）。

## Typography

两族字体、严格分工：**阿里巴巴普惠体 3.0** 承担一切正文与界面文字，**JetBrains Mono** 承担一切代码、时间戳、CLI 输出与——**聊天气泡**。

- **正文用 PuHuiTi**，权重仅 400 / 500 / 700 三档。中文优先（GB2312 子集按 unicode-range 分片加载），西文回落系统无衬线。
- **聊天气泡是项目独有特征**：气泡正文 `font-chat` 让 **JetBrains Mono 排在 PuHuiTi 之前**——英文/代码/标点走等宽，中文回落正文体。这让对话流天然带「终端日志」的质感，而非普通 IM。新增气泡内容请沿用 `var(--font-chat)`，不要改回正文体。
- **等宽字体专用于数据**：代码块、时间戳（`font-variant-numeric: tabular-nums` 对齐数字）、文件路径、CLI 输出。绝不用等宽字体排正文标题。
- **字号克制**：正文 16px / 14px，标签 13px，等宽数据 13px / 11.5px。不设超过 24px 的大标题——这不是一个营销页面。
- **tracking 分档**：≥20px 标题 `-0.01em`、正文 `0`、极小字视可读性微正（见 base.css）。letter-spacing 禁止全站固定值——大标题需要收紧透气，小字需要放松可读，一刀切必错一头。

## Layout

双布局模型：**桌面端固定侧栏 + 主区**，**移动端单栏 + 抽屉**。响应式断点 `768px`，跨越处用 `dvh`/`dvw` 而非 `vh`/`vw` 应对移动端浏览器栏。

- **间距严格 8 的倍数**（4px 为半步微调）：{spacing.xs}=4、{spacing.sm}=8、{spacing.base}=12、{spacing.md}=16、{spacing.lg}=24。新组件请落在这套刻度上。
- **移动端底部 Drawer 强制三约束**：高度自适应、上限 `85dvh`、底部 `padding: max(24px, env(safe-area-inset-bottom))` 安全区。这是硬规范，见 `packages/web/CLAUDE.md`。
- **侧栏宽度** `--agent-card-width` 桌面 200px、移动 130px，作为 AgentCard 等浮层的基准宽度。
- **气泡留白**：assistant 气泡右侧压缩 5%，含工具卡片的气泡最小宽度 80%——给工具卡片足够横向空间。

## Elevation & Depth

**几乎不用投影。** 这是本项目最鲜明的克制。深度靠**明度差（canvas / paper / elevated 三层，每跳 2–4 L*）**与**1px 淡边框**表达，不靠阴影。

- **按钮零阴影**：primaryShadow / defaultShadow / dangerShadow 全部 `'none'`。交互反馈靠背景色变化，不靠浮起。
- 抬升层（Modal/Drawer/Popover）才用极淡投影：`rgba(0,0,0,0.05) 0px 4px 24px`，几乎不可见——明度差已经把层次说清了，阴影只是锦上添花。
- Dark 模式投影稍重（`0.3`）以在暗底上可辨，但仍保持含蓄。
- **例外**：Bash 模式发光边框用 `box-shadow` 叠暖橙光晕，PixelCard 用 canvas 粒子——它们是动效信号，不是静态层次。

## Materials

**不采用毛玻璃**（2026-08-21 决策，曾引入后回退）：真机上半透明 + `backdrop-filter` 的玻璃感不明显，而滚动时内容在玻璃层下移动导致 blur 每帧重算、真机明显卡顿。顶栏/底栏一律用**不透明纸面 + hairline 分割线**（升级前原方案），`--glass-*` 变量与 `.chat-edge-fade-*` 已删除，勿再引入滚动穿透类浮层材质。

## Shapes

**圆角体系**，圆角偏大但不到「胶囊」的程度。**按角色取档**（uiarc 同法）：档位以「这是哪一层表面」命名，不设 xs/sm/md/lg 的数值阶梯——省掉「该选哪号」的犹豫，是这套体系好用的一半。

主体三档**等差 8px**（control → panel → surface）：每跳的观感增幅一致，才不会出现「这一跳小、下一跳大」的突档感。`control` 的锚点是**控件高度**而非手感：mobi 控件高 36px，乘 uiarc 的控件比值（18px/44px）≈ 14px——照搬 uiarc 的 18px 会在 36px 高上变成胶囊。

- 按钮 / 输入 / Select：{rounded.control}=14px
- 卡片 / 悬浮面板 / 菜单：{rounded.panel}=22px
- Modal：{rounded.surface}=30px
- 小尺寸控件（标签、分段项、下拉项）：{rounded.control-sm}=10px（= control − 4）
- 图标键（侧栏 / 标题栏 / 工具条里的纯图标按钮）：{rounded.icon}=6px
- 复选框、小标记：{rounded.square}=4px（保留方角，区别于圆形 radio）
- 圆形元素（头像、状态点）：{rounded.pill}
- **嵌套内圆角 = 外圆角 − 容器内边距**（同心圆公式，uiarc 同法）：菜单项 = panel − 6px、卡中卡 = panel − 8px。外圆角一放大，内层不跟着收就会「外圆内方」——这是大圆角最容易露馅的地方。
- **不要在同一视图混用方角与圆角**；新组件默认落在 control/panel 两档。
- **取档只看「这是哪一层」**，别按元素大小猜：最外层容器（页面级卡片 / 弹层 / 悬浮面板）走 `panel`；面板内的卡片、行、按钮、输入走 `control`；面板内的图标盒、小标签走 `control-sm`；要大要小都先问「它是不是外层的同心内层」——是就用同心公式，不是才换档。
- **不写死数值**：组件一律取档引用——antd 组件树内用 `$token.borderRadius*` / `var(--ant-border-radius*)`，antd 树外与自绘件、弹层用注入的 `--radius-<档名>`（角色名即变量名）。散落的字面量是「逐个调不动」的根因（settings 页的卡片曾一半跟 token、一半写死 12px），故由守卫测试机械拦截：`src` 下任何等于档位值的 `border-radius` 字面量都会失败（唯一例外：代码编辑器内部的密集 chrome，守卫里按文件具名列出，不开目录级豁免）。

## Components

- **按钮**：语义分级（primary / default / text / danger）、判定规则与全量交互态见 **[Buttons](#buttons)** 章。零阴影，hover 仅背景一档变化。
- **输入框 / 下拉框**：圆角 {rounded.control}，边框淡到 {colors.hairline}，hover 转 {colors.ink-quaternary}，focus 转 {colors.hairline-active}（中灰 ink-tertiary，双主题同值）——focus 边框**不做两极色**（最深墨 / 最亮纸白），1px 实线在纸面上会读成「刺眼描边」而非焦点信号；**无 focus 光晕**（Input `activeShadow: 'none'`、Select `activeOutlineColor: 'transparent'`）。强度阶梯：hairline → ink-quaternary → ink-tertiary，逐级半档，无突变。**下拉面板打开时不弱化 selector 里的选中文本**（antd 默认降到 opacity 0.25，读作「文本消失」，已在 antd.css 硬覆盖回 1——面板内的高亮选中项已承担「当前是谁」的表达）。
- **卡片**：圆角 {rounded.panel}，容器底色，无阴影无粗边。
- **聊天气泡**：等宽优先字体，assistant 左对齐右侧留 5%，工具卡片气泡最小宽 80%。
- **PixelCard**（签名组件）：鼠标悬停时 canvas 像素粒子从中心向外扩散，基于 React Bits 改造。用于需要「活」感的入口卡片。
- **pixel-avatar**：动画像素精灵头像，含眨眼/呼吸循环（`status-dot-breathe` keyframes）。
- **AgentCard**：基于 zinc 单色体系，agent 名称经 djb2 哈希稳定映射到 8 个低饱和 HSL 色调（饱和度 Light 28 / Dark 22），**极淡地点缀**，绝不喧宾夺主。
- **音频播放器**：顶部直角（让时间浮层可见）+ 底部圆角，进度条 3px 极细，handle 圆点主色。

## Motion

动效是 **spring 物理动效**（Motion 库，`motion/react`）。状态切换不是播放一段写死的曲线，而是一次物理求解：从**当前值 + 当前速度**起跳，继承手势速度，临界阻尼收敛、无 overshoot——真机体感过冲容易动效过头，故不弹跳；物理感来自速度继承与可打断性，而非过冲。

- **三档预设，唯一来源是 `components/motion/presets.ts`**（数值与 frontmatter 一一对应，有一致性测试守卫）：

  | 预设 | bounce | duration | 用途 |
  |------|--------|----------|------|
  | `spring.ui` | 0 | 0.35 | 状态切换、开关、面板开合（默认档） |
  | `spring.momentum` | 0 | 0.3 | 拖拽释放后的沉降（velocity 由调用方透传） |
  | `spring.gentle` | 0 | 0.5 | 大面积元素（Modal 级）位移 |

  参数化用 motion 的 duration-based spring：`duration` 是到达目标的感知时长（越短越跟手），`bounce` 0~1 控制过冲弹性。**bounce 统一为 0**（无 overshoot）——真机体感 overshoot 容易动效过头（2026-08-21 决策去除），保留 spring 的速度继承与可打断性。**组件禁止手写 bounce/duration 字面量**——调气质只改 presets.ts。⚠️ 禁止传 `damping`/`stiffness`：motion 的 `damping` 是绝对阻尼系数（与 Apple 的 damping ratio 阻尼比不是一个东西），且它一出现就会覆盖 `duration`/`bounce`——曾误传 `damping: 0.8`（几乎无阻尼）导致所有 spring 多周期长震荡。
- **非 spring 的连续量变化也要平滑**：宽度、高度等布局量随交互改变时（如产物 iframe 宽度档位切换），优先加 CSS transition 平滑过渡而非生硬跳变；时长与曲线**走 antd 主题 token**（`token.motionDurationMid` × `token.motionEaseInOut`），禁止硬编码毫秒数或 cubic-bezier 字面量——与 spring 预设同一纪律：调气质只动主题源，不散落组件。初挂载值不变的属性不会被触发，无需额外守卫。
- **展开/收起必须成对缓动**：可折叠列表（如 turn-diff 卡的文件清单）的展开与收起**两个方向都要有过渡**——只动画单向会让体感不一致（有回应的一向 vs 硬切的一向）。实现用 grid `grid-template-rows: 0fr ↔ 1fr` 过渡（折叠内容常驻 DOM 挂 `aria-hidden`，不测量高度、双向同一条代码路径），时长曲线同走 antd token；禁止条件渲染直接增删行（双向硬切）。`prefers-reduced-motion` 下退化为瞬时切换。
- **一切动效可打断**：用户在动画进行中的任何输入都应立即生效，动画从当前值+当前速度重新求解，而不是等播完。禁止锁输入等动画完成。
- **手势释放判定：速度符号优先于位置**。快甩即关、快反向推即回位；拖到一半松手但速度接近零，才按位置判定。释放后用 momentum 投射（inertia decay `0.998`）继续沉降，让手势与动画无缝衔接。
- **性能边界**：JS spring 跑在主线程，**避开聊天流等大区域**——虚拟列表内的条目不用 spring。所有动效只动 `transform` / `opacity`，不触发 layout。
- **降级**：`prefers-reduced-motion` 下全量换 ≤200ms opacity cross-fade，物理感让位于可访问性。
- **registry 组件动效纪律（shadcn 底座票 04）**：迁移进来的组件**禁止自带第二套 spring/缓动语言**——其动效参数必须并入 `components/motion/presets.ts` 单源（若选用 uiarc，其动效 token 即按 spec D9 升格至此，与 frontmatter 同步）；组件观感按本设计系统的色板 / 圆角 token 重着色，不留上游默认配色。动效密度：高频交互（按钮、行 hover、tab）只用克制反馈（按压 scale），morph 级动效仅限低频高感知时刻。
- **按压反馈（移动端）**：去掉浏览器默认 tap-highlight，改用 `[role]/button/.tappable:active { opacity: 0.7 }`——圆形元素得圆形反馈，不出现方形高亮块。**仅触屏**生效，桌面端保留 hover。
- **状态点呼吸**：`status-dot-breathe` 在 `opacity 1 ↔ 0.3` 间脉动，表示运行态。
- **ScrambleText**：字符乱码滚动到位的打字机效果，用于 loading 文案。
- **PixelCard 粒子**：悬停触发的 canvas 粒子扩散。
- 遵守 `prefers-reduced-motion`。

## Gestures

移动端是单手设备，手势是一等公民。规则围绕一个原则：**手指一动，界面立即跟；手指一松，物理接管**。

- **1:1 跟踪**：Pointer Events + `setPointerCapture`，触摸点抓到哪元素就跟到哪，尊重抓取偏移（抓手那一刻的相对位置），不跳变。
- **释放速度继承（velocity handoff）**：手势结束时的速度原样交给 spring——这是「手势与动画无缝衔接」的关键。丢掉速度，动画就得从零加速，读作「卡了一下」。
- **判定速度符号优先于位置**：快甩即关、快反向推即回位（见 Motion 章）。现有实现在 MobileDrawer 的 `resolveDragDisposition`。
- **rubber-band 上边界**（`dragElastic 0.2`）：内容已在顶部还继续下拉时，位移按比例衰减而非硬停。硬停读作「冻结」，渐进阻尼读作「到底了」。
- **迟滞 10px 防误触 + 方向锁**：左缘右滑（EdgeSwipeBack，仅会话详情页）位移超过 10px 且水平分量胜出才认定为手势；竖向分量胜出立即放弃跟踪交还浏览器滚动——检测层无浮层、全程无 preventDefault，贴边滚动与点击不受干扰。
- **多模态反馈三原则**：causality（因果明确——反馈必须能归因到刚才那个动作）/ harmony（视觉+触觉同帧，不各走各的）/ utility（只在有意义的时刻反馈，不为震而震）。

## Do's and Don'ts

- **Do** 用墨灰 {colors.primary} 表达「最重要的那个操作」——一屏只允许一个 primary。
- **Do** 按钮先判语义等级再取色（见 Buttons 章）：主推进 primary、常规动作 default、行内轻操作 text、破坏性 danger。
- **Do** 用明度差（canvas / paper / elevated）做层次，而非阴影。
- **Do** 在聊天气泡里用 `var(--font-chat)` 等宽优先字体。
- **Do** 落在 8 的倍数间距刻度上。
- **Do** 移动端可点元素加 `.tappable` 或语义 role，以获得 opacity 按压反馈。
- **Do** 动效用 spring 预设（`components/motion/presets.ts` 唯一来源，与 frontmatter 数值同源）。
- **Do** 布局量（宽/高）随交互变化时加平滑过渡，时长/曲线取主题 motion token（见 Motion 章）。
- **Do** 手势释放用速度符号判定——快甩即关、快反向推即回位。
- **Don't** 用纯黑 `#000` 或纯白 `#fff` 做大面积底色（净白仅限抬升层）。
- **Don't** 给按钮、输入加阴影或 focus 光晕——这是本项目的核心克制。
- **Do** 悬浮/选中高亮走三档阶梯 token（hover=`colorBgTextHover`、selected=`colorPrimaryBg`，见 Hover & Selected 章）。
- **Don't** 自造 hover 色——不写 rgba 黑白 alpha、不硬编码 hex、不把 `colorPrimaryBg` 借作 hover。
- **Don't** 让 hover 与 selected 同色——selected 永远比 hover 深半档。
- **Don't** 给旁路动作（取消/替换/次要设置项）用 solid primary——一屏两个实心墨块即层级失败。
- **Don't** 用 warning 色做按钮——警告是状态的职责（Alert/状态点），不是动作的职责。
- **Don't** 用饱和原色（`#f00`/`#0f0`）——语义色必须走土地色谱的低饱和值。
- **Don't** 用粗实线分隔——边框最淡 {colors.hairline}，分隔首选留白。
- **Don't** 在聊天气泡里用正文体替代等宽体。
- **Don't** 在组件里手写 bounce/duration/damping/stiffness 字面量——spring 预设唯一来源是 `components/motion/presets.ts`（damping/stiffness 会覆盖 duration/bounce，见上文陷阱）。
- **Don't** 硬编码 transition 的毫秒数或 cubic-bezier 字面量——CSS 过渡时长/曲线同样走主题 token（`motionDurationMid` × `motionEaseInOut`）。
- **Don't** 锁输入等动画完成——一切动效可打断。
- **Don't** 引入毛玻璃/滚动穿透浮层材质（真机卡顿 + 效果不明显，见 Materials）。
- **Don't** 新建移动端底部 Drawer 时省略安全区 padding 与 85dvh 上限。
