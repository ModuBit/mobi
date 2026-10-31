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

/**
 * 单例动画调度器：所有头像共享一个 timer。
 *
 * 旧实现是 requestAnimationFrame 逐帧循环、回调内按 anim.interval 节流绘制——
 * 循环本身每帧唤醒，只要页面有头像挂载就恒定 60 次/秒空转，实测静置单核 ~16%
 * （2026-10-31）。现改为按需调度：每次 tick 各 listener 返回「距下次回调的 ms」，
 * 调度器取最小值 setTimeout 睡眠——idle(350ms) ~3 次/秒、outputting(120ms)
 * ~8 次/秒，像素帧动画语义下视觉无差异。setTimeout 在后台 tab 会被浏览器限流
 * （约 1Hz），装饰性动画正好顺势降频；回前台时 wakeUp 立即重排消除滞后。
 */
type AnimationListener = () => number;
const listeners = new Set<AnimationListener>();
let timeoutId: ReturnType<typeof setTimeout> | null = null;

function tick() {
    timeoutId = null;
    let minDelay = Infinity;
    for (const fn of listeners) {
        // 单听者异常隔离：渲染器抛错（canvas 上下文丢失等）一不得沿同步调用链炸进
        // React effect 树（status effect → wakeUp → tick，会把整棵应用树换成本地兜底页），
        // 二不得中断循环拖停其余头像、或跳过 schedule 使全局动画永久停摆——
        // 抛错者按「本轮不参与」处理，调度照常续命
        try {
            const delay = fn();
            if (delay < minDelay) minDelay = delay;
        } catch (e) {
            console.error('[pixel-avatar] animation listener failed', e);
        }
    }
    if (minDelay < Infinity) schedule(minDelay);
}

function schedule(delay: number) {
    timeoutId = setTimeout(tick, Math.max(0, delay));
}

function startLoop() {
    // 排一个立即 tick 而非同步执行：订阅方（hook effect）在 startLoop 之后才画基线帧，
    // 同步 tick 会先画第 1 帧 diff 再被基线覆盖（帧索引已推进，画面错位一帧）
    if (timeoutId === null) schedule(0);
}

function stopLoop() {
    if (timeoutId !== null && listeners.size === 0) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
}

/** 唤醒：丢弃当前睡眠立即重排——status 变化提速、页面回前台消除后台限流滞后 */
function wakeUp() {
    if (timeoutId === null) return;
    clearTimeout(timeoutId);
    tick();
}

// 页面回前台：后台被限流的睡眠最长可滞后 ~1s，回来立即重排
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) wakeUp();
    });
}

/**
 * 管理 Canvas renderer 生命周期和动画循环
 * 内部创建/销毁 SpriteRenderer，status 变化通过 ref 读取不触发重订阅
 *
 * @param enabled 动画开关（调用方 prop，默认 false）：false 时不进循环，仅渲染静态
 * 形象（staticLayer = 身体+服装+脸+眼的完整基础形象）；切换时经 effect 重跑在
 * 静态帧与动画间无缝过渡
 */
export function useAnimationLoop(
    canvasRef: RefObject<HTMLCanvasElement | null>,
    character: CharacterSprite,
    status: AgentStatus,
    size: number,
    enabled: boolean = false,
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

        // 返回距下次回调的 ms（调度器取所有头像的最小值安排下一次 tick）
        const animate = (): number => {
            const now = performance.now();
            const anim = ANIMATIONS[statusRef.current];
            const elapsed = now - lastFrameTime.current;
            if (elapsed < anim.interval) return anim.interval - elapsed;
            const diffs = anim.frames[frameIndex.current];
            if (diffs && diffs.length > 0) {
                renderer.renderFrame(diffs);
            } else {
                renderer.renderFrame();
            }
            frameIndex.current = (frameIndex.current + 1) % anim.frames.length;
            lastFrameTime.current = now;
            return anim.interval;
        };

        if (enabled) {
            listeners.add(animate);
            startLoop();
        }
        // 初始静态帧：开动画时是第一帧的基线（diffs 叠加其上），关闭时就是最终呈现
        renderer.renderFrame();

        return () => {
            listeners.delete(animate);
            stopLoop();
            renderer.destroy();
        };
    }, [canvasRef, character, size, enabled]);

    // status 变化（如 idle→outputting 提速）：长睡眠中不会自然提前，唤醒立即按新 interval 重排
    useEffect(() => {
        wakeUp();
    }, [status]);
}
