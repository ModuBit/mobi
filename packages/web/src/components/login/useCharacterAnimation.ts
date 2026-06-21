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
 * 随机眨眼定时器：3–7s 随机间隔，眨眼时长 150ms
 */
function useRandomBlink(active = true) {
    const [blinking, setBlinking] = useState(false)
    useEffect(() => {
        if (!active) return
        let blinkTimeout: ReturnType<typeof setTimeout>
        const schedule = () => {
            const delay = 3000 + Math.random() * 4000
            blinkTimeout = setTimeout(() => {
                setBlinking(true)
                setTimeout(() => {
                    setBlinking(false)
                    schedule()
                }, 150)
            }, delay)
        }
        schedule()
        return () => clearTimeout(blinkTimeout)
    }, [active])
    return blinking
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
    const isPurpleBlinking = useRandomBlink()
    const isBlackBlinking = useRandomBlink()

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
    const [isPurplePeeking, setIsPurplePeeking] = useState(false)
    useEffect(() => {
        if (!peekingActive) {
            setIsPurplePeeking(false)
            return
        }
        let peekTimeout: ReturnType<typeof setTimeout>
        const schedule = () => {
            const delay = 2000 + Math.random() * 3000
            peekTimeout = setTimeout(() => {
                setIsPurplePeeking(true)
                setTimeout(() => {
                    setIsPurplePeeking(false)
                    schedule()
                }, 800)
            }, delay)
        }
        schedule()
        return () => clearTimeout(peekTimeout)
    }, [peekingActive])

    return { isPurplePeeking, isPurpleBlinking, isBlackBlinking, isLookingAtEachOther }
}
