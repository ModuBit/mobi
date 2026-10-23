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

// forked skill tap（mods function hooks，spec forked-code-review-tap）：
// claude 进程内监听 session.append，精确识别 forked /code-review 的执行行，把
// 非 text 内容（thinking / tool_use / tool_result）以最小事实推过 session bridge。
//
// 为什么是独立 plugin：mods 一个 plugin 只能有一个 hooks module，且 worker 按
// plugin 替换——本特性故障不牵连 goal 观测；CLI 若改变 code-review 的 fork 行为，
// 从 bundledPlugins 摘除本 plugin 即完全回退。
//
// 识别：事件不带 skill 名，唯一确定性信号是 $.agent.list() 的 description
// （fork 为 `/code-review <args>`，普通 Task 子代理是自然语言描述）。
// 顺序：每个 agentId 首次出现时先攒行，判定完成后按到达顺序入队；推送走单条
// promise 链，保证到达 session 的顺序 = 产生顺序。
// 不阻塞：hook 永远立即 next(e)，判定与推送都在后台。
// 沙箱约束：无 Node/process/fs；env 名必须是字符串字面量；只能相对 import 自家文件。

import { appendDoors, envelopeType, maxMessageChars, targetSkill } from './config.mjs';

/** bridge 注入 env（session 侧 spawn claude 时写入；名字须字符串字面量，常量仅作文档） */
const BRIDGE_SOCK_ENV = 'MOBI_BRIDGE_SOCK';

/** 判定：description 是否指向目标 forked skill（精确到首词，`/code-review-x` 不命中） */
export function matchesForkDescription(description) {
    if (typeof description !== 'string') return false;
    const trimmed = description.trim();
    const prefix = `/${targetSkill}`;
    if (!trimmed.startsWith(prefix)) return false;
    const rest = trimmed.slice(prefix.length);
    return rest === '' || /^\s/.test(rest);
}

/** 是否是可推的 fork 行：assistant/user 行且含非 text block（纯 text / 空 content 不推——
 *  text 由主循环的最终答复承载；type 不在白名单的行下游 schema 也接不住） */
function eligibleRow(message) {
    if (!message || (message.type !== 'assistant' && message.type !== 'user')) return false;
    const content = message.content;
    if (!Array.isArray(content) || content.length === 0) return false;
    return content.some((block) => !block || block.type !== 'text');
}

const TRUNCATED_SUFFIX = '…[truncated]';

/** 递归截断所有字符串（保留 message / content block 结构，下游照常分类） */
function capStrings(value, limit) {
    if (typeof value === 'string') {
        return value.length > limit ? value.slice(0, limit) + TRUNCATED_SUFFIX : value;
    }
    if (Array.isArray(value)) return value.map((item) => capStrings(item, limit));
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) out[key] = capStrings(value[key], limit);
        return out;
    }
    return value;
}

function serializedLength(value) {
    try {
        const text = JSON.stringify(value);
        return typeof text === 'string' ? text.length : 0;
    } catch {
        return 0;
    }
}

/**
 * 单条 message 限长：超限时按「每串上限」逐档减半，仍超则只留前 20 个 block。
 * 返回原始 message（未超限）或结构完整的截断副本 + truncated 标记。
 */
export function fitMessage(message, limit = maxMessageChars) {
    if (serializedLength(message) <= limit) return { message, truncated: false };
    for (let cap = Math.min(limit, 64 * 1024); cap >= 256; cap = Math.floor(cap / 2)) {
        const candidate = { ...message, content: capStrings(message.content, cap) };
        if (serializedLength(candidate) <= limit) return { message: candidate, truncated: true };
    }
    const content = Array.isArray(message.content) ? message.content.slice(0, 20) : message.content;
    return { message: { ...message, content: capStrings(content, 256) }, truncated: true };
}

/** agent 判定状态：pending 期间到达的行先攒住（保序），判完统一入队或丢弃 */
const agents = new Map();

/** 判定缓存容量上限：长会话里 Task 子代理逐轮递增，不设上限会无界增长 */
const MAX_TRACKED_AGENTS = 500;

/** 判定期攒行上限（判定正常毫秒级；仅防 list 挂死时无界吃内存） */
const MAX_PENDING_ROWS = 2000;

/** 推送串行链：到达顺序 = 推送顺序，且 hook 永不 await 它 */
let pushChain = Promise.resolve();

/** bridge socket 缓存：env 在 spawn 时注入、进程内恒定（同 goal tap 的缓存理由） */
let cachedSock;

/** 代理尚未出现在 list 时的退避复查（session.append 可能先于 agent 注册完成；
 *  一次判否会永久丢弃该 agent 的整批行） */
const JUDGE_RETRY_DELAYS_MS = [100, 200, 400];

function judge($, agentId, attempt = 0) {
    return $.agent
        .list()
        .then((list) => {
            const agent = Array.isArray(list) ? list.find((item) => item && item.id === agentId) : undefined;
            if (agent) return matchesForkDescription(agent.description);
            const delay = JUDGE_RETRY_DELAYS_MS[attempt];
            if (delay === undefined) return false;
            return $.clock.sleep(delay).then(() => judge($, agentId, attempt + 1));
        })
        // 查询失败保守判否：宁可少推，不误把普通子代理推进聊天流
        .catch(() => false);
}

function rememberAgent(agentId, state) {
    agents.set(agentId, state);
    if (agents.size > MAX_TRACKED_AGENTS) {
        const oldest = agents.keys().next().value;
        if (oldest !== undefined) agents.delete(oldest);
    }
}

function enqueue($, e) {
    // 主循环行不带 agentId；只观测 fork / 子代理的行
    if (!e || !e.agentId) return;
    if (!eligibleRow(e.message)) return;
    let state = agents.get(e.agentId);
    if (!state) {
        state = { verdict: 'pending', buffer: [] };
        rememberAgent(e.agentId, state);
        const judging = state;
        judge($, e.agentId)
            .then((isTarget) => {
                judging.verdict = isTarget ? 'target' : 'other';
                const rows = judging.buffer;
                judging.buffer = [];
                if (!isTarget) return;
                for (const row of rows) schedule($, row);
            })
            .catch(() => {
                judging.verdict = 'other';
                judging.buffer = [];
            });
    }
    if (state.verdict === 'pending') {
        if (state.buffer.length < MAX_PENDING_ROWS) state.buffer.push(e);
        return;
    }
    if (state.verdict === 'target') schedule($, e);
}

function resolveSock($) {
    if (cachedSock !== undefined) return Promise.resolve(cachedSock);
    return $.env
        .get('MOBI_BRIDGE_SOCK')
        .then((sock) => {
            // 仅缓存真值：bridge 未注入的会话不把 undefined 钉进缓存
            if (sock) cachedSock = sock;
            return sock;
        })
        .catch(() => undefined);
}

function schedule($, e) {
    pushChain = pushChain.then(() => pushOne($, e)).catch(() => {});
}

function pushOne($, e) {
    return resolveSock($)
        .then((sockPath) => {
            if (!sockPath) return;
            const fitted = fitMessage(e.message);
            const payload = { skill: targetSkill, uuid: e.uuid, door: e.door, message: fitted.message };
            if (fitted.truncated) payload.truncated = true;
            return $.http
                .fetch('http://mobi-bridge/forked-skill-append', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ type: envelopeType, payload, from: 'mobi-forked-tap' }),
                    socketPath: sockPath,
                })
                .catch(() => {});
        })
        .catch(() => {});
}

/** session.append hook（顶层声明）：放行永不依赖判定与出口结果 */
function onAppend($, e, next) {
    try {
        enqueue($, e);
    } catch {
        // 观测异常同样不影响 next(e)
    }
    return next(e);
}

export const register = (on) => {
    if (appendDoors.length === 0) return;
    // matcher 收缩触发面：非白名单 door 在引擎侧就被挡掉，不进 hook、不进 worker
    on('session.append', { door: [...appendDoors] }, onAppend);
};
