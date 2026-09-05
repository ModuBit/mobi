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

// Claude 暖调组件配置 - Light 模式
export const shadcnLightComponents = {
    Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        defaultBorderColor: '#e8e6dc',
        defaultColor: '#4d4c48',
        defaultBg: '#e8e6dc',
        defaultHoverBg: '#d1cfc5',
        defaultHoverBorderColor: '#d1cfc5',
        defaultHoverColor: '#141413',
        defaultActiveBg: '#b0aea5',
        defaultActiveBorderColor: '#b0aea5',
        borderRadius: 8,
    },
    Input: {
        activeShadow: 'none',
        hoverBorderColor: '#b0aea5',
        activeBorderColor: '#3d3d3a',
        borderRadius: 8,
    },
    Select: {
        optionSelectedBg: '#e8e6dc',
        optionActiveBg: '#f0eee6',
        optionSelectedFontWeight: 500,
        borderRadius: 8,
    },
    Alert: {
        borderRadiusLG: 8,
    },
    Modal: {
        borderRadiusLG: 14,
    },
    Progress: {
        defaultColor: '#3d3d3a',
        remainingColor: '#f0eee6',
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
        trackBg: '#f0eee6',
        trackHoverBg: '#e8e6dc',
        handleSize: 18,
        handleSizeHover: 20,
        railSize: 6,
    },
    ColorPicker: {
        borderRadius: 8,
    },
    Card: {
        borderRadiusLG: 14,
    },
}

// Claude 暖调组件配置 - Dark 模式
export const shadcnDarkComponents = {
    // Tooltip 背景走 colorBgSpotlight（全局 dark token 是米白，服务于浅底场景）——
    // 组件级覆写为深底浅字，与 dark 面板视觉一致
    Tooltip: {
        colorBgSpotlight: '#3d3d3a',
        colorTextLightSolid: '#faf9f5',
    },
    Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        defaultBorderColor: '#30302e',
        defaultColor: '#d1cfc5',
        defaultBg: '#30302e',
        defaultHoverBg: '#3d3d3a',
        defaultHoverBorderColor: '#3d3d3a',
        defaultHoverColor: '#faf9f5',
        defaultActiveBg: '#4d4c48',
        defaultActiveBorderColor: '#4d4c48',
        borderRadius: 8,
        primaryColor: '#141413',
    },
    Input: {
        activeShadow: 'none',
        hoverBorderColor: '#5e5d59',
        activeBorderColor: '#faf9f5',
        borderRadius: 8,
    },
    Select: {
        optionSelectedBg: '#3d3d3a',
        optionActiveBg: '#30302e',
        optionSelectedFontWeight: 500,
        borderRadius: 8,
    },
    Alert: {
        borderRadiusLG: 8,
    },
    Modal: {
        borderRadiusLG: 14,
    },
    Progress: {
        defaultColor: '#faf9f5',
        remainingColor: '#30302e',
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
        trackBg: '#30302e',
        trackHoverBg: '#3d3d3a',
        handleSize: 18,
        handleSizeHover: 20,
        railSize: 6,
    },
    ColorPicker: {
        borderRadius: 8,
    },
    Card: {
        borderRadiusLG: 14,
    },
}
