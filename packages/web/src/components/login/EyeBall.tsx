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
import { computeLookOffset, useCachedRect, type MousePos } from './useMouseLook'

interface PupilProps {
    /** 鼠标位置（由 CharacterBand 单源下发） */
    mouse: MousePos
    size?: number
    maxDistance?: number
    pupilColor?: string
    forceLookX?: number
    forceLookY?: number
}

/** 纯瞳孔（橙色/黄色角色用，无眼白） */
export function Pupil({
    mouse,
    size = 12,
    maxDistance = 5,
    pupilColor = 'black',
    forceLookX,
    forceLookY,
}: PupilProps) {
    const ref = useRef<HTMLDivElement>(null)
    const rect = useCachedRect(ref)
    const pos = rect
        ? computeLookOffset(rect, mouse, maxDistance, forceLookX, forceLookY)
        : { x: 0, y: 0 }

    return (
        <div
            ref={ref}
            className="rounded-full"
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
    mouse: MousePos
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
    mouse,
    size = 48,
    pupilSize = 16,
    maxDistance = 10,
    eyeColor = 'white',
    pupilColor = 'black',
    isBlinking = false,
    forceLookX,
    forceLookY,
}: EyeBallProps) {
    const ref = useRef<HTMLDivElement>(null)
    const rect = useCachedRect(ref)
    const pos = rect
        ? computeLookOffset(rect, mouse, maxDistance, forceLookX, forceLookY)
        : { x: 0, y: 0 }

    return (
        <div
            ref={ref}
            className="rounded-full flex items-center justify-center transition-all duration-150"
            style={{
                width: `${size}px`,
                height: isBlinking ? '2px' : `${size}px`,
                backgroundColor: eyeColor,
                overflow: 'hidden',
            }}
        >
            {!isBlinking && (
                <div
                    className="rounded-full"
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
