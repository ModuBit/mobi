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
 * Idle Timer - Session 自动超时关闭计时器
 *
 * 支持：
 * - 连接断开超时：Socket.IO 断开后独立计时
 * - 交互不活跃超时：无活动事件时计时
 * - 预警通知：交互不活跃超时提前发送预警
 */

import { logger } from '@/ui/logger';

/** 阻塞复查默认周期 */
const DEFAULT_RECHECK_MS = 30_000;

export interface IdleTimerOptions {
    /** 连接断开超时（毫秒），默认 10 分钟 */
    disconnectTimeoutMs: number;
    /** 交互不活跃超时（毫秒），默认 1 天 */
    idleTimeoutMs: number;
    /** 预警提前时间（毫秒），默认 5 分钟 */
    warningMs: number;
    /** 预警回调 */
    onWarning: () => void;
    /**
     * 空闲到点被休眠 gate 阻塞后的复查判定（dormancy spec）：true = 阻塞事务已清、
     * 触发 onIdleTimeout 退出；false = 继续阻塞。缺省（未提供）= 到点直接退出，行为同旧版。
     */
    onIdleTimeoutBlockedRecheck?: () => boolean;
    /** 阻塞复查周期（毫秒），默认 30 秒 */
    recheckIntervalMs?: number;
    /** 连接断开超时回调 */
    onDisconnectTimeout: () => void;
    /** 交互不活跃超时回调 */
    onIdleTimeout: () => void;
}

type TimerState = 'stopped' | 'running' | 'warning-sent' | 'blocked';

export class IdleTimer {
    private readonly disconnectTimeoutMs: number;
    private readonly idleTimeoutMs: number;
    private readonly warningMs: number;
    private readonly onWarning: () => void;
    private readonly onDisconnectTimeout: () => void;
    private readonly onIdleTimeout: () => void;

    private state: TimerState = 'stopped';
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private blockedRecheckTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly onIdleTimeoutBlockedRecheck?: () => boolean;
    private readonly recheckIntervalMs: number;
    private warningTimer: ReturnType<typeof setTimeout> | null = null;
    private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private isDisconnected = false;

    constructor(options: IdleTimerOptions) {
        this.disconnectTimeoutMs = options.disconnectTimeoutMs;
        this.idleTimeoutMs = options.idleTimeoutMs;
        this.warningMs = options.warningMs;
        this.onIdleTimeoutBlockedRecheck = options.onIdleTimeoutBlockedRecheck;
        this.recheckIntervalMs = options.recheckIntervalMs ?? DEFAULT_RECHECK_MS;
        this.onWarning = options.onWarning;
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
        this.scheduleIdleTimers();
        logger.debug('[IdleTimer] Started');
    }

    /**
     * 停止计时（切换到 Local 模式）
     */
    stop(): void {
        this.clearAllTimers();
        this.state = 'stopped';
        this.isDisconnected = false;
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
        // 只能清掉最后一个。后果：hub 重启（deploy）后已成功重连的会话，
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

        // 重新开始空闲计时
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
        logger.debug('[IdleTimer] Destroyed');
    }

    /**
     * 获取当前状态
     */
    getState(): TimerState {
        return this.state;
    }

    /**
     * 是否处于断开状态
     */
    isDisconnectedState(): boolean {
        return this.isDisconnected;
    }

    private scheduleIdleTimers(): void {
        this.clearIdleTimers();

        // 预警计时器
        const warningDelay = this.idleTimeoutMs - this.warningMs;
        if (warningDelay > 0) {
            this.warningTimer = setTimeout(() => {
                if (this.state === 'running' && !this.isDisconnected) {
                    this.state = 'warning-sent';
                    logger.debug('[IdleTimer] Sending idle timeout warning');
                    this.onWarning();
                }
            }, warningDelay);
        }

        // 超时计时器
        this.idleTimer = setTimeout(() => {
            if (this.isDisconnected) return;
            // 休眠 gate：阻塞则进入复查状态，等阻塞事务解除（周期复查通过）再退出
            if (this.onIdleTimeoutBlockedRecheck && !this.onIdleTimeoutBlockedRecheck()) {
                logger.debug('[IdleTimer] Idle timeout blocked by dormancy gate, entering recheck');
                this.enterBlocked();
                return;
            }
            logger.debug('[IdleTimer] Idle timeout reached');
            this.onIdleTimeout();
        }, this.idleTimeoutMs);
    }

    private clearIdleTimers(): void {
        if (this.warningTimer) {
            clearTimeout(this.warningTimer);
            this.warningTimer = null;
        }
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
            logger.debug('[IdleTimer] Blocked recheck passed, exiting');
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
