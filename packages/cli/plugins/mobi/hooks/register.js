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

// transcript tap（mods function hooks，spec mods-goal-channel 基建①）：
// claude 进程内监听 session.append，按同目录 config.json 的过滤规则把事件
// 信号（仅元数据 door/name/uuid）fire-and-forget 推过 session bridge。
// 极薄约束：过滤 + 转发，不读行、不带内容、不理解语义——mod 失败绝不影响落盘链路。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** bridge 注入 env（session 侧 spawn claude 时写入；与 bridgeListener 常量同值） */
const BRIDGE_SOCK_ENV = 'MOBI_BRIDGE_SOCK';

/**
 * 过滤规则判定：规则字段缺省表示通配。
 * 规则是全局的（所有会话一致），随包 config.json 分发，不进 env。
 */
export function matchesAppendRule(rule, event) {
    if (rule.door !== undefined && event.door !== rule.door) return false;
    if (rule.name !== undefined && event.name !== rule.name) return false;
    return true;
}

/** 读取同目录 config.json（随包分发；读不到视为空配置——mod 空转，不抛错） */
export function loadConfig() {
    try {
        const configPath = join(dirname(fileURLToPath(import.meta.url)), 'config.json');
        return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
        return {};
    }
}

export const register = (on, options) => {
    const sockPath = process.env[BRIDGE_SOCK_ENV];
    // 无桥可推（bridge 未起 / env 未注入）：不挂事件，mod 退化为空转
    if (!sockPath) return;

    const config = loadConfig();
    const rules = Array.isArray(config['session.append']) ? config['session.append'] : [];
    if (rules.length === 0) return;

    on('session.append', ($, e, next) => {
        try {
            if (rules.some((rule) => matchesAppendRule(rule, e))) {
                // fire-and-forget：不 await、失败静默——绝不阻塞落盘链路或超 hook budget
                void $.http.fetch('http://mobi-bridge/session-append', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        type: 'session.append',
                        payload: { door: e.door, name: e.name, uuid: e.uuid },
                    }),
                    socketPath: sockPath,
                }).catch(() => {});
            }
        } catch {
            // 过滤/序列化异常同样不影响 next(e)
        }
        return next(e);
    });
};
