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
 * morph 动效打桩的共享工厂（jsdom 无 matchMedia：尺寸 spring 不必真跑，值到位即达）。
 * 用法：`vi.mock('motion/react', async (importOriginal) => motionReactStub(importOriginal))`
 */

import type { AnimationPlaybackControls, MotionValue } from 'motion/react'

export async function motionReactStub(importOriginal: () => Promise<typeof import('motion/react')>) {
    const actual = await importOriginal()
    // 两种形态都接：morph 系 animate(MotionValue, number)（置值即达）；
    // combobox 系 animate(Element, keyframes)（jsdom 无渲染管线，直接 resolve）
    const animateStub = (value: MotionValue<number> | Element, target?: number): AnimationPlaybackControls => {
        if (target !== undefined && value && typeof (value as MotionValue<number>).set === 'function') {
            ;(value as MotionValue<number>).set(target)
        }
        const promise = new Promise<void>((resolve) => { setTimeout(resolve, 0) })
        return { stop() {}, complete() {}, then: (resolve, reject) => promise.then(resolve, reject) } as unknown as AnimationPlaybackControls
    }
    return { ...actual, animate: animateStub, useReducedMotion: () => false }
}

/** react-i18next 的 key 直通桩（断言 key 而非语言文案，翻译内容由真实资源文件承载） */
export function i18nKeyStub() {
    return { useTranslation: () => ({ t: (key: string) => key }) }
}
