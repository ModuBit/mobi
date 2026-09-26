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
 * 需要用户介入的状态反馈（声音 + 移动端震动）。
 *
 * 监听对象是「会话状态转换」而非具体事件（2026-09-26 定稿）：
 * - 输出完成等待输入：running true→false（hub Ready 通知有 60s 冷却，快速连续
 *   对话会漏；状态转换每轮都发生，不依赖 hub 防抖/冷却）
 * - 等待审批/AskUserQuestion：pendingRequests 0→N（AskUserQuestion 也走 permission
 *   request 通道，天然合并覆盖）
 *
 * 首次见到的 session 只记基线不触发——页面加载 / SSE 重连对账会把「已在等待」的
 * 状态重放过来，没有基线就无法区分「新到达的等待」与「早就存在的等待」。
 *
 * 声音走 WebAudio 合成（OscillatorNode + gain 包络），零音频资产；
 * 震动走 Vibration API——仅 Android Chrome 支持，iOS Safari（含主屏 PWA）不支持，
 * iOS 上降级为只有声音（系统级震动静候系统通知自己的行为，不在此处兜）。
 */

import { derivePendingRequestsCount } from '@/core/lib/pendingRequests'

/** 反馈类型：ready=输出完成等待输入；pending=等待审批/提问 */
export type AttentionKind = 'ready' | 'pending'

/** 转换检测所需的会话状态快照（取 session 全量字段的最小交集） */
export interface AttentionSnapshot {
    active: boolean
    running: boolean
    pendingCount: number
}

/**
 * 对比前后快照，返回需要反馈的类型；无需反馈返回 null。
 * pending 优先于 ready：审批到达的同帧 running 也可能翻转（CLI 在请求处停下），
 * 「需要你行动」的语义比「完成了」更高。
 */
export function diffAttentionTransition(prev: AttentionSnapshot, next: AttentionSnapshot): AttentionKind | null {
    if (!next.active) return null
    if (prev.pendingCount === 0 && next.pendingCount > 0) return 'pending'
    if (prev.running && !next.running) return 'ready'
    return null
}

/**
 * session-updated 增量载荷：只带部分字段，与基线归并（缺省字段沿用旧值）。
 * 完整 session 载荷（delta.id === sessionId）与纯增量在此统一处理——两者都只取
 * active / running / agentState(pendingRequestsCount) 三个语义字段。
 */
function mergeSnapshot(
    prev: AttentionSnapshot | undefined,
    delta: Record<string, unknown>,
): AttentionSnapshot {
    const base: AttentionSnapshot = prev ?? { active: true, running: false, pendingCount: 0 }
    return {
        active: typeof delta.active === 'boolean' ? delta.active : base.active,
        running: typeof delta.running === 'boolean' ? delta.running : base.running,
        pendingCount: 'agentState' in delta
            ? derivePendingRequestsCount(delta.agentState)
            : typeof delta.pendingRequestsCount === 'number'
                ? delta.pendingRequestsCount
                : base.pendingCount,
    }
}

/** 各会话的最近一次状态快照（模块级：与 SSE 连接同生命周期，跨组件稳定） */
const ATTENTION_STATE = new Map<string, AttentionSnapshot>()

/**
 * 喂入一次 session-updated 载荷，返回该会话是否触发了反馈类型。
 * 未知会话只记基线（返回 null）；内部传播有状态更新，副作用集中在此处。
 */
export function trackAttentionTransition(
    sessionId: string,
    delta: unknown,
): AttentionKind | null {
    if (!delta || typeof delta !== 'object') return null
    const prev = ATTENTION_STATE.get(sessionId)
    const next = mergeSnapshot(prev, delta as Record<string, unknown>)
    ATTENTION_STATE.set(sessionId, next)
    if (!prev) return null
    return diffAttentionTransition(prev, next)
}

/** 会话删除时清理基线，防 Map 随会话增删无界增长 */
export function clearAttentionState(sessionId: string): void {
    ATTENTION_STATE.delete(sessionId)
}

/** 登出时全量清理，避免换号继承上一用户状态 */
export function clearAllAttentionStates(): void {
    ATTENTION_STATE.clear()
}

// ==================== 声音（WebAudio 合成） ====================

let audioCtx: AudioContext | null = null

/**
 * 惰性获取并解锁 AudioContext。
 * 浏览器 autoplay 策略要求用户手势后才能出声：首次 pointerdown（捕获阶段，
 * 抢在任何组件 stopPropagation 之前）预热 context；此后每次播放前再 attempt
 * resume 兜底（iOS 后台回前台可能重新挂起），失败静默。
 */
function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    if (!audioCtx) {
        audioCtx = new Ctor()
        document.addEventListener('pointerdown', () => {
            void audioCtx?.resume().catch(() => {})
        }, { once: true, capture: true })
    }
    if (audioCtx.state === 'suspended') {
        void audioCtx.resume().catch(() => {})
    }
    return audioCtx
}

/** 单个合成音：attack 5ms + 指数衰减包络，避免方波起止的「咔哒」爆音 */
function playTone(ctx: AudioContext, opts: {
    freq: number
    /** 相对 ctx.currentTime 的起始偏移（秒） */
    startAt: number
    duration: number
    volume: number
}): void {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const t0 = ctx.currentTime + opts.startAt
    osc.type = 'sine'
    osc.frequency.setValueAtTime(opts.freq, t0)
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(opts.volume, t0 + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + opts.duration + 0.02)
}

/**
 * 播放反馈音。两类事件的听感区分（方向对偶语义）：
 * - ready：下行双音「叮-咚」（1319 → 1046Hz，落定感 = 完成了）
 * - pending：上行双音「叮-叮」（880 → 1319Hz，渐强 = 需要你行动）
 */
function playSound(kind: AttentionKind): void {
    const ctx = getAudioContext()
    if (!ctx || ctx.state !== 'running') return
    if (kind === 'ready') {
        playTone(ctx, { freq: 1318.5, startAt: 0, duration: 0.12, volume: 0.22 })
        playTone(ctx, { freq: 1046.5, startAt: 0.1, duration: 0.2, volume: 0.2 })
    } else {
        playTone(ctx, { freq: 880, startAt: 0, duration: 0.09, volume: 0.32 })
        playTone(ctx, { freq: 1318.5, startAt: 0.12, duration: 0.14, volume: 0.35 })
    }
}

// ==================== 震动（Vibration API） ====================

/**
 * 震动反馈。pattern 与声音同构（pending 双脉冲更急）；
 * iOS Safari / 主屏 PWA 无 navigator.vibrate，静默降级为仅声音。
 */
function vibrate(kind: AttentionKind): void {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    try {
        navigator.vibrate(kind === 'ready' ? [80] : [120, 80, 120])
    } catch {
        // 某些环境 vibrate 存在但调用抛错（权限/无振动器），静默
    }
}

/** 对外入口：按类型同时给声音 + 震动（各自独立降级，互不阻塞） */
export function notifyAttention(kind: AttentionKind): void {
    try {
        playSound(kind)
    } catch {
        // 音频环境异常（无声卡/WebAudio 不可用）不影响震动
    }
    vibrate(kind)
}
