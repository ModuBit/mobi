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
 * useStreamingContent 的测试 mock（即时全显：rate 0.1 / interval 0）。
 *
 * 此前这套 mock 工厂（含三个导出的形状）在 5 个测试文件逐字粘贴——useStreamingContent
 * 接口一改要同步 5 处。工厂须经 vi.mock 的 async 动态引入使用（工厂被提升到静态
 * import 之上，直接引用 import 绑定会报 before-initialization）：
 *
 *   import { streamingDisplayState } from '<rel>/helpers/streamingContentMock'
 *   vi.mock('@/ui/useStreamingContent', async () =>
 *     (await import('<rel>/helpers/streamingContentMock')).streamingContentMock())
 *
 * displayState 单独静态导入供测试控制揭示文本（.current）。
 */

import { vi } from 'vitest'

/** 受控揭示进度：current 为当前已揭示文本，测试里直接改写 */
export const streamingDisplayState = { current: '' }

/** vi.mock 工厂产物：即时全显（interval 0 = 无揭示动画） */
export function streamingContentMock() {
    return {
        useStreamingContent: () => streamingDisplayState.current,
        STREAM_BASE_RATE: 0.1,
        computeRevealRate: vi.fn(() => 0.1),
        revealIntervalFor: vi.fn(() => 0),
    }
}
