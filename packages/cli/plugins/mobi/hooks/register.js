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
// claude 进程内监听 session.append，按同目录 config.mjs 的过滤规则把事件
// 信号（仅元数据 door/name/uuid）fire-and-forget 推过 session bridge。
// 极薄约束：过滤 + 转发，不读行、不带内容、不理解语义——mod 失败绝不影响落盘链路。
// 沙箱约束：hooks 模块运行在无 Node 环境里（没有 process/console/fs），读
// spawn 注入 env 必须走 $.env.get（名字须字符串字面量，校验器据此点名）；
// 只允许相对路径 import 自家代码文件与 "claude-code"。

import { sessionAppendRules } from './config.mjs';

/** bridge 注入 env（session 侧 spawn claude 时写入；与 bridgeListener 常量同值）。
 * 注意：$.env.get 的名字参数必须是字符串字面量（校验器据此点名），常量仅作文档。 */
const BRIDGE_SOCK_ENV = 'MOBI_BRIDGE_SOCK';

/** 过滤规则判定：规则字段缺省表示通配。规则单源在同目录 config.mjs（见其头注释）。
 * 事件形状（SessionAppendInput）：door 在顶层，attachment 类型名在 e.message.name。 */
export function matchesAppendRule(rule, event) {
    if (rule.door !== undefined && event?.door !== rule.door) return false;
    if (rule.name !== undefined && event?.message?.name !== rule.name) return false;
    return true;
}

/** 过滤规则（模块级：校验器要求 on() 的 hook 是顶层声明，hook 及其依赖须在顶层可解析） */
const rules = Array.isArray(sessionAppendRules) ? sessionAppendRules : [];

/** bridge socket 进程内缓存：env 恒定（spawn 时注入），解析一次后复用——
 * hook 高频触发下每次走 $.env.get 会加重 mods worker 负载（worker 崩溃即
 * mods 整体停摆到进程结束）。 */
let cachedSock;

/** 解析并推送单条信号（fire-and-forget 调用，任何失败静默） */
function pushSignal($, e) {
    // 规则判定同步前置：海量非命中行在 env 解析前即返回（worker 负载敏感，见缓存注释）
    if (!rules.some((rule) => matchesAppendRule(rule, e))) return;
    const sock = cachedSock !== undefined ? Promise.resolve(cachedSock) : $.env.get("MOBI_BRIDGE_SOCK").then((sockPath) => {
        // 仅缓存真值：bridge env 未注入的会话（命中行才走到这）不把 undefined 钉进缓存
        if (sockPath) cachedSock = sockPath;
        return sockPath;
    });
    return sock
        .then((sockPath) => {
            if (!sockPath) return;
            return $.http.fetch('http://mobi-bridge/session-append', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    type: 'session.append',
                    payload: { door: e.door, name: e.message?.name, uuid: e.uuid },
                }),
                socketPath: sockPath,
            }).catch(() => {});
        })
        .catch(() => {});
}

/** session.append hook（顶层声明）：放行永不依赖出口结果 */
function onAppend($, e, next) {
    try {
        void pushSignal($, e);
    } catch {
        // 过滤/序列化异常同样不影响 next(e)
    }
    return next(e);
}

export const register = (on, options) => {
    if (rules.length === 0) return;
    // matcher 收缩触发面：全部规则都带同一 door 时按 door 预筛（引擎侧过滤，
    // 非 attachment 行不再进 hook、不进 worker），有通配/多 door 规则则全量监听
    const allSameDoor = rules.every((rule) => rule.door !== undefined)
        && new Set(rules.map((rule) => rule.door)).size === 1;
    if (allSameDoor) {
        on('session.append', { door: rules[0].door }, onAppend);
    } else {
        on('session.append', onAppend);
    }
};
