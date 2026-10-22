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
 * Idle Manager（泛型空闲管理器，票 1.3 由会话专用计时器抽壳泛型化；类名 IdleTimer
 * 为保留名，会话空闲是它的第一个实例）——资源闲置超时回收的通用时钟。
 *
 * 支持：
 * - 连接断开超时：Socket.IO 断开后独立计时
 * - 交互不活跃超时：无活动事件时计时，超时值支持动态读取（配置热调）
 * - 可见性维度（timeoutOnHidden 能力位）：默认隐藏时暂停空闲计时；开启后隐藏也
 *   继续计时（防后台僵尸）。第一实例（会话空闲）不接线任何可见性信号源——
 *   setHidden 无人调用，行为与抽壳前逐字节一致；mobi desktop 有窗口可见性概念时启用
 */

import { logger } from '@mobi/node-core/logger';

/** 阻塞复查默认周期 */
export const DEFAULT_RECHECK_MS = 30_000;

/**
 * 空闲自检切片上限（毫秒）：长空闲期（生产默认 24h）不押在一发长定时器上。
 * 分片重排把「一次 24h setTimeout」变成「每分钟核对一次已过时长」——定时器一旦静默
 * 丢失（被误清、系统睡眠/时钟跳变、运行时丢弃），下一拍即按 lastActivityAt 补回；
 * 代价是每分钟一次空转。就绪判据与到点语义不变：只有真正到点才过休眠 gate。
 *
 * 2026-10-22 事故背景：多个长跑会话空闲数天不休眠，且 IdleTimer 全程只有 debug
 * 日志（生产不落盘），既看不到「没启动」还是「定时器丢了」——分片 + INFO 落盘
 * 同时补齐自愈与观测两面。
 */
const MAX_IDLE_TICK_MS = 60_000;

export interface IdleTimerOptions {
    /** 实例名（日志/遥测维度；缺省 'idle'——向后兼容会话实例的既有构造） */
    name?: string;
    /** 连接断开超时（毫秒），默认 10 分钟 */
    disconnectTimeoutMs: number;
    /**
     * 交互不活跃超时（毫秒），默认 1 天。支持动态读取（每次排程求值，配置热调
     * 不必重建实例）；传数字等价于恒返回该值
     */
    idleTimeoutMs: number | (() => number);
    /**
     * 空闲到点被休眠 gate 阻塞后的复查判定（dormancy spec）：true = 阻塞事务已清、
     * 触发 onIdleTimeout 退出；false = 继续阻塞。缺省（未提供）= 到点直接退出，行为同旧版。
     */
    onIdleTimeoutBlockedRecheck?: () => boolean;
    /** 阻塞复查周期（毫秒），默认 30 秒 */
    recheckIntervalMs?: number;
    /**
     * 可见性维度能力位（票 1.2 裁决：保留不接线）：false（缺省）= 隐藏期间暂停
     * 空闲计时（进度保留，恢复可见时折算续排并回调 onWarmUp）；true = 隐藏也继续计时
     */
    timeoutOnHidden?: boolean;
    /** 恢复可见（隐藏暂停结束）时回调——预热语义（warm-on-open 同族） */
    onWarmUp?: () => void;
    /** 连接断开超时回调 */
    onDisconnectTimeout: () => void;
    /** 交互不活跃超时回调 */
    onIdleTimeout: () => void;
}

type TimerState = 'stopped' | 'running' | 'blocked';

export class IdleTimer {
    private readonly name: string;
    private readonly disconnectTimeoutMs: number;
    private readonly idleTimeoutMs: number | (() => number);
    private readonly timeoutOnHidden: boolean;
    private readonly onWarmUp?: () => void;
    private readonly onDisconnectTimeout: () => void;
    private readonly onIdleTimeout: () => void;

    private state: TimerState = 'stopped';
    /** 可见性挂起位：hidden 且未开 timeoutOnHidden 时不排空闲计时（进度保留） */
    private isHidden = false;
    /**
     * 最近一次真实活动时刻（start / reset 时推进）。空闲判定的时间戳基准：
     * 排程时按「距上次活动已过多久」折算剩余时间，而非恒排完整空闲期——
     * 否则 daemon 每次重启（断开→重连→重排）都会把倒计时清零，会话永远
     * 攒不满空闲期（2026-10-10 生产实锤：10-07 起空闲的会话因 10-09/10-10
     * 两次 daemon 重启迟迟不休眠）。断开窗口不计活动、但计入空闲进度。
     */
    private lastActivityAt = 0;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private blockedRecheckTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly onIdleTimeoutBlockedRecheck?: () => boolean;
    private readonly recheckIntervalMs: number;
    private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private isDisconnected = false;

    constructor(options: IdleTimerOptions) {
        this.name = options.name ?? 'idle';
        this.disconnectTimeoutMs = options.disconnectTimeoutMs;
        this.idleTimeoutMs = options.idleTimeoutMs;
        this.timeoutOnHidden = options.timeoutOnHidden ?? false;
        this.onWarmUp = options.onWarmUp;
        this.onIdleTimeoutBlockedRecheck = options.onIdleTimeoutBlockedRecheck;
        this.recheckIntervalMs = options.recheckIntervalMs ?? DEFAULT_RECHECK_MS;
        this.onDisconnectTimeout = options.onDisconnectTimeout;
        this.onIdleTimeout = options.onIdleTimeout;
    }

    /**
     * 开始计时（Remote 模式）
     */
    start(): void {
        if (this.state !== 'stopped') {
            return;
        }

        this.state = 'running';
        this.lastActivityAt = Date.now();
        this.scheduleIdleTimers();
        // INFO 落盘（生产不落 debug）：进程生命周期里只此一条——没有它就无法区分
        // 「空闲计时从未启动」与「启动了但一直没到点」
        logger.info(`[IdleTimer] started (idleTimeout=${this.resolveIdleTimeoutMs()}ms, disconnectTimeout=${this.disconnectTimeoutMs}ms)`);
    }

    /**
     * 停止计时（切换到 Local 模式）
     */
    stop(): void {
        this.clearAllTimers();
        this.state = 'stopped';
        this.isDisconnected = false;
        this.isHidden = false;
        logger.debug('[IdleTimer] Stopped');
    }

    /**
     * 重置计时器（有活动时）
     */
    reset(): void {
        if (this.state === 'stopped') {
            return;
        }

        // 如果已断开连接，不重置（断开有独立计时）
        if (this.isDisconnected) {
            return;
        }

        // 阻塞复查状态被用户活动打断 = 重新等一个完整空闲期（清复查定时器后走公共路径）
        if (this.state === 'blocked') {
            this.clearBlockedRecheck();
        }

        this.state = 'running';
        this.lastActivityAt = Date.now();
        this.scheduleIdleTimers();
        logger.debug('[IdleTimer] Reset');
    }

    /**
     * 连接断开时调用
     */
    onDisconnect(): void {
        if (this.state === 'stopped') {
            return;
        }

        // 已在断开窗口内则不重排：断开计时从「首次断开」起算。
        // 断开期间每次重连尝试的 connect_error 都会再次进入这里，若重排会覆盖
        // disconnectTimer 引用——旧计时器泄漏仍在跑，onReconnect 的 clearTimeout
        // 只能清掉最后一个。后果：daemon 重启（deploy）后已成功重连的会话，
        // 仍在首次断开 10 分钟后被泄漏计时器误杀退出（2026-08-22 排查的根因链）。
        if (this.isDisconnected) {
            return;
        }

        this.isDisconnected = true;
        this.clearIdleTimers();

        // 启动断开超时计时器
        this.disconnectTimer = setTimeout(() => {
            this.disconnectTimer = null;
            logger.debug('[IdleTimer] Disconnect timeout reached');
            this.onDisconnectTimeout();
        }, this.disconnectTimeoutMs);

        logger.debug(`[IdleTimer] Disconnected, starting disconnect timer (${this.disconnectTimeoutMs}ms)`);
    }

    /**
     * 重连成功时调用
     */
    onReconnect(): void {
        if (this.state === 'stopped') {
            return;
        }

        this.isDisconnected = false;

        // 清除断开计时器
        if (this.disconnectTimer) {
            clearTimeout(this.disconnectTimer);
            this.disconnectTimer = null;
        }

        // 重排空闲计时——不推进 lastActivityAt：重连不是用户活动，
        // 重连前已累积的空闲进度原样折算进剩余时间（见 lastActivityAt 注释）
        this.scheduleIdleTimers();
        logger.debug('[IdleTimer] Reconnected, restarted idle timers');
    }

    /**
     * 销毁计时器
     */
    destroy(): void {
        this.clearAllTimers();
        this.state = 'stopped';
        this.isDisconnected = false;
        this.isHidden = false;
        logger.debug('[IdleTimer] Destroyed');
    }

    /**
     * 获取当前状态
     */
    getState(): TimerState {
        return this.state;
    }

    /**
     * 最近真实活动时刻（治理快照的 LRU 排序键；stopped 时无意义返回 0）
     */
    getLastActivityAt(): number {
        return this.lastActivityAt;
    }

    /**
     * 是否处于断开状态
     */
    isDisconnectedState(): boolean {
        return this.isDisconnected;
    }

    private scheduleIdleTimers(): void {
        this.clearIdleTimers();

        // 可见性挂起（票 1.3 能力位）：隐藏且未开 timeoutOnHidden 时不排空闲计时——
        // lastActivityAt 不动，恢复可见时按剩余进度折算续排（同重连折算语义）
        if (this.isHidden && !this.timeoutOnHidden) {
            return;
        }

        // 时间戳基准：按「距上次真实活动已过多久」折算剩余时间。
        // 断开窗口（onDisconnect 清计时器 → onReconnect 重排）不重置进度，
        // 已超期则 delay 折算为 0、立即到点（照常过休眠 gate）
        const idleTimeoutMs = this.resolveIdleTimeoutMs();
        const remainingMs = Math.max(0, idleTimeoutMs - (Date.now() - this.lastActivityAt));

        // 长空闲期分片：先睡一个切片再重新核对（见 MAX_IDLE_TICK_MS）
        if (remainingMs > MAX_IDLE_TICK_MS) {
            this.idleTimer = setTimeout(() => {
                this.idleTimer = null;
                this.scheduleIdleTimers();
            }, MAX_IDLE_TICK_MS);
            return;
        }

        // 超时计时器
        this.idleTimer = setTimeout(() => {
            if (this.isDisconnected) {
                // 到点落在断开窗口内：不在这里排程，等 onReconnect 按 lastActivityAt 折算补发。
                // INFO 落盘——这条是「为什么没休眠」的现场证据，此前是静默返回
                logger.info('[IdleTimer] idle deadline reached while disconnected, waiting for reconnect');
                return;
            }
            // 休眠 gate：阻塞则进入复查状态，等阻塞事务解除（周期复查通过）再退出
            if (this.onIdleTimeoutBlockedRecheck && !this.onIdleTimeoutBlockedRecheck()) {
                logger.info('[IdleTimer] idle deadline blocked by dormancy gate, entering recheck');
                this.enterBlocked();
                return;
            }
            logger.info(`[IdleTimer] idle deadline reached (idle for ${Date.now() - this.lastActivityAt}ms), exiting`);
            this.onIdleTimeout();
        }, remainingMs);
    }

    /** 空闲超时值（支持动态读取，每次排程求值的单一入口） */
    private resolveIdleTimeoutMs(): number {
        return typeof this.idleTimeoutMs === 'function' ? this.idleTimeoutMs() : this.idleTimeoutMs;
    }

    /**
     * 可见性切换（票 1.3 能力位，第一实例无人调用）：
     * 隐藏 = 暂停空闲计时（未开 timeoutOnHidden 时）；恢复 = 折算续排 + onWarmUp 回调。
     * 与断开路径正交：断开计时不受可见性影响。
     */
    setHidden(hidden: boolean): void {
        if (this.state === 'stopped' || hidden === this.isHidden) {
            return;
        }

        this.isHidden = hidden;
        if (hidden) {
            if (this.timeoutOnHidden) return; // 继续计时，不动作
            this.clearIdleTimers();
            logger.debug('[IdleTimer] Hidden, idle timers suspended');
            return;
        }

        // 恢复可见：按剩余进度续排（折算语义同 onReconnect），并回调 onWarmUp。
        // blocked 态必须补排复查——隐藏时 clearIdleTimers 连复查计时器一并清掉，
        // 只对 running 续排会让阻塞复查永久停摆（既不复查也不退出）
        if (!this.isDisconnected) {
            if (this.state === 'blocked') {
                this.scheduleBlockedRecheck();
            } else if (this.state === 'running') {
                this.scheduleIdleTimers();
            }
        }
        this.onWarmUp?.();
        logger.debug('[IdleTimer] Visible again, idle timers resumed');
    }

    private clearIdleTimers(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        this.clearBlockedRecheck();
    }

    /**
     * 空闲到点被 gate 阻塞后进入复查状态：每 recheckIntervalMs 重问一次判定，
     * 通过即触发 onIdleTimeout 退出。复查期间用户活动（reset）会解除该状态。
     */
    enterBlocked(): void {
        if (this.state === 'stopped') {
            return;
        }
        this.state = 'blocked';
        this.scheduleBlockedRecheck();
    }

    private scheduleBlockedRecheck(): void {
        this.clearBlockedRecheck();
        this.blockedRecheckTimer = setTimeout(() => {
            this.blockedRecheckTimer = null;
            if (this.state !== 'blocked' || this.isDisconnected) return;
            if (this.onIdleTimeoutBlockedRecheck && !this.onIdleTimeoutBlockedRecheck()) {
                this.scheduleBlockedRecheck();
                return;
            }
            logger.info('[IdleTimer] blocked recheck passed, exiting');
            this.onIdleTimeout();
        }, this.recheckIntervalMs);
    }

    private clearBlockedRecheck(): void {
        if (this.blockedRecheckTimer) {
            clearTimeout(this.blockedRecheckTimer);
            this.blockedRecheckTimer = null;
        }
    }

    private clearAllTimers(): void {
        this.clearIdleTimers();
        if (this.disconnectTimer) {
            clearTimeout(this.disconnectTimer);
            this.disconnectTimer = null;
        }
    }
}
