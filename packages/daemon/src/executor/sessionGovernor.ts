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
 * SessionGovernor（迭代二票 2.1）：daemon 侧会话进程数的全局预算闸——
 * spawn 会话子进程前的资源门槛（borrow Claude Desktop CliGovernor，映射到
 * mobi 两级拓扑后治理面在 daemon；判定面仍留会话进程本地，见 dormancy spec）。
 *
 * 记账模型（自愈优先，杜绝 slot 泄漏）：
 * - `countActive` 经注入的 {@link SessionGovernorOptions.getActiveCount} 现读
 *   （装配层接 executor 追踪表——进程退出/定时自检自动收缩，Governor 不自持副本）
 * - `inFlight` 只覆盖 spawn 编排窗口（acquire → spawn 结果落定 → release）：
 *   成功时追踪表已登记（active 即时接棒），失败路径 try/finally 兜底释放
 * - `effective = countActive + inFlight`，到顶 **yield**（spawn 方放弃，硬上限不破）
 *
 * 互斥闸：判定与 in-flight 登记在同一同步块（无 await 穿插），JS 单线程下即互斥。
 *
 * reason 分级（'user' | 'warm' | 'prewarm'）：迭代二 spawn 恒为 user；warm/prewarm
 * 留给迭代三预热体系（user 到顶可触发 LRU 逐出，见票 2.2）。
 */

import { totalmem } from 'node:os';
import { logger } from '@mobi/node-core/logger';

/** cap 下限（Desktop 同款：小内存机也保 6 个并发会话） */
export const MIN_SESSION_CAP = 6;

/** 每 3GiB 内存换 1 个会话名额（Desktop asar 实锤：max(6, floor(totalmem/3GiB))） */
const BYTES_PER_SESSION = 3 * 1024 ** 3;

/** Desktop 同款 cap 公式（纯函数，测试断言点） */
export function computeDefaultCap(totalmemBytes: number): number {
    return Math.max(MIN_SESSION_CAP, Math.floor(totalmemBytes / BYTES_PER_SESSION));
}

/**
 * 内存水位分级（纯函数，票 2.2）：系统可用率与治理会话 rss 汇总双口径，
 * 任一口径触发即升级。阈值经验值：会话进程（含 CLI 子进程）常驻数百 MB，
 * rss 汇总 > 70% 时新会话边际收益已低于抖动风险
 */
export function evaluateMemoryPressure(
    freeBytes: number,
    totalBytes: number,
    rssSumBytes: number,
): MemoryPressureLevel {
    if (totalBytes <= 0) return 'normal';
    const freeRatio = freeBytes / totalBytes;
    if (freeRatio < 0.07 || rssSumBytes > totalBytes * 0.85) return 'critical';
    if (freeRatio < 0.15 || rssSumBytes > totalBytes * 0.7) return 'warning';
    return 'normal';
}

/** 受害者最短空闲守卫（Desktop 常量 dp=2 × up=6e4：刚活跃过的会话不逐） */
export const DEFAULT_MIN_VICTIM_IDLE_MS = 120_000;

/** 内存压力扫描节流（Desktop mp=3e5：5 分钟一次） */
export const MEMORY_SCAN_INTERVAL_MS = 5 * 60_000;

/** 内存分级（票 2.2）：normal 无动作；warning 记遥测、拒绝新 prewarm（迭代三接线）；
 *  critical cap 折半（钳下限）+ spare 目标降 0（迭代三接线） */
export type MemoryPressureLevel = 'normal' | 'warning' | 'critical';

/** acquire 方来源分级：user（用户动作）最高优先；warm/prewarm 属预热体系（迭代三） */
export type GovernorAcquireReason = 'user' | 'warm' | 'prewarm';

/** 治理事件（遥测面：结构化日志起步，票 4.2 再扩持久通道） */
export type GovernorEvent =
    | { type: 'governor_yielded'; reason: GovernorAcquireReason; effective: number; cap: number }
    | { type: 'governor_evicting'; sessionId: string; idleMs: number }
    | { type: 'governor_evict_failed'; sessionId: string }
    | { type: 'governor_memory_pressure'; level: MemoryPressureLevel };

/** 逐出候选（Registry 心跳快照投影；Governor 只读不持有） */
export interface GovernorCandidate {
    sessionId: string;
    state: 'active' | 'idle';
    lastActivityAt: number;
    gateBlockers: string[];
    /** 会话控制方向（总纲裁决 #12）：local 仅占名额——不可被逐出、rss 不计汇总 */
    mode?: 'local' | 'remote';
}

/**
 * LRU 受害者选择（纯函数，Desktop peekLruIdleVictim 同款守卫）：
 * 空闲（state=idle）+ 无休眠阻塞（gateBlockers 空）+ 空闲时长 ≥ minVictimIdleMs，
 * 取 lastActivityAt 最小者；无合格者返回 null。
 * turn 运行中（state=active）与 gate 阻塞者天然不可逐。
 */
export function pickLruIdleVictim(
    candidates: GovernorCandidate[],
    now: number,
    minVictimIdleMs: number = DEFAULT_MIN_VICTIM_IDLE_MS,
): string | null {
    let victim: GovernorCandidate | null = null;
    for (const candidate of candidates) {
        if (candidate.state !== 'idle') continue;
        if (candidate.mode === 'local') continue; // 裁决 #12：local 只占名额不逐出
        if (candidate.gateBlockers.length > 0) continue;
        if (now - candidate.lastActivityAt < minVictimIdleMs) continue;
        if (!victim || candidate.lastActivityAt < victim.lastActivityAt) {
            victim = candidate;
        }
    }
    return victim?.sessionId ?? null;
}

export interface SessionGovernorOptions {
    /** 活跃会话进程数（装配层接 executor 追踪表行数；自愈源，Governor 不缓存） */
    getActiveCount: () => number;
    /** 总内存字节（缺省 os.totalmem；测试注入） */
    totalmem?: number;
    /** settings.sessionGovernor.maxActive 覆盖（getter 现读 = 配置热调；同样钳下限） */
    getCapOverride?: () => number | undefined;
    /** 遥测出口（缺省结构化日志） */
    onEvent?: (event: GovernorEvent) => void;
    /** 逐出候选数据面（票 1.2 SessionRegistry.live() 投影；缺省不逐出） */
    getGovernedSessions?: () => GovernorCandidate[];
    /** 逐出动作（pause/governor_evict 单出口；返回 false = 逐出未成） */
    evictSession?: (sessionId: string) => Promise<boolean>;
    /** 内存水位求值（装配层组合 os 水位 + rss 汇总；缺省恒 normal） */
    getMemoryPressure?: () => MemoryPressureLevel;
    /** 时钟（测试注入） */
    now?: () => number;
}

/** acquireSlot 的结果：授予（带一次性 release）或 yield（spawn 方放弃，不破硬上限） */
export type SlotAcquisition =
    | { granted: true; release: () => void }
    | { granted: false };

/** warning→normal 回落所需连续 normal 扫描次数（滞回：5min/次 × 2 = 10min） */
const MEMORY_NORMAL_STREAK = 2;

export class SessionGovernor {
    private readonly getActiveCount: () => number;
    private readonly computedCap: number;
    private readonly getCapOverride?: () => number | undefined;
    private readonly onEvent: (event: GovernorEvent) => void;
    /** 后置接线可覆盖（attachSessionFacts）：private 但非 readonly */
    private getGovernedSessions?: () => GovernorCandidate[];
    private evictSession?: (sessionId: string) => Promise<boolean>;
    private getMemoryPressure?: () => MemoryPressureLevel;
    private readonly now: () => number;
    /** spawn 编排窗口的占位（acquire → release；失败路径由编排 finally 兜底） */
    private readonly inFlight = new Set<symbol>();
    /** 逐出在途集合：fire 后进程退场前，从 effective 扣除（名额即时腾出） */
    private readonly evicting = new Set<string>();
    private currentMemoryLevel: MemoryPressureLevel = 'normal';
    private normalStreak = 0;
    private scanTimer: ReturnType<typeof setInterval> | null = null;

    constructor(options: SessionGovernorOptions) {
        this.getActiveCount = options.getActiveCount;
        this.computedCap = computeDefaultCap(options.totalmem ?? totalmem());
        this.getCapOverride = options.getCapOverride;
        this.onEvent = options.onEvent ?? ((event) => { logger.info(`[GOVERNOR] ${event.type}`, event); });
        this.getGovernedSessions = options.getGovernedSessions;
        this.evictSession = options.evictSession;
        this.getMemoryPressure = options.getMemoryPressure;
        this.now = options.now ?? Date.now;
    }

    /** 当前 cap：override（钳下限）优先，否则公式值；critical 时折半（钳下限） */
    get cap(): number {
        const base = (() => {
            const override = this.getCapOverride?.();
            return override !== undefined ? Math.max(MIN_SESSION_CAP, override) : this.computedCap;
        })();
        return this.currentMemoryLevel === 'critical'
            ? Math.max(MIN_SESSION_CAP, Math.floor(base / 2))
            : base;
    }

    /** 活跃 + 在途 − 逐出在途：预算判定的唯一口径 */
    get effective(): number {
        return this.getActiveCount() + this.inFlight.size - this.evicting.size;
    }

    /** 内存分级当前档（遥测/诊断读；cap 折半由内部消费） */
    get memoryLevel(): MemoryPressureLevel {
        return this.currentMemoryLevel;
    }

    /**
     * 预算闸（spawn 前置位调用）：授予返回一次性 release；到顶 yield 并记遥测。
     * user 到顶先尝试 LRU 逐出（Desktop 同款：仅 user 专属）——受害者经守卫筛选后
     * fire-and-forget 走 pause/governor_evict，evicting 即时扣额、本次授予。
     * 判定与登记同一同步块——并发 acquire 不会双双穿过同一份额度。
     */
    acquireSlot(reason: GovernorAcquireReason): SlotAcquisition {
        if (this.effective >= this.cap) {
            if (reason === 'user' && this.tryEvictOne()) {
                // 名额已腾出，落入下方授予路径
            } else {
                this.onEvent({ type: 'governor_yielded', reason, effective: this.effective, cap: this.cap });
                return { granted: false };
            }
        }
        const token = Symbol('slot');
        this.inFlight.add(token);
        let released = false;
        return {
            granted: true,
            release: () => {
                if (released) return; // 幂等：release 只归还一次
                released = true;
                this.inFlight.delete(token);
            },
        };
    }

    /**
     * 内存压力扫描启动（装配层在注入 getMemoryPressure 后调用；幂等）。
     * 5min 节流（Desktop mp=3e5），分级滞回在 evaluateMemoryPressure 状态机内。
     */
    startMemoryScanning(): void {
        if (this.scanTimer || !this.getMemoryPressure) return;
        this.evaluateMemoryPressure();
        this.scanTimer = setInterval(() => this.evaluateMemoryPressure(), MEMORY_SCAN_INTERVAL_MS);
    }

    stopMemoryScanning(): void {
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = null;
        }
    }

    /**
     * 内存分级状态机（单步；正常由 startMemoryScanning 周期驱动，测试直调）：
     * 上行（normal→warning→critical）立即生效；warning→normal 回落需连续
     * MEMORY_NORMAL_STREAK 次扫描确认（滞回防抖动）；critical→warning 单步即回落
     * （压力缓解方向不滞回，恢复容量优先）。档位变化记遥测。
     */
    evaluateMemoryPressure(): void {
        const level = this.getMemoryPressure?.() ?? 'normal';
        if (level === 'normal') {
            this.normalStreak += 1;
            if (this.currentMemoryLevel !== 'normal' && this.normalStreak >= MEMORY_NORMAL_STREAK) {
                this.currentMemoryLevel = 'normal';
                this.normalStreak = 0;
                this.onEvent({ type: 'governor_memory_pressure', level });
            }
            return;
        }
        this.normalStreak = 0;
        if (level !== this.currentMemoryLevel) {
            this.currentMemoryLevel = level;
            this.onEvent({ type: 'governor_memory_pressure', level });
        }
    }

    /**
     * 会话事实后置接线（票 2.2）：Governor 在 startExecutor 装配（executor 侧），
     * 而 Registry/RPC 网关在 server 侧——server 装配完两者就绪后注入。构造 options
     * 与本方法二选一（测试走构造，生产走后置）；重复 attach 以后者覆盖
     */
    attachSessionFacts(facts: {
        getGovernedSessions: () => GovernorCandidate[];
        evictSession: (sessionId: string) => Promise<boolean>;
        getMemoryPressure: () => MemoryPressureLevel;
    }): void {
        this.getGovernedSessions = facts.getGovernedSessions;
        this.evictSession = facts.evictSession;
        this.getMemoryPressure = facts.getMemoryPressure;
        this.startMemoryScanning();
    }

    /** user 到顶的逐出尝试：选受害者 → evicting 扣额 → fire 逐出。true = 已腾位 */
    private tryEvictOne(): boolean {
        if (!this.getGovernedSessions || !this.evictSession) return false;
        const candidates = this.getGovernedSessions().filter((c) => !this.evicting.has(c.sessionId));
        const victim = pickLruIdleVictim(candidates, this.now());
        if (!victim) return false;

        this.evicting.add(victim);
        this.onEvent({ type: 'governor_evicting', sessionId: victim, idleMs: this.now() - this._victimActivityOf(candidates, victim) });
        void this.evictSession(victim)
            .then((ok) => {
                if (!ok) this.onEvent({ type: 'governor_evict_failed', sessionId: victim });
            })
            .catch(() => this.onEvent({ type: 'governor_evict_failed', sessionId: victim }))
            .finally(() => { this.evicting.delete(victim); });
        return true;
    }

    /** 逐出遥测用的空闲时长（不二次遍历的取值助手） */
    private _victimActivityOf(candidates: GovernorCandidate[], sessionId: string): number {
        return candidates.find((c) => c.sessionId === sessionId)?.lastActivityAt ?? this.now();
    }
}
