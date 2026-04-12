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

// Shadcn 风格组件配置 - Light 模式
export const shadcnLightComponents = {
    Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        defaultBorderColor: '#e4e4e7',
        defaultColor: '#18181b',
        defaultBg: '#ffffff',
        defaultHoverBg: '#f4f4f5',
        defaultHoverBorderColor: '#d4d4d8',
        defaultHoverColor: '#18181b',
        defaultActiveBg: '#e4e4e7',
        defaultActiveBorderColor: '#d4d4d8',
        borderRadius: 6,
    },
    Input: {
        activeShadow: 'none',
        hoverBorderColor: '#a1a1aa',
        activeBorderColor: '#18181b',
        borderRadius: 6,
    },
    Select: {
        optionSelectedBg: '#f4f4f5',
        optionActiveBg: '#fafafa',
        optionSelectedFontWeight: 500,
        borderRadius: 6,
    },
    Alert: {
        borderRadiusLG: 8,
    },
    Modal: {
        borderRadiusLG: 12,
    },
    Progress: {
        defaultColor: '#18181b',
        remainingColor: '#f4f4f5',
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
        trackBg: '#f4f4f5',
        trackHoverBg: '#e4e4e7',
        handleSize: 18,
        handleSizeHover: 20,
        railSize: 6,
    },
    ColorPicker: {
        borderRadius: 6,
    },
    Card: {
        borderRadiusLG: 12,
    },
}

// Shadcn 风格组件配置 - Dark 模式
export const shadcnDarkComponents = {
    Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        defaultBorderColor: '#27272a',
        defaultColor: '#fafafa',
        defaultBg: '#18181b',
        defaultHoverBg: '#27272a',
        defaultHoverBorderColor: '#3f3f46',
        defaultHoverColor: '#fafafa',
        defaultActiveBg: '#3f3f46',
        defaultActiveBorderColor: '#52525b',
        borderRadius: 6,
        // Primary solid 按钮在 dark 模式下：背景浅色，文字深色
        primaryColor: '#18181b',
    },
    Input: {
        activeShadow: 'none',
        hoverBorderColor: '#52525b',
        activeBorderColor: '#fafafa',
        borderRadius: 6,
    },
    Select: {
        optionSelectedBg: '#27272a',
        optionActiveBg: '#18181b',
        optionSelectedFontWeight: 500,
        borderRadius: 6,
    },
    Alert: {
        borderRadiusLG: 8,
    },
    Modal: {
        borderRadiusLG: 12,
    },
    Progress: {
        defaultColor: '#fafafa',
        remainingColor: '#27272a',
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
        trackBg: '#27272a',
        trackHoverBg: '#3f3f46',
        handleSize: 18,
        handleSizeHover: 20,
        railSize: 6,
    },
    ColorPicker: {
        borderRadius: 6,
    },
    Card: {
        borderRadiusLG: 12,
    },
}
