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
 * 重编辑场景装配：loadSketch 还原的场景 → excalidraw updateScene 参数。
 * 领域知识所在——内嵌 scene 的 appState.theme 经导出 sanitize 后缺省 light，
 * 直接灌入会覆盖受控主题且 props 不再变化无法同步回（表现为重编辑不跟随应用
 * 主题，dark 下开成 light），故 theme 必须剥离、按当前应用主题重灌。
 *
 * 纯函数：返回装配结果（update 参数 + 文件列表）而非直接操作 editor，可脱离
 * excalidraw 单测。
 */

/** loadSketch 的还原产物（见 sketchFile.loadSketch） */
export interface RestoredSketch {
    elements: readonly unknown[]
    appState: Record<string, unknown>
    files: Record<string, unknown>
}

/** 装配结果：update 原样传 updateScene（TS 宽 Record 不匹配由调用方一行 cast）；
 *  files 为空时无需 addFiles */
export interface AssembledScene {
    update: {
        elements: readonly unknown[]
        appState: Record<string, unknown>
    }
    files: readonly unknown[]
}

export function prepareSceneUpdate(scene: RestoredSketch, theme: 'dark' | 'light'): AssembledScene {
    const { theme: _embeddedTheme, ...restAppState } = scene.appState
    return {
        update: {
            elements: scene.elements,
            appState: { ...restAppState, theme },
        },
        files: Object.values(scene.files),
    }
}
