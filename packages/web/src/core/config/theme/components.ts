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

// 组件级主题覆写（双档）。
//
// 两条纪律：
// ① **颜色一律取档引用**，不写十六进制字面量——本文件是「哪个组件用哪一档」的登记处，
//    不是第二块调色板。此前这里抄了 40+ 个旧配色字面量，配色一换就是一片漏网的旧值
//    （与「圆角只覆写与全局档位不一致的组件」同理，见 DESIGN.md「Colors」「Shapes」）。
// ② **圆角只覆写与全局档位不一致的组件**（Alert 借 LG 槽位承载控件档、Modal 覆写为大表面档、
//    Checkbox 覆写为方角档）。与全局同值的覆写一律删掉——那是第二个事实源，改档位时必然漏改一处。
//
// 注意：antd 主题 token 必须是**具体色值**（它要按色值做派生计算），故这里引用 tokens.ts 的
// 中性阶常量而非 CSS 变量——常量本身就是单一来源。
import { NEUTRAL_DARK, NEUTRAL_LIGHT, withAlpha } from './tokens'

/** 净白主题的组件覆写 */
export const shadcnLightComponents = {
    // 图片预览工具栏：图标色必须跟随遮罩（--ant-color-bg-mask light=纸色/dark=深色），
    // 同一色两档必有一档隐形（2026-09-26 真机：白图标在 light 纸色遮罩上不可见）
    Image: {
        previewOperationColor: withAlpha(NEUTRAL_LIGHT.primary, 0.88),
        previewOperationHoverColor: NEUTRAL_LIGHT.ink,
    },
    // 按钮的四处状态色全部落在中性阶上：rest → hover → active 逐档加深（DESIGN.md Buttons 章）
    Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        defaultBg: NEUTRAL_LIGHT.selected,
        defaultBorderColor: NEUTRAL_LIGHT.selected,
        defaultColor: NEUTRAL_LIGHT.inkSecondary,
        defaultHoverBg: NEUTRAL_LIGHT.pressed,
        defaultHoverBorderColor: NEUTRAL_LIGHT.pressed,
        defaultHoverColor: NEUTRAL_LIGHT.ink,
        defaultActiveBg: NEUTRAL_LIGHT.inkQuaternary,
        defaultActiveBorderColor: NEUTRAL_LIGHT.inkQuaternary,
        // text 档按钮 hover 底色（DESIGN.md Buttons 章：hairline）
        textHoverBg: NEUTRAL_LIGHT.hover,
    },
    Input: {
        activeShadow: 'none',
        hoverBorderColor: NEUTRAL_LIGHT.inkQuaternary,
        // focus 边框用中灰（ink-tertiary）而非最深的墨色——深墨描边过刺眼（DESIGN.md Buttons 章）
        activeBorderColor: NEUTRAL_LIGHT.inkTertiary,
    },
    Select: {
        // 选项 hover = 悬浮高亮 hover 档、选中 = 选中档，与全站阶梯同一来源（DESIGN.md「Hover & Selected」）
        optionSelectedBg: NEUTRAL_LIGHT.selected,
        optionActiveBg: NEUTRAL_LIGHT.hover,
        optionSelectedFontWeight: 500,
        // focus 边框与 Input 同阶梯（hairline → quaternary → tertiary），不用 colorPrimary 两极色；
        // activeOutlineColor 置 transparent 对齐「无 focus 光晕」规范
        hoverBorderColor: NEUTRAL_LIGHT.inkQuaternary,
        activeBorderColor: NEUTRAL_LIGHT.inkTertiary,
        activeOutlineColor: 'transparent',
    },
    // 提示条是**控件档**的表面（uiarc 同法：alert 走 control），不是面板档。
    // antd 只给 Alert 暴露 LG 槽位，故在此覆写（= tokens.ts 的 borderRadius）
    Alert: {
        borderRadiusLG: 14,
    },
    // Modal 是**大表面档**（DESIGN.md Shapes），antd 没有对应的槽位，只能在这里覆写
    Modal: {
        borderRadiusLG: 30,
    },
    Progress: {
        defaultColor: NEUTRAL_LIGHT.primary,
        remainingColor: NEUTRAL_LIGHT.hover,
    },
    Steps: {
        iconSize: 32,
    },
    Switch: {
        trackHeight: 24,
        trackMinWidth: 44,
        innerMinMargin: 4,
        innerMaxMargin: 24,
    },
    // 方角档（DESIGN.md rounded.square）：全局 SM 是「小尺寸控件」档（10px），
    // 复选框要的是接近方角的 4px，故在此覆写
    Checkbox: {
        borderRadiusSM: 4,
    },
    Slider: {
        trackBg: NEUTRAL_LIGHT.hover,
        trackHoverBg: NEUTRAL_LIGHT.selected,
        handleSize: 18,
        handleSizeHover: 20,
        railSize: 6,
    },
}

/** 净墨主题的组件覆写（与净白同构，状态方向相反：hover/active 逐档提亮） */
export const shadcnDarkComponents = {
    // 图片预览工具栏：默认图标透明度过低，dark 遮罩下几乎不可见（2026-09-26 真机），
    // 提到接近不透明；hover 全白
    Image: {
        previewOperationColor: 'rgba(255, 255, 255, 0.92)',
        previewOperationHoverColor: '#ffffff',
    },
    // Tooltip 背景走 colorBgSpotlight（全局 dark token 是浅色，服务于浅底场景）——
    // 组件级覆写为深底浅字，与 dark 面板视觉一致
    Tooltip: {
        colorBgSpotlight: NEUTRAL_DARK.pressed,
        colorTextLightSolid: NEUTRAL_DARK.ink,
    },
    Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        defaultBg: NEUTRAL_DARK.selected,
        defaultBorderColor: NEUTRAL_DARK.selected,
        defaultColor: NEUTRAL_DARK.inkSecondary,
        defaultHoverBg: NEUTRAL_DARK.pressed,
        defaultHoverBorderColor: NEUTRAL_DARK.pressed,
        defaultHoverColor: NEUTRAL_DARK.ink,
        defaultActiveBg: NEUTRAL_DARK.inkQuaternary,
        defaultActiveBorderColor: NEUTRAL_DARK.inkQuaternary,
        // text 档按钮 hover 底色（DESIGN.md Buttons 章：dark 提亮一档）
        textHoverBg: NEUTRAL_DARK.selected,
        // 实心按钮上的字 = 画布色（亮块压暗字）
        primaryColor: NEUTRAL_DARK.canvas,
    },
    Input: {
        activeShadow: 'none',
        hoverBorderColor: NEUTRAL_DARK.inkQuaternary,
        // focus 边框用中灰（ink-tertiary）而非最亮的纸白——白框在暗底上过刺眼（DESIGN.md Buttons 章）
        activeBorderColor: NEUTRAL_DARK.inkTertiary,
    },
    Select: {
        optionSelectedBg: NEUTRAL_DARK.selected,
        optionActiveBg: NEUTRAL_DARK.hover,
        optionSelectedFontWeight: 500,
        hoverBorderColor: NEUTRAL_DARK.inkQuaternary,
        activeBorderColor: NEUTRAL_DARK.inkTertiary,
        activeOutlineColor: 'transparent',
    },
    Alert: {
        borderRadiusLG: 14,
    },
    Modal: {
        borderRadiusLG: 30,
    },
    Progress: {
        defaultColor: NEUTRAL_DARK.ink,
        remainingColor: NEUTRAL_DARK.selected,
    },
    Steps: {
        iconSize: 32,
    },
    Switch: {
        trackHeight: 24,
        trackMinWidth: 44,
        innerMinMargin: 4,
        innerMaxMargin: 24,
    },
    Checkbox: {
        borderRadiusSM: 4,
    },
    Slider: {
        trackBg: NEUTRAL_DARK.selected,
        trackHoverBg: NEUTRAL_DARK.pressed,
        handleSize: 18,
        handleSizeHover: 20,
        railSize: 6,
    },
}
