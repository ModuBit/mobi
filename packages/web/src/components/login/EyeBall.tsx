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
import { useEffect, useRef, useState } from 'react'

interface PupilProps {
    size?: number
    maxDistance?: number
    pupilColor?: string
    forceLookX?: number
    forceLookY?: number
}

/** 纯瞳孔（橙色/黄色角色用，无眼白） */
export function Pupil({
    size = 12,
    maxDistance = 5,
    pupilColor = 'black',
    forceLookX,
    forceLookY,
}: PupilProps) {
    const [mouse, setMouse] = useState({ x: 0, y: 0 })
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handler = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY })
        window.addEventListener('mousemove', handler)
        return () => window.removeEventListener('mousemove', handler)
    }, [])

    const pos = (() => {
        if (!ref.current) return { x: 0, y: 0 }
        if (forceLookX !== undefined && forceLookY !== undefined) {
            return { x: forceLookX, y: forceLookY }
        }
        const r = ref.current.getBoundingClientRect()
        const dx = mouse.x - (r.left + r.width / 2)
        const dy = mouse.y - (r.top + r.height / 2)
        const dist = Math.min(Math.hypot(dx, dy), maxDistance)
        const angle = Math.atan2(dy, dx)
        return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist }
    })()

    return (
        <div
            ref={ref}
            className='rounded-full'
            style={{
                width: `${size}px`,
                height: `${size}px`,
                backgroundColor: pupilColor,
                transform: `translate(${pos.x}px, ${pos.y}px)`,
                transition: 'transform 0.1s ease-out',
            }}
        />
    )
}

interface EyeBallProps {
    size?: number
    pupilSize?: number
    maxDistance?: number
    eyeColor?: string
    pupilColor?: string
    isBlinking?: boolean
    forceLookX?: number
    forceLookY?: number
}

/** 眼白 + 瞳孔（紫色/黑色角色用） */
export function EyeBall({
    size = 48,
    pupilSize = 16,
    maxDistance = 10,
    eyeColor = 'white',
    pupilColor = 'black',
    isBlinking = false,
    forceLookX,
    forceLookY,
}: EyeBallProps) {
    const [mouse, setMouse] = useState({ x: 0, y: 0 })
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handler = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY })
        window.addEventListener('mousemove', handler)
        return () => window.removeEventListener('mousemove', handler)
    }, [])

    const pos = (() => {
        if (!ref.current) return { x: 0, y: 0 }
        if (forceLookX !== undefined && forceLookY !== undefined) {
            return { x: forceLookX, y: forceLookY }
        }
        const r = ref.current.getBoundingClientRect()
        const dx = mouse.x - (r.left + r.width / 2)
        const dy = mouse.y - (r.top + r.height / 2)
        const dist = Math.min(Math.hypot(dx, dy), maxDistance)
        const angle = Math.atan2(dy, dx)
        return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist }
    })()

    return (
        <div
            ref={ref}
            className='rounded-full flex items-center justify-center transition-all duration-150'
            style={{
                width: `${size}px`,
                height: isBlinking ? '2px' : `${size}px`,
                backgroundColor: eyeColor,
                overflow: 'hidden',
            }}
        >
            {!isBlinking && (
                <div
                    className='rounded-full'
                    style={{
                        width: `${pupilSize}px`,
                        height: `${pupilSize}px`,
                        backgroundColor: pupilColor,
                        transform: `translate(${pos.x}px, ${pos.y}px)`,
                        transition: 'transform 0.1s ease-out',
                    }}
                />
            )}
        </div>
    )
}
