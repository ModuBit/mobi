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
 * 流式状态的单向传递：Renderer 的 streaming 只到根节点，自定义组件（如 Map）
 * 需要知道「当前 fence 是否还在流」——流式期间 props 每个 delta 都变，重组件
 * （地图初始化/销毁）不能跟着抖动。
 */

import { createContext, useContext } from 'react'

export const OpenUIStreamingContext = createContext(false)

export function useOpenUIStreaming(): boolean {
    return useContext(OpenUIStreamingContext)
}
