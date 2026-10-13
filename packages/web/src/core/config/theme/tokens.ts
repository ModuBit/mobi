/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * 全站配色的唯一数值来源。三块内容：
 *
 * ① **中性阶**（`NEUTRAL_LIGHT` / `NEUTRAL_DARK`）：净白与净墨，色相不含倾向（LCh 色度 ≤ 3），
 *    层次由**明度**表达而非温度。旧体系靠「暖白 vs 奶油」的温度差分层次，色差只有 1–2 L*，
 *    层级弱到几乎看不见（见 2026-10-13 前的 `paper` / `paper-warm`）。
 * ② **语义色种子**（`SEMANTIC_*`）：success / warning / danger 三个基色，双档同族（同色相），
 *    只按底色明度调整明度与彩度——旧 dark 用的是 Tailwind 高饱和色（C82 vs light 的 C53），
 *    与 light 的土地色谱不是一套语言。
 * ③ **档位表**（`RADIUS_TIERS`）：圆角，规格在 DESIGN.md「Shapes」。
 *
 * antd 主题 token 与 cssVars 投出的 CSS 变量都是这三块的投影：改配色只改本文件 + DESIGN.md，
 * 组件侧一律取 token / var，任何字面量都会被守卫测试拦下。
 */

/* ==================== 中性阶 ==================== */

/** 中性阶的档名（取档只看「这是哪一层」） */
export type NeutralKey =
    | 'elevated'
    | 'container'
    | 'canvas'
    | 'hairline'
    | 'hairlineStrong'
    | 'hover'
    | 'selected'
    | 'pressed'
    | 'ink'
    | 'inkSecondary'
    | 'inkTertiary'
    | 'inkQuaternary'
    | 'primary'

/**
 * 中性阶（净白，冷调 whisper）。每档一句「它是哪一层」，取档只看层次不看元素大小。
 * 明度差是唯一的层次手段：container−canvas 3.4 L*、canvas−hover 2.4 L*、hover−selected 2.8 L*，
 * 每跳都够看清又不至于变成硬边界（旧值 1.8 / 2.0 / 2.9 —— 第一跳几乎不存在）。
 */
export const NEUTRAL_LIGHT: Record<NeutralKey, string> = {
    /** 抬升层：Modal / 菜单 / 浮层，唯一允许纯白的层 */
    elevated: '#ffffff',
    /** 容器层：卡片 / 侧栏 / 输入框本体 */
    container: '#f9f9fb',
    /** 画布层：页面底（消息流所在的那一层） */
    canvas: '#f0f0f4',
    /** 极淡描边：分隔线、卡片边 */
    hairline: '#e6e6eb',
    /** 实控件描边：按钮 / 输入框的边界 */
    hairlineStrong: '#d9d9e0',
    /** hover 高亮：指点未确认（最淡的一档浮起） */
    hover: '#e9e9ee',
    /** 选中高亮：比 hover 深一档 */
    selected: '#e1e1e7',
    /** 按压 / 强调过渡 */
    pressed: '#d5d5dc',
    /** 主文字：一切正文与主交互 */
    ink: '#17171b',
    inkSecondary: '#4c4c52',
    inkTertiary: '#83838a',
    /** 四级：占位符、禁用态、装饰点 */
    inkQuaternary: '#adadb4',
    /** 实心墨按钮：交互重要性靠「深度的灰」表达，不靠色相 */
    primary: '#3a3a41',
}

/** 中性阶（净墨）——与 light 同构，明度方向相反（越亮越靠前） */
export const NEUTRAL_DARK: Record<NeutralKey, string> = {
    elevated: '#25252a',
    container: '#1a1a1e',
    canvas: '#131316',
    hairline: '#2f2f35',
    hairlineStrong: '#3e3e45',
    hover: '#232328',
    selected: '#2f2f35',
    pressed: '#3e3e45',
    ink: '#f6f6f8',
    inkSecondary: '#d2d2d8',
    inkTertiary: '#898990',
    inkQuaternary: '#5d5d65',
    primary: '#f6f6f8',
}

/* ==================== 语义色 ==================== */

/**
 * 语义色种子（土地色谱：苔藓绿 / 赤陶橙 / 砖红）。双档同色相，dark 只是提亮——
 * 这一族是「哪档都认得出来」的识别色，不是两套调色板。
 */
export const SEMANTIC_LIGHT: Record<SemanticKey, string> = { success: '#3f7a3a', warning: '#c96442', danger: '#b53333' }
export const SEMANTIC_DARK: Record<SemanticKey, string> = { success: '#6cc06f', warning: '#e5925f', danger: '#e26060' }

type SemanticKey = 'success' | 'warning' | 'danger'

/** #rrggbb → [r, g, b] */
function hexToRgb(hex: string): [number, number, number] {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

/** #rrggbb + 透明度 → rgba(...)：antd 主题 token 只吃具体色值（CSS 变量它解析不了） */
export function withAlpha(hex: string, alpha: number): string {
    const [r, g, b] = hexToRgb(hex)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 两色按比例混合（t=0 取 a，t=1 取 b）——语义色族的唯一生成式 */
function mix(a: string, b: string, t: number): string {
    const [ar, ag, ab] = hexToRgb(a)
    const [br, bg, bb] = hexToRgb(b)
    const ch = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
    return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`
}

/**
 * 语义色族的生成比例：淡底（Bg）/ 描边（Border）从底色向种子靠，深浅态（Hover/Active）
 * 从种子向「远离底色」的方向走（light 压暗、dark 提亮）。
 * 这样一族九色只需要一个种子，色相天然同源——手写九个数必然会漂（旧 dark 的
 * `colorSuccessBorder` 与 `colorSuccessBgHover` 直接抄成了同一个值）。
 */
interface SemanticRamp {
    bg: number
    bgHover: number
    border: number
    borderHover: number
    hover: number
    active: number
}

const LIGHT_RAMP: SemanticRamp = { bg: 0.075, bgHover: 0.16, border: 0.3, borderHover: 0.5, hover: 0.13, active: 0.26 }
const DARK_RAMP: SemanticRamp = { bg: 0.16, bgHover: 0.26, border: 0.38, borderHover: 0.6, hover: 0.14, active: 0.26 }

/** 语义色族的九件套（键名为 antd token 的后缀，`color` = 基色本身） */
interface SemanticFamily {
    color: string
    bg: string
    bgHover: string
    border: string
    borderHover: string
    hover: string
    active: string
    text: string
    textHover: string
    textActive: string
}

/** 由种子色 + 底色生成 antd 的九件套 */
function semanticFamily(seed: string, base: string, toward: string, ramp: SemanticRamp): SemanticFamily {
    return {
        color: seed,
        bg: mix(base, seed, ramp.bg),
        bgHover: mix(base, seed, ramp.bgHover),
        border: mix(base, seed, ramp.border),
        borderHover: mix(base, seed, ramp.borderHover),
        hover: mix(seed, toward, ramp.hover),
        active: mix(seed, toward, ramp.active),
        text: seed,
        textHover: seed,
        textActive: mix(seed, toward, ramp.hover),
    }
}

/** 展平成 antd 的扁平 token 键：`color` → `colorSuccess`，其余 → `colorSuccessBg` 等 */
type SemanticTokens<Prefix extends string> = {
    [K in keyof SemanticFamily as K extends 'color' ? `color${Prefix}` : `color${Prefix}${Capitalize<K>}`]: string
}

/**
 * 九件套 → 扁平 token 键。槽位名只在这里拼一次：新增一个语义槽只需给 `SemanticFamily`
 * 加一行，键名自动跟上（此前这里手抄了十行，加槽位要同时改接口、生成式、展平三处）。
 */
function spreadFamily<Prefix extends string>(prefix: Prefix, family: SemanticFamily): SemanticTokens<Prefix> {
    const tokens: Record<string, string> = {}
    for (const [slot, value] of Object.entries(family)) {
        tokens[slot === 'color' ? `color${prefix}` : `color${prefix}${slot[0]!.toUpperCase()}${slot.slice(1)}`] = value
    }
    return tokens as SemanticTokens<Prefix>
}

function spreadSemantic<Prefix extends string>(
    prefix: Prefix,
    seed: string,
    base: string,
    toward: string,
    ramp: SemanticRamp,
): SemanticTokens<Prefix> {
    return spreadFamily(prefix, semanticFamily(seed, base, toward, ramp))
}

/**
 * primary / info 两族的九件套。它们是**中性墨族**：antd 要求这两族各有整套 token，
 * 但取值全是中性阶的档位，不是第二块调色板。故同样由生成式给出，族间实有差异的档
 * （块上的字、light 的 info 描边比 primary 淡一档）在 opts 里点出来。
 * 注意「块上的字」两族两档各不相同（light 是墨字、dark 的实心块是亮块压暗字），
 * 故不做默认推导，逐档写明。
 */
function neutralFamily<Prefix extends 'Primary' | 'Info'>(
    prefix: Prefix,
    ramp: Record<NeutralKey, string>,
    opts: { text: string; textHover: string; borderHover?: string },
): SemanticTokens<Prefix> {
    return spreadFamily(prefix, {
        color: ramp.primary,
        bg: ramp.selected,
        bgHover: ramp.pressed,
        border: ramp.selected,
        borderHover: opts.borderHover ?? ramp.pressed,
        hover: ramp.inkSecondary,
        active: ramp.ink,
        text: opts.text,
        textHover: opts.textHover,
        textActive: opts.text,
        })
}

/* ==================== 圆角档位 ==================== */

/**
 * 圆角档位（两档同值，故单源一处——颜色双档有别，圆角没有）。
 *
 * **这是全站圆角的唯一数值来源**：DESIGN.md「Shapes」章是它的规格（二者由
 * tests/core/config/theme/radius-consistency.test.ts 锁死），antd 主题 token 与
 * cssVars 投出的 CSS 变量都是它的投影。改档位只改这里 + DESIGN.md，组件侧一律取档引用，
 * 任何 `border-radius: <数值>px` 字面量都会被守卫拦下——散落的字面量正是逐个调不动的根因。
 *
 * 档位以**角色**命名（uiarc 同法），不设 xs/sm/md/lg 数值阶梯；主体三档等差 8px。
 */
export const RADIUS_TIERS = {
    /** 方角档：复选框、小标记等要保留方角的元素 */
    square: 4,
    /** 图标键档：侧栏 / 标题栏 / 工具条里的纯图标按钮（比控件档收一档，才不像药丸） */
    icon: 6,
    /** 控件小号档：标签、分段项、下拉项、`ant-btn-sm` */
    controlSm: 10,
    /** 控件档：按钮 / 输入 / Select */
    control: 14,
    /** 面板档：卡片 / 悬浮面板 / 菜单 */
    panel: 22,
    /** 大表面档：Modal */
    surface: 30,
    /** 圆形档：头像 / 状态点 / 徽标（不是圆角，是「无圆角上限」） */
    pill: 9999,
} as const

/** DESIGN.md 里的档位名 → 本文件的键名（守卫测试按这张表逐档比对） */
export const RADIUS_TIER_KEYS = {
    square: 'square',
    icon: 'icon',
    'control-sm': 'controlSm',
    control: 'control',
    panel: 'panel',
    surface: 'surface',
    pill: 'pill',
} as const

/**
 * antd 主题 token 的四个槽位。antd 只提供这四个名字，故 icon / surface 两档**没有槽位**：
 * 前者由组件取 `--radius-icon` CSS 变量，后者由 Modal 组件级覆写（antd v6 的覆写机制是
 * 在组件作用域里重声明全局变量，实测生效）。
 */
const radius = {
    borderRadius: RADIUS_TIERS.control,
    borderRadiusXS: RADIUS_TIERS.square,
    borderRadiusSM: RADIUS_TIERS.controlSm,
    borderRadiusLG: RADIUS_TIERS.panel,
}

/* ==================== 主题 token ==================== */

/**
 * 净白主题（Light）。中性阶承担全部层次，色相只留给语义色与品牌图形。
 * primary 是**净墨**——交互的重要性靠深度的灰表达，不靠色相（与旧体系的暖墨灰同理，只是去掉了暖）。
 */
export const shadcnLightToken = {
    fontFamily: 'var(--font-body)',
    fontFamilyCode: 'var(--font-mono)',
    colorTextBase: NEUTRAL_LIGHT.ink,
    colorBgBase: NEUTRAL_LIGHT.container,
    // 三个语义色族（含基色本身）由种子生成，见 spreadSemantic
    ...spreadSemantic('Success', SEMANTIC_LIGHT.success, NEUTRAL_LIGHT.container, '#000000', LIGHT_RAMP),
    ...spreadSemantic('Warning', SEMANTIC_LIGHT.warning, NEUTRAL_LIGHT.container, '#000000', LIGHT_RAMP),
    ...spreadSemantic('Error', SEMANTIC_LIGHT.danger, NEUTRAL_LIGHT.container, '#000000', LIGHT_RAMP),
    // primary / info 是中性墨族：它们的淡底、描边、深浅态就是中性阶本身（不再是第二套数值）
    ...neutralFamily('Primary', NEUTRAL_LIGHT, { text: NEUTRAL_LIGHT.ink, textHover: NEUTRAL_LIGHT.inkSecondary }),
    ...neutralFamily('Info', NEUTRAL_LIGHT, {
        text: NEUTRAL_LIGHT.ink,
        textHover: NEUTRAL_LIGHT.inkSecondary,
        borderHover: NEUTRAL_LIGHT.inkQuaternary,
    }),
    colorText: NEUTRAL_LIGHT.ink,
    colorTextSecondary: NEUTRAL_LIGHT.inkSecondary,
    colorTextTertiary: NEUTRAL_LIGHT.inkTertiary,
    colorTextQuaternary: NEUTRAL_LIGHT.inkQuaternary,
    colorTextDisabled: NEUTRAL_LIGHT.inkQuaternary,
    // 悬浮高亮三档阶梯（唯一来源，见 DESIGN.md「Hover & Selected」）：hover < selected < pressed
    colorFillQuaternary: NEUTRAL_LIGHT.hover,
    colorFillTertiary: NEUTRAL_LIGHT.selected,
    colorFillSecondary: NEUTRAL_LIGHT.pressed,
    colorBgTextHover: NEUTRAL_LIGHT.hover,
    colorBgContainer: NEUTRAL_LIGHT.container,
    colorBgElevated: NEUTRAL_LIGHT.elevated,
    colorBgLayout: NEUTRAL_LIGHT.canvas,
    colorBgSpotlight: NEUTRAL_LIGHT.primary,
    // 遮罩 = 容器色带透明度（与底色同源，不会在净白体系里漏出暖色）
    colorBgMask: 'rgba(250, 250, 252, 0.65)',
    // 极淡描边：分隔靠留白与 1px hairline，永远不用粗实线
    colorBorder: NEUTRAL_LIGHT.hairline,
    colorBorderSecondary: NEUTRAL_LIGHT.hairline,
    ...radius,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: 'rgba(0,0,0,0.05) 0px 4px 24px',
    boxShadowSecondary: 'rgba(0,0,0,0.08) 0px 4px 12px',
}

/** 净墨主题（Dark）——与 Light 对称映射同一套语义，不是第二块调色板 */
export const shadcnDarkToken = {
    fontFamily: 'var(--font-body)',
    fontFamilyCode: 'var(--font-mono)',
    colorTextBase: NEUTRAL_DARK.ink,
    colorBgBase: NEUTRAL_DARK.container,
    // 三个语义色族（含基色本身）由种子生成，见 spreadSemantic
    ...spreadSemantic('Success', SEMANTIC_DARK.success, NEUTRAL_DARK.canvas, '#ffffff', DARK_RAMP),
    ...spreadSemantic('Warning', SEMANTIC_DARK.warning, NEUTRAL_DARK.canvas, '#ffffff', DARK_RAMP),
    ...spreadSemantic('Error', SEMANTIC_DARK.danger, NEUTRAL_DARK.canvas, '#ffffff', DARK_RAMP),
    // primary 是「净墨压纸」：实心块是亮的墨色，故块上的字 = 画布色；淡底 / 描边取自中性阶
    ...neutralFamily('Primary', NEUTRAL_DARK, { text: NEUTRAL_DARK.canvas, textHover: NEUTRAL_DARK.canvas }),
    // info 的淡底是暗色块，字仍是墨色
    ...neutralFamily('Info', NEUTRAL_DARK, { text: NEUTRAL_DARK.ink, textHover: NEUTRAL_DARK.inkSecondary }),
    colorText: NEUTRAL_DARK.ink,
    colorTextSecondary: NEUTRAL_DARK.inkSecondary,
    colorTextTertiary: NEUTRAL_DARK.inkTertiary,
    colorTextQuaternary: NEUTRAL_DARK.inkQuaternary,
    colorTextDisabled: NEUTRAL_DARK.inkQuaternary,
    colorTextLightSolid: NEUTRAL_DARK.canvas,
    colorFillQuaternary: NEUTRAL_DARK.hover,
    colorFillTertiary: NEUTRAL_DARK.selected,
    colorFillSecondary: NEUTRAL_DARK.pressed,
    colorBgTextHover: NEUTRAL_DARK.hover,
    colorBgContainer: NEUTRAL_DARK.container,
    colorBgElevated: NEUTRAL_DARK.elevated,
    colorBgLayout: NEUTRAL_DARK.canvas,
    colorBgSpotlight: NEUTRAL_DARK.ink,
    colorBgMask: 'rgba(0, 0, 0, 0.65)',
    colorBorder: NEUTRAL_DARK.hairline,
    colorBorderSecondary: NEUTRAL_DARK.hairline,
    ...radius,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: 'rgba(0,0,0,0.3) 0px 4px 24px',
    boxShadowSecondary: 'rgba(0,0,0,0.4) 0px 4px 12px',
}
