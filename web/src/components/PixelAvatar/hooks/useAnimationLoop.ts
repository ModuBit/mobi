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

import { useRef, useEffect, type RefObject } from 'react';
import type { AgentStatus, CharacterSprite } from '../types';
import { ANIMATIONS } from '../sprites/animations';
import { SpriteRenderer } from '../sprites/renderer';

// 单例 rAF 循环：所有头像共享一个 requestAnimationFrame
const listeners = new Set<() => void>();
let rafId: number | null = null;

function tick() {
    for (const fn of listeners) fn();
    rafId = requestAnimationFrame(tick);
}

function startLoop() {
    if (rafId === null) {
        rafId = requestAnimationFrame(tick);
    }
}

function stopLoop() {
    if (rafId !== null && listeners.size === 0) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

/**
 * 管理 Canvas renderer 生命周期和动画循环
 * 内部创建/销毁 SpriteRenderer，status 变化通过 ref 读取不触发重订阅
 */
export function useAnimationLoop(
    canvasRef: RefObject<HTMLCanvasElement | null>,
    character: CharacterSprite,
    status: AgentStatus,
    size: number,
) {
    const frameIndex = useRef(0);
    const lastFrameTime = useRef(0);
    const statusRef = useRef(status);
    statusRef.current = status;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const renderer = new SpriteRenderer(canvas, character, size);
        frameIndex.current = 0;
        lastFrameTime.current = 0;

        const animate = () => {
            const now = performance.now();
            const anim = ANIMATIONS[statusRef.current];
            if (now - lastFrameTime.current >= anim.interval) {
                const diffs = anim.frames[frameIndex.current];
                if (diffs && diffs.length > 0) {
                    renderer.renderFrame(diffs);
                } else {
                    renderer.renderFrame();
                }
                frameIndex.current = (frameIndex.current + 1) % anim.frames.length;
                lastFrameTime.current = now;
            }
        };

        listeners.add(animate);
        startLoop();
        renderer.renderFrame();

        return () => {
            listeners.delete(animate);
            stopLoop();
            renderer.destroy();
        };
    }, [canvasRef, character, size]);
}
