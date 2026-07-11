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
import { useEffect, useRef } from 'react'

/**
 * 声明式 setInterval 原语：`delay` 为 null 时暂停（清定时器）。
 *
 * callback 用 ref 保存，每次渲染更新 ref 但不放入 effect deps，
 * 避免回调变化导致定时器重建。useRotation / useBootSequence 共用此原语，
 * 各自只提供差异化的回调与 delay 计算。
 *
 * （参考 Dan Abramov 的 useInterval 实现。）
 */
export function useInterval(callback: () => void, delay: number | null): void {
    const savedCallback = useRef(callback)
    savedCallback.current = callback

    useEffect(() => {
        if (delay === null) return
        const id = setInterval(() => savedCallback.current(), delay)
        return () => clearInterval(id)
    }, [delay])
}
