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

// Claude 暖调风格 Light 主题配置
export const shadcnLightToken = {
    fontFamily: "var(--font-body)",
    fontFamilyCode: "var(--font-mono)",
    colorPrimary: '#3d3d3a',
    colorSuccess: '#3f7a3a',
    colorWarning: '#c96442',
    colorError: '#b53333',
    colorInfo: '#3d3d3a',
    colorTextBase: '#141413',
    colorBgBase: '#faf9f5',
    colorPrimaryBg: '#e8e6dc',
    colorPrimaryBgHover: '#d1cfc5',
    colorPrimaryBorder: '#e8e6dc',
    colorPrimaryBorderHover: '#d1cfc5',
    colorPrimaryHover: '#4d4c48',
    colorPrimaryActive: '#141413',
    colorPrimaryText: '#141413',
    colorPrimaryTextHover: '#4d4c48',
    colorPrimaryTextActive: '#141413',
    colorSuccessBg: '#f0f5ee',
    colorSuccessBgHover: '#dde9d8',
    colorSuccessBorder: '#c2d9b8',
    colorSuccessBorderHover: '#a3c794',
    colorSuccessHover: '#357030',
    colorSuccessActive: '#2d5f28',
    colorSuccessText: '#3f7a3a',
    colorSuccessTextHover: '#3f7a3a',
    colorSuccessTextActive: '#357030',
    colorWarningBg: '#fdf5f0',
    colorWarningBgHover: '#f8e4d6',
    colorWarningBorder: '#f0c8b0',
    colorWarningBorderHover: '#e0a882',
    colorWarningHover: '#b5563a',
    colorWarningActive: '#9e4830',
    colorWarningText: '#c96442',
    colorWarningTextHover: '#c96442',
    colorWarningTextActive: '#b5563a',
    colorErrorBg: '#faf0f0',
    colorErrorBgHover: '#f5dddd',
    colorErrorBorder: '#e8b8b8',
    colorErrorBorderHover: '#d89898',
    colorErrorHover: '#a02c2c',
    colorErrorActive: '#882424',
    colorErrorText: '#b53333',
    colorErrorTextHover: '#b53333',
    colorErrorTextActive: '#a02c2c',
    colorInfoBg: '#e8e6dc',
    colorInfoBgHover: '#d1cfc5',
    colorInfoBorder: '#d1cfc5',
    colorInfoBorderHover: '#b0aea5',
    colorInfoHover: '#4d4c48',
    colorInfoActive: '#141413',
    colorInfoText: '#141413',
    colorInfoTextHover: '#4d4c48',
    colorInfoTextActive: '#141413',
    colorText: '#141413',
    colorTextSecondary: '#4d4c48',
    colorTextTertiary: '#87867f',
    colorTextQuaternary: '#b0aea5',
    colorTextDisabled: '#b0aea5',
    // 悬浮高亮体系（暖调化覆盖 antd 默认冷灰 rgba）：hover 半档/按下再半档，
    // 与 hairline 三档同源——唯一来源，见 DESIGN.md「Hover 高亮」章
    colorFillQuaternary: '#f0eee6',
    colorFillTertiary: '#e8e6dc',
    colorFillSecondary: '#d1cfc5',
    colorBgTextHover: '#f0eee6',
    colorBgContainer: '#faf9f5',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f5f4ed',
    colorBgSpotlight: '#3d3d3a',
    // light 档遮罩 = 米白磨砂（与 colorBgContainer 同色系）：深色 alpha 再浅叠在内容上也只会
    // 「加灰」出不了亮色遮罩；dark 档维持深色 alpha。双档方向相反是有意为之
    colorBgMask: 'rgba(250, 249, 245, 0.65)',
    colorBorder: '#f0eee6',
    colorBorderSecondary: '#f0eee6',
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

// Claude 暖调风格 Dark 主题配置
export const shadcnDarkToken = {
    fontFamily: "var(--font-body)",
    fontFamilyCode: "var(--font-mono)",
    colorPrimary: '#faf9f5',
    colorSuccess: '#4ade80',
    colorWarning: '#f97316',
    colorError: '#ef4444',
    colorInfo: '#faf9f5',
    colorTextBase: '#faf9f5',
    colorBgBase: '#141413',
    colorPrimaryBg: '#30302e',
    colorPrimaryBgHover: '#3d3d3a',
    colorPrimaryBorder: '#30302e',
    colorPrimaryBorderHover: '#3d3d3a',
    colorPrimaryHover: '#e4e2d8',
    colorPrimaryActive: '#faf9f5',
    colorPrimaryText: '#141413',
    colorPrimaryTextHover: '#141413',
    colorPrimaryTextActive: '#141413',
    colorSuccessBg: '#0f2d1a',
    colorSuccessBgHover: '#1a4028',
    colorSuccessBorder: '#1a4028',
    colorSuccessBorderHover: '#4ade80',
    colorSuccessHover: '#3fcc70',
    colorSuccessActive: '#4ade80',
    colorSuccessText: '#4ade80',
    colorSuccessTextHover: '#4ade80',
    colorSuccessTextActive: '#6ee7a0',
    colorWarningBg: '#3a1c08',
    colorWarningBgHover: '#5a2e10',
    colorWarningBorder: '#5a2e10',
    colorWarningBorderHover: '#f97316',
    colorWarningHover: '#ea6c10',
    colorWarningActive: '#f97316',
    colorWarningText: '#f97316',
    colorWarningTextHover: '#f97316',
    colorWarningTextActive: '#fdba74',
    colorErrorBg: '#3a1010',
    colorErrorBgHover: '#5a1818',
    colorErrorBorder: '#5a1818',
    colorErrorBorderHover: '#ef4444',
    colorErrorHover: '#dc3636',
    colorErrorActive: '#ef4444',
    colorErrorText: '#ef4444',
    colorErrorTextHover: '#ef4444',
    colorErrorTextActive: '#fca5a5',
    colorInfoBg: '#30302e',
    colorInfoBgHover: '#3d3d3a',
    colorInfoBorder: '#30302e',
    colorInfoBorderHover: '#3d3d3a',
    colorInfoHover: '#e4e2d8',
    colorInfoActive: '#faf9f5',
    colorInfoText: '#faf9f5',
    colorInfoTextHover: '#e4e2d8',
    colorInfoTextActive: '#faf9f5',
    colorText: '#faf9f5',
    colorTextSecondary: '#d1cfc5',
    colorTextTertiary: '#87867f',
    colorTextQuaternary: '#5e5d59',
    colorTextDisabled: '#5e5d59',
    // 悬浮高亮体系（dark 提亮方向）：与 light 对称的三档暖灰，见 DESIGN.md「Hover 高亮」章
    colorFillQuaternary: '#262622',
    colorFillTertiary: '#30302e',
    colorFillSecondary: '#3d3d3a',
    colorBgTextHover: '#262622',
    colorBgContainer: '#1a1a18',
    colorBgElevated: '#232320',
    colorBgLayout: '#141413',
    colorBgSpotlight: '#faf9f5',
    colorTextLightSolid: '#141413',
    colorBgMask: 'rgba(0, 0, 0, 0.65)',
    colorBorder: '#30302e',
    colorBorderSecondary: '#1e1e1c',
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
