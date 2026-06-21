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
import { useRef, useState, useEffect } from 'react'
import { EyeBall, Pupil } from './EyeBall'
import { useCharacterAnimation } from './useCharacterAnimation'

export interface CharacterBandProps {
    /** token 明文可见 */
    peek: boolean
    /** token 非空 */
    hasToken: boolean
    /** 正在输入 */
    typing: boolean
}

const STAGE_WIDTH = 450
const STAGE_HEIGHT = 280

/**
 * 角色带 lean 计算：身体 skew + 脸部偏移跟随鼠标。
 * 移动端无 mousemove，mouse 保持初始 0，角色默认朝上指向输入框。
 */
function lean(ref: React.RefObject<HTMLDivElement | null>, mouse: { x: number; y: number }) {
    if (!ref.current) return { faceX: 0, faceY: 0, skew: 0 }
    const r = ref.current.getBoundingClientRect()
    const dx = mouse.x - (r.left + r.width / 2)
    const dy = mouse.y - (r.top + r.height / 3)
    return {
        faceX: Math.max(-15, Math.min(15, dx / 20)),
        faceY: Math.max(-10, Math.min(10, dy / 30)),
        skew: Math.max(-6, Math.min(6, -dx / 120)),
    }
}

/**
 * 登录页底部 4 角色带：紫(矮胖) / 黑(高瘦) / 橙(半圆) / 黄(高瘦带嘴)。
 * - 随机眨眼 / typing 对视 / peek 偷瞄 状态机由 useCharacterAnimation 驱动
 * - PC 上身体 skew + 瞳孔跟随鼠标；移动端默认朝上指向输入框
 * - 偷瞄 / 对视时瞳孔走 forceLook 分支强制朝向
 */
export function CharacterBand({ peek, hasToken, typing }: CharacterBandProps) {
    const { isPurplePeeking, isPurpleBlinking, isBlackBlinking, isLookingAtEachOther } =
        useCharacterAnimation({ peek, hasToken, typing })

    // 鼠标跟随（PC）；移动端无 mousemove，pos 保持初始 0，角色默认朝上指向舞台上方/输入框
    const [mouse, setMouse] = useState({ x: 0, y: 0 })
    useEffect(() => {
        const handler = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY })
        window.addEventListener('mousemove', handler)
        return () => window.removeEventListener('mousemove', handler)
    }, [])

    const purpleRef = useRef<HTMLDivElement>(null)
    const blackRef = useRef<HTMLDivElement>(null)
    const yellowRef = useRef<HTMLDivElement>(null)
    const orangeRef = useRef<HTMLDivElement>(null)

    const purple = lean(purpleRef, mouse)
    const black = lean(blackRef, mouse)
    const yellow = lean(yellowRef, mouse)
    const orange = lean(orangeRef, mouse)

    // 偷瞄/对视时瞳孔强制朝向（朝上 = 负 Y，指向舞台上方/输入框）
    const peeking = peek && hasToken
    const purpleForce = peeking
        ? { x: isPurplePeeking ? 4 : -4, y: isPurplePeeking ? -5 : -4 }
        : isLookingAtEachOther
            ? { x: 3, y: 4 }
            : undefined
    const blackForce = peeking
        ? { x: -4, y: -4 }
        : isLookingAtEachOther
            ? { x: 0, y: -4 }
            : undefined
    const dotForce = peeking ? { x: -5, y: -4 } : undefined

    return (
        <div className="w-full flex justify-center overflow-hidden">
            {/* 窄屏等比缩放：origin-bottom 保持角色脚不飘；max-[480px]/max-[380px] 为 tailwind v4 任意值断点 */}
            <div className="origin-bottom max-[480px]:scale-[0.7] max-[380px]:scale-[0.55]">
                <div className="relative" style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}>
                {/* 紫色矮胖 - 最后层 */}
                <div
                    ref={purpleRef}
                    className="absolute bottom-0 transition-all duration-700 ease-in-out"
                    style={{
                        left: '120px',
                        width: '120px',
                        height: '200px',
                        backgroundColor: '#7C5CFF',
                        borderRadius: '16px 16px 0 0',
                        zIndex: 1,
                        transform: `skewX(${purple.skew}deg)`,
                        transformOrigin: 'bottom center',
                    }}
                >
                    <div
                        className="absolute flex gap-5 transition-all duration-700 ease-in-out"
                        style={{ left: 28 + purple.faceX, top: 40 + purple.faceY }}
                    >
                        <EyeBall
                            size={18}
                            pupilSize={7}
                            maxDistance={5}
                            pupilColor="#2D2D2D"
                            isBlinking={isPurpleBlinking}
                            forceLookX={purpleForce?.x}
                            forceLookY={purpleForce?.y}
                        />
                        <EyeBall
                            size={18}
                            pupilSize={7}
                            maxDistance={5}
                            pupilColor="#2D2D2D"
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
                        backgroundColor: '#2D2D2D',
                        borderRadius: '8px 8px 0 0',
                        zIndex: 2,
                        transform: `skewX(${black.skew * (isLookingAtEachOther ? 1.5 : 1)}deg)`,
                        transformOrigin: 'bottom center',
                    }}
                >
                    <div
                        className="absolute flex gap-6 transition-all duration-700 ease-in-out"
                        style={{ left: 26 + black.faceX, top: 32 + black.faceY }}
                    >
                        <EyeBall
                            size={16}
                            pupilSize={6}
                            maxDistance={4}
                            pupilColor="#2D2D2D"
                            isBlinking={isBlackBlinking}
                            forceLookX={blackForce?.x}
                            forceLookY={blackForce?.y}
                        />
                        <EyeBall
                            size={16}
                            pupilSize={6}
                            maxDistance={4}
                            pupilColor="#2D2D2D"
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
                        backgroundColor: '#FF9B6B',
                        borderRadius: '120px 120px 0 0',
                        zIndex: 3,
                        transform: `skewX(${orange.skew}deg)`,
                        transformOrigin: 'bottom center',
                    }}
                >
                    <div
                        className="absolute flex gap-8 transition-all duration-200 ease-out"
                        style={{ left: 82 + orange.faceX, top: 90 + orange.faceY }}
                    >
                        <Pupil
                            size={12}
                            maxDistance={5}
                            pupilColor="#2D2D2D"
                            forceLookX={dotForce?.x}
                            forceLookY={dotForce?.y}
                        />
                        <Pupil
                            size={12}
                            maxDistance={5}
                            pupilColor="#2D2D2D"
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
                        backgroundColor: '#E8D754',
                        borderRadius: '70px 70px 0 0',
                        zIndex: 4,
                        transform: `skewX(${yellow.skew}deg)`,
                        transformOrigin: 'bottom center',
                    }}
                >
                    <div
                        className="absolute flex gap-6 transition-all duration-200 ease-out"
                        style={{ left: 52 + yellow.faceX, top: 40 + yellow.faceY }}
                    >
                        <Pupil
                            size={12}
                            maxDistance={5}
                            pupilColor="#2D2D2D"
                            forceLookX={dotForce?.x}
                            forceLookY={dotForce?.y}
                        />
                        <Pupil
                            size={12}
                            maxDistance={5}
                            pupilColor="#2D2D2D"
                            forceLookX={dotForce?.x}
                            forceLookY={dotForce?.y}
                        />
                    </div>
                    <div
                        className="absolute w-20 h-1 rounded-full transition-all duration-200 ease-out"
                        style={{
                            left: 40 + yellow.faceX,
                            top: 88 + yellow.faceY,
                            backgroundColor: '#2D2D2D',
                        }}
                    />
                </div>
                </div>
            </div>
        </div>
    )
}
