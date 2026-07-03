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
import { useRef } from 'react'
import { EyeBall, Pupil } from './EyeBall'
import { useCharacterAnimation } from './useCharacterAnimation'
import { useCachedRect, useMouseLook, type MousePos } from './useMouseLook'

export interface CharacterBandProps {
    /** token 明文可见 */
    peek: boolean
    /** token 非空 */
    hasToken: boolean
    /** 正在输入 */
    typing: boolean
}

const STAGE_WIDTH = 550
const STAGE_HEIGHT = 400

/**
 * 角色调色板（装饰性插画色，非主题 token）。
 * 命名常量统一管理，避免魔法 hex 散落与重复 find-replace。
 */
const CHARACTER_COLORS = {
    purple: '#6C3FF5',
    black: '#2D2D2D',
    orange: '#FF9B6B',
    yellow: '#E8D754',
    pupil: '#2D2D2D',
} as const

/**
 * 角色带 lean 计算：身体 skew + 脸部偏移跟随鼠标。
 * 通过 useCachedRect 在 mount 时读取一次矩形（而非每次 render 读），
 * 避免 high-freq mousemove 路径上触发 layout thrashing。
 * mouse 为中性（移动端 / 首次渲染）时保持中立，不误朝屏幕原点。
 */
function useLean(ref: React.RefObject<HTMLDivElement | null>, mouse: MousePos) {
    const rect = useCachedRect(ref)
    if (!rect) return { faceX: 0, faceY: 0, skew: 0 }
    if (mouse.x === 0 && mouse.y === 0) return { faceX: 0, faceY: 0, skew: 0 }
    const dx = mouse.x - (rect.left + rect.width / 2)
    const dy = mouse.y - (rect.top + rect.height / 3)
    return {
        faceX: Math.max(-15, Math.min(15, dx / 20)),
        faceY: Math.max(-10, Math.min(10, dy / 30)),
        skew: Math.max(-6, Math.min(6, -dx / 120)),
    }
}

/**
 * 登录页底部 4 角色带：紫(高矩形) / 黑(高瘦) / 橙(半圆) / 黄(高瘦带嘴)。
 * - 随机眨眼 / typing 对视 / peek 偷瞄 状态机由 useCharacterAnimation 驱动
 * - PC 上身体 skew + 瞳孔跟随鼠标（单一 mouse 源由 useMouseLook 提供）；
 *   移动端 mouse 为中性，角色保持中立朝向
 * - 偷瞄 / 对视时瞳孔走 forceLook 分支强制朝向
 */
export function CharacterBand({ peek, hasToken, typing }: CharacterBandProps) {
    const { isPurplePeeking, isPurpleBlinking, isBlackBlinking, isLookingAtEachOther } =
        useCharacterAnimation({ peek, hasToken, typing })

    // 单一鼠标源（rAF 节流，仅 PC）；移动端返回中性，角色保持中立
    const mouse = useMouseLook()

    const purpleRef = useRef<HTMLDivElement>(null)
    const blackRef = useRef<HTMLDivElement>(null)
    const yellowRef = useRef<HTMLDivElement>(null)
    const orangeRef = useRef<HTMLDivElement>(null)

    const purple = useLean(purpleRef, mouse)
    const black = useLean(blackRef, mouse)
    const yellow = useLean(yellowRef, mouse)
    const orange = useLean(orangeRef, mouse)

    // 偷瞄/对视时瞳孔强制朝向（朝上 = 负 Y，指向舞台上方/输入框）
    const peeking = peek && hasToken
    const purpleForce = peeking
        ? { x: isPurplePeeking ? 4 : -4, y: isPurplePeeking ? -5 : 4 }
        : isLookingAtEachOther
            ? { x: 3, y: 4 }
            : undefined
    const blackForce = peeking
        ? { x: -4, y: 4 }
        : isLookingAtEachOther
            ? { x: 0, y: -4 }
            : undefined
    const dotForce = peeking ? { x: -5, y: 4 } : undefined

    return (
        <div className="w-full flex justify-center overflow-hidden">
            {/* 等比缩放：origin-bottom 保持角色脚不飘；PC 用原尺寸，仅移动端缩小 */}
            <div className="origin-bottom max-[480px]:scale-[0.7] max-[380px]:scale-[0.55]">
                <div className="relative" style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}>
                {/* 紫色高矩形 - 最后层（tall，从橙角色后探出上半部） */}
                <div
                    ref={purpleRef}
                    className="absolute bottom-0 transition-all duration-700 ease-in-out"
                    style={{
                        left: '70px',
                        width: '180px',
                        height: '400px',
                        backgroundColor: CHARACTER_COLORS.purple,
                        borderRadius: '10px 10px 0 0',
                        zIndex: 1,
                        transform: peeking ? 'skewX(0deg)' : `skewX(${purple.skew}deg)`,
                        transformOrigin: 'bottom center',
                    }}
                >
                    <div
                        className="absolute flex gap-8 transition-all duration-700 ease-in-out"
                        style={{ left: peeking ? 20 : 45 + purple.faceX, top: peeking ? 55 : 40 + purple.faceY }}
                    >
                        <EyeBall
                            mouse={mouse}
                            size={18}
                            pupilSize={7}
                            maxDistance={5}
                            pupilColor={CHARACTER_COLORS.pupil}
                            isBlinking={isPurpleBlinking}
                            forceLookX={purpleForce?.x}
                            forceLookY={purpleForce?.y}
                        />
                        <EyeBall
                            mouse={mouse}
                            size={18}
                            pupilSize={7}
                            maxDistance={5}
                            pupilColor={CHARACTER_COLORS.pupil}
                            isBlinking={isPurpleBlinking}
                            forceLookX={purpleForce?.x}
                            forceLookY={purpleForce?.y}
                        />
                    </div>
                </div>

                {/* 黑色高瘦 - 中层 */}
                <div
                    ref={blackRef}
                    className="absolute bottom-0 transition-all duration-700 ease-in-out"
                    style={{
                        left: '240px',
                        width: '120px',
                        height: '310px',
                        backgroundColor: CHARACTER_COLORS.black,
                        borderRadius: '8px 8px 0 0',
                        zIndex: 2,
                        transform: peeking ? 'skewX(0deg)' : `skewX(${black.skew * (isLookingAtEachOther ? 1.5 : 1)}deg)`,
                        transformOrigin: 'bottom center',
                    }}
                >
                    <div
                        className="absolute flex gap-6 transition-all duration-700 ease-in-out"
                        style={{ left: peeking ? 10 : 26 + black.faceX, top: peeking ? 48 : 32 + black.faceY }}
                    >
                        <EyeBall
                            mouse={mouse}
                            size={16}
                            pupilSize={6}
                            maxDistance={4}
                            pupilColor={CHARACTER_COLORS.pupil}
                            isBlinking={isBlackBlinking}
                            forceLookX={blackForce?.x}
                            forceLookY={blackForce?.y}
                        />
                        <EyeBall
                            mouse={mouse}
                            size={16}
                            pupilSize={6}
                            maxDistance={4}
                            pupilColor={CHARACTER_COLORS.pupil}
                            isBlinking={isBlackBlinking}
                            forceLookX={blackForce?.x}
                            forceLookY={blackForce?.y}
                        />
                    </div>
                </div>

                {/* 橙色半圆 - 前左 */}
                <div
                    ref={orangeRef}
                    className="absolute bottom-0 transition-all duration-700 ease-in-out"
                    style={{
                        left: '0px',
                        width: '240px',
                        height: '200px',
                        backgroundColor: CHARACTER_COLORS.orange,
                        borderRadius: '120px 120px 0 0',
                        zIndex: 3,
                        transform: peeking ? 'skewX(0deg)' : `skewX(${orange.skew}deg)`,
                        transformOrigin: 'bottom center',
                    }}
                >
                    <div
                        className="absolute flex gap-8 transition-all duration-200 ease-out"
                        style={{ left: peeking ? 50 : 82 + orange.faceX, top: peeking ? 105 : 90 + orange.faceY }}
                    >
                        <Pupil
                            mouse={mouse}
                            size={12}
                            maxDistance={5}
                            pupilColor={CHARACTER_COLORS.pupil}
                            forceLookX={dotForce?.x}
                            forceLookY={dotForce?.y}
                        />
                        <Pupil
                            mouse={mouse}
                            size={12}
                            maxDistance={5}
                            pupilColor={CHARACTER_COLORS.pupil}
                            forceLookX={dotForce?.x}
                            forceLookY={dotForce?.y}
                        />
                    </div>
                </div>

                {/* 黄色高瘦 - 前右 */}
                <div
                    ref={yellowRef}
                    className="absolute bottom-0 transition-all duration-700 ease-in-out"
                    style={{
                        left: '310px',
                        width: '140px',
                        height: '230px',
                        backgroundColor: CHARACTER_COLORS.yellow,
                        borderRadius: '70px 70px 0 0',
                        zIndex: 4,
                        transform: peeking ? 'skewX(0deg)' : `skewX(${yellow.skew}deg)`,
                        transformOrigin: 'bottom center',
                    }}
                >
                    <div
                        className="absolute flex gap-6 transition-all duration-200 ease-out"
                        style={{ left: peeking ? 20 : 52 + yellow.faceX, top: peeking ? 55 : 40 + yellow.faceY }}
                    >
                        <Pupil
                            mouse={mouse}
                            size={12}
                            maxDistance={5}
                            pupilColor={CHARACTER_COLORS.pupil}
                            forceLookX={dotForce?.x}
                            forceLookY={dotForce?.y}
                        />
                        <Pupil
                            mouse={mouse}
                            size={12}
                            maxDistance={5}
                            pupilColor={CHARACTER_COLORS.pupil}
                            forceLookX={dotForce?.x}
                            forceLookY={dotForce?.y}
                        />
                    </div>
                    <div
                        className="absolute w-20 h-1 rounded-full transition-all duration-200 ease-out"
                        style={{
                            left: peeking ? 10 : 40 + yellow.faceX,
                            top: peeking ? 88 : 88 + yellow.faceY,
                            backgroundColor: CHARACTER_COLORS.pupil,
                        }}
                    />
                </div>
                </div>
            </div>
        </div>
    )
}
