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

// bridge（CLI→session IPC，spec mods-goal-channel 基建②）：per-session 的
// HTTP-over-UDS 通道。claude 进程内的 mod（transcript tap）经 $.http.fetch 把
// 事件信封 POST 过来，session 侧按 type 分发给注册的订阅者（观察者模式）。
// 传输层只依赖 type（判别标签）做路由；payload 是 producer/consumer 共同约定，
// 通道不解释；可选 from 字段做溯源，不占用路由键。

import { createServer, type Server } from 'node:http';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { configuration } from '@mobi/node-core/configuration';
import { logger } from '@mobi/node-core/logger';

/** bridge socket 地址的注入 env（spawn claude 时写入，mod 端同名常量读它） */
export const MOBI_BRIDGE_SOCK_ENV = 'MOBI_BRIDGE_SOCK';

/** 信封（传输协议，与消息无关）：type 路由 + payload 黑盒 + 可选 from 溯源 */
export const BridgeEnvelopeSchema = z.object({
    type: z.string().min(1),
    payload: z.unknown(),
    from: z.string().optional(),
});
export type BridgeEnvelope = z.infer<typeof BridgeEnvelopeSchema>;

/** 订阅者回调：payload 形状由订阅者与生产者约定，通道不解释 */
export type BridgeSubscriber = (payload: unknown, from?: string) => void;

export interface BridgeListener {
    readonly socketPath: string;
    /** 按 type 注册订阅者；同一 type 可多个订阅者（都收到） */
    subscribe(type: string, subscriber: BridgeSubscriber): void;
    /** 停止监听并清理 socket 文件（会话退出调用） */
    stop(): Promise<void>;
}

/** per-session socket 路径：mobi home 私有目录 + 随机名（路径长度受 UDS ~100B 限制） */
export function buildBridgeSocketPath(): string {
    const dir = join(configuration.mobiHomeDir, 'bridge');
    mkdirSync(dir, { recursive: true });
    return join(dir, `s-${randomUUID()}.sock`);
}

/** 信封体积上限：通道复用后承载 fork 行的原始 message（含 tool_result 正文），
 * 6MiB 为硬闸（mod 侧 $.http.fetch body 上限 4MiB，留余量），超限即恶意/异常流量 */
const MAX_BODY_BYTES = 6 * 1024 * 1024;

/**
 * 启动 bridge listener。会话进程内唯一实例；失败由调用方兜底（warn 后无桥运行，
 * goal 观测链路故障绝不影响会话本身）。
 */
export function startBridgeListener(opts?: { socketPath?: string }): Promise<BridgeListener> {
    const socketPath = opts?.socketPath ?? buildBridgeSocketPath();
    const subscribers = new Map<string, Set<BridgeSubscriber>>();
    // 活跃连接跟踪：server.close 只停监听，keep-alive 连接会挂住回调——stop 时全部销毁
    const connections = new Set<import('node:net').Socket>();

    const server: Server = createServer((req, res) => {
        connections.add(req.socket);
        req.socket.on('close', () => connections.delete(req.socket));
        // Buffer 累积后一次解码：大 body 的字符串逐块拼接近 O(n²)，且按字节判闸更准确
        const chunks: Buffer[] = [];
        let bodyBytes = 0;
        let oversized = false;
        // 声明体积已超限：不必读 body 即可拒绝（省掉整段缓冲与后续拷贝）
        const declaredBytes = Number(req.headers['content-length']);
        if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
            logger.warn(`[BRIDGE] declared body ${declaredBytes} bytes exceeds limit (${MAX_BODY_BYTES}), destroying connection`);
            req.destroy();
            return;
        }
        req.on('data', (chunk: Buffer) => {
            bodyBytes += chunk.length;
            if (bodyBytes > MAX_BODY_BYTES) {
                if (!oversized) {
                    oversized = true;
                    logger.warn(`[BRIDGE] oversized body (>${MAX_BODY_BYTES} bytes), destroying connection`);
                }
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (oversized) return;
            // connection: close：mod 端 fetch 一次性报文，不留 keep-alive 挂住 stop
            res.writeHead(204, { connection: 'close' }).end();
            dispatchEnvelope(subscribers, Buffer.concat(chunks, bodyBytes).toString('utf-8'));
        });
        // mod 侧 fire-and-forget，但防御性兜底：慢/挂死连接不占住 server
        req.setTimeout(5000, () => {
            logger.warn('[BRIDGE] request timed out, destroying socket');
            req.destroy();
        });
    });

    return new Promise((resolve, reject) => {
        // 残留 socket 文件（上次异常退出未清理）会让 listen 报 EADDRINUSE，先清
        rmSync(socketPath, { force: true });
        server.once('error', reject);
        server.listen(socketPath, () => {
            // 仅本机同用户 claude 进程可达
            try {
                chmodSync(socketPath, 0o600);
            } catch (e) {
                logger.debug('[BRIDGE] chmod socket failed', e);
            }
            resolve({
                socketPath,
                subscribe(type, subscriber) {
                    let set = subscribers.get(type);
                    if (!set) {
                        set = new Set();
                        subscribers.set(type, set);
                    }
                    set.add(subscriber);
                },
                stop() {
                    return new Promise((resolveStop) => {
                        // 先销毁全部 keep-alive 连接，server.close 的回调才能及时触发；
                        // socket 文件无条件清理（回调丢失时不残留）
                        for (const socket of connections) socket.destroy();
                        connections.clear();
                        server.close(() => resolveStop());
                        rmSync(socketPath, { force: true });
                    });
                },
            });
        });
    });
}

/** 信封分发：坏报文/未知 type 静默忽略（debug 记录）；订阅者异常不影响 server */
function dispatchEnvelope(subscribers: Map<string, Set<BridgeSubscriber>>, body: string): void {
    let envelope: BridgeEnvelope;
    try {
        const parsed: unknown = JSON.parse(body);
        const result = BridgeEnvelopeSchema.safeParse(parsed);
        if (!result.success) {
            logger.debug('[BRIDGE] invalid envelope dropped', result.error.message);
            return;
        }
        envelope = result.data;
    } catch {
        logger.debug('[BRIDGE] non-JSON body dropped');
        return;
    }

    const set = subscribers.get(envelope.type);
    if (!set || set.size === 0) {
        logger.debug(`[BRIDGE] no subscriber for type=${envelope.type}, ignored`);
        return;
    }
    for (const subscriber of set) {
        try {
            subscriber(envelope.payload, envelope.from);
        } catch (e) {
            logger.warn(`[BRIDGE] subscriber for type=${envelope.type} threw`, e);
        }
    }
}
