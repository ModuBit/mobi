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
import { useEffect, useState } from 'react'

export interface UseCharacterAnimationArgs {
    /** token 是否明文可见 */
    peek: boolean
    /** token 是否非空（peek && hasToken 才偷瞄） */
    hasToken: boolean
    /** 是否正在输入 token */
    typing: boolean
}

export interface CharacterAnimation {
    isPurplePeeking: boolean
    isPurpleBlinking: boolean
    isBlackBlinking: boolean
    isLookingAtEachOther: boolean
}

/**
 * 随机脉冲定时器：active 时以 [intervalMin, intervalMax] 随机间隔触发，
 * 每次持续 durationMs 后复位并重新调度。
 *
 * 复用于"随机眨眼"与"紫角色偷瞄"两种状态机，统一 outer/inner 双 timer 的调度与清理。
 * cleanup 同时清外层（间隔 timer）和内层（复位 timer），
 * 避免"激活中"卸载/失活后内层 timer 仍 setState。
 */
function useRandomPulse(
    active: boolean,
    intervalMin: number,
    intervalMax: number,
    durationMs: number,
): boolean {
    const [on, setOn] = useState(false)
    useEffect(() => {
        if (!active) {
            setOn(false)
            return
        }
        let outer: ReturnType<typeof setTimeout>
        let inner: ReturnType<typeof setTimeout>
        const schedule = () => {
            const delay = intervalMin + Math.random() * (intervalMax - intervalMin)
            outer = setTimeout(() => {
                setOn(true)
                inner = setTimeout(() => {
                    setOn(false)
                    schedule()
                }, durationMs)
            }, delay)
        }
        schedule()
        return () => {
            clearTimeout(outer)
            clearTimeout(inner)
        }
    }, [active, intervalMin, intervalMax, durationMs])
    return on
}

/**
 * 角色动画 state 机：
 * - 紫角色 / 黑角色：随机眨眼
 * - typing=true 时进入对视，800ms 后退出
 * - peek && hasToken 时紫角色以 2–5s 随机间隔偷瞄 800ms
 */
export function useCharacterAnimation({
    peek,
    hasToken,
    typing,
}: UseCharacterAnimationArgs): CharacterAnimation {
    const isPurpleBlinking = useRandomPulse(true, 3000, 7000, 150)
    const isBlackBlinking = useRandomPulse(true, 3000, 7000, 150)

    // 对视：typing 触发，800ms 复位
    const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false)
    useEffect(() => {
        if (!typing) {
            setIsLookingAtEachOther(false)
            return
        }
        setIsLookingAtEachOther(true)
        const t = setTimeout(() => setIsLookingAtEachOther(false), 800)
        return () => clearTimeout(t)
    }, [typing])

    // 偷瞄：peek && hasToken 时，2–5s 随机间隔偷瞄 800ms
    const peekingActive = peek && hasToken
    const isPurplePeeking = useRandomPulse(peekingActive, 2000, 5000, 800)

    return { isPurplePeeking, isPurpleBlinking, isBlackBlinking, isLookingAtEachOther }
}
