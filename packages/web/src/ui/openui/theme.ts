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
 * openui 主题 token 映射（双档）：从 mobi 的 antd token（shadcnLightToken /
 * shadcnDarkToken）派生 react-ui 的 createTheme 覆写——两者都是纯数据，
 * 此处只做字段名翻译，保证 fenced openui UI 与宿主主题同源跟随。
 * 项目主题双档约束：light/dark 必须同时给值，未覆写的键回落 react-ui 内置默认。
 */

import { createTheme, type Theme } from '@openuidev/react-ui'
import { shadcnLightToken, shadcnDarkToken } from '@/core/config/theme/tokens'

type AntdToken = typeof shadcnLightToken

/** antd token → react-ui Theme 覆写的字段名翻译（两档共用同一映射） */
function toOpenUITheme(t: AntdToken): Theme {
    return createTheme({
        background: t.colorBgContainer,
        foreground: t.colorText,
        popoverBackground: t.colorBgElevated,
        sunk: t.colorFillTertiary,
        sunkLight: t.colorFillQuaternary,
        sunkDeep: t.colorFillSecondary,
        elevated: t.colorBgElevated,
        overlay: t.colorBgMask,
        highlightSubtle: t.colorFillQuaternary,
        highlight: t.colorFillTertiary,
        textNeutralPrimary: t.colorText,
        textNeutralSecondary: t.colorTextSecondary,
        textNeutralTertiary: t.colorTextTertiary,
        textSuccessPrimary: t.colorSuccess,
        textAlertPrimary: t.colorWarning,
        textDangerPrimary: t.colorError,
        textInfoPrimary: t.colorInfo,
        interactiveAccentDefault: t.colorPrimary,
        interactiveAccentHover: t.colorPrimaryHover,
        interactiveAccentPressed: t.colorPrimaryActive,
        borderDefault: t.colorBorder,
    })
}

export const OPENUI_LIGHT_THEME = toOpenUITheme(shadcnLightToken)
export const OPENUI_DARK_THEME = toOpenUITheme(shadcnDarkToken)
