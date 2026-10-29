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

// transcript tap 的生产/消费契约单源（mods-goal-channel）：
// 「mod 生产端过滤什么事件」与「session 消费端认哪些行」是同一契约的两个半份，
// 曾经在 config.mjs（cli 插件资产）与 goalTapSubscriber（session）三处字面量双写。
// 现收敛于此：消费端直接由常量推导匹配；生产端 config.mjs 是 mods 沙箱零 import
// 的物理资产（开发态源目录即挂载点，无法生成），与常量的等值由 cli 测试锁定
// （mobiPluginHooks.test.ts）——漂移从「测试才能发现」变「测试必失败」。

import { parseGoalStatusAttachment } from './schemas'

/**
 * goal tap 推往 bridge 的信封 type，统一 `<来源>.<事件>` 命名。
 * 通道按 type 精确路由，禁止与 mods 事件同名（否则「goal 订阅者收到 fork 事件」
 * 这类跨源串台只能靠订阅者自己兜）。
 * 生产端 config.mjs 是 mods 沙箱零 import 的物理资产，与常量的等值由 cli 测试锁定。
 */
export const TRANSCRIPT_TAP_GOAL_ENVELOPE_TYPE = 'goal.append'

/**
 * wakeup tap 推往 bridge 的信封 type（同 `<来源>.<事件>` 命名）。
 * 唤醒与 goal 走不同信封——bridge 按 type 精确路由，各订阅者互不串台。
 */
export const TRANSCRIPT_TAP_WAKEUP_ENVELOPE_TYPE = 'wakeup.append'

/**
 * 匹配器（字段缺省 = 通配）：door/name/field 三维。同一形状两面共用，
 * 但字段名随目标而变——行侧 door 即行 type，事件侧 door 是事件自带字段。
 */
export interface TranscriptTapMatcher {
    /** 行的 type / 事件的 door（行进入会话的路由，如 attachment、prompt） */
    door?: string
    /** attachment 类型名（行侧在 attachment.type，事件侧在 message.name，如 goal_status） */
    name?: string
    /** 顶层字段存在性判定（防宽 door 规则匹配全部行造成信号洪峰） */
    field?: string
}

/**
 * session.append 事件的 tap 订阅规则。
 *
 * trigger 与 row 分成两个匹配器是 CC 运行时实证的结果（2.1.312 探针实测）：
 * mods session.append 事件是落盘序列化**前**的输入，形状只有
 * `{message, door, origin, uuid}`——wakeupSource/isMeta 等字段是落盘时才盖上的，
 * 事件层拿不到（唤醒行事件与人工 prompt 元数据完全同形：door='prompt'、
 * origin={kind:'unclassified'}）。所以生产端只能按宽触发面（door:'prompt'）
 * 发信号，消费端按落盘行的权威字段（row 匹配）做最终判定——人工 prompt 行
 * 无 wakeupSource 字段，在消费端天然排除。事件 uuid 与落盘行 uuid 一致（实测）。
 */
export interface TranscriptTapSessionAppendRule {
    /** 生产端触发面：mods session.append 事件匹配（先于落盘序列化） */
    trigger: TranscriptTapMatcher
    /** 消费端权威判定：transcript 落盘行匹配（缺省同 trigger——事件即行形状的场景） */
    row?: TranscriptTapMatcher
    /**
     * 命中后信号推往的 bridge 信封 type。缺省回落 goal 信封（历史规则兼容）；
     * 新消费者必须显式指定——bridge 按 type 精确路由，各订阅者只收自己的信封。
     */
    envelope?: string
}

/** 规则的行侧匹配器（消费端权威判定用） */
export function transcriptTapRowMatcher(rule: TranscriptTapSessionAppendRule): TranscriptTapMatcher {
    return rule.row ?? rule.trigger
}

/**
 * 当前订阅：goal_status 观测（goal 吊顶 + 聊天流标注）+ 唤醒行观测
 * （CC 内建 ScheduleWakeup//loop/Cron 自醒回合，行形如
 * `{type:'user', wakeupSource:'loop_wakeup', isMeta:true, ...}`）。
 * 新增 tap 消费者时在此追加规则——消费端匹配自动跟上，无需新机制。
 */
export const TRANSCRIPT_TAP_SESSION_APPEND_RULES: readonly TranscriptTapSessionAppendRule[] = [
    { trigger: { door: 'attachment', name: 'goal_status' }, envelope: TRANSCRIPT_TAP_GOAL_ENVELOPE_TYPE },
    {
        trigger: { door: 'prompt' },
        row: { door: 'user', field: 'wakeupSource' },
        envelope: TRANSCRIPT_TAP_WAKEUP_ENVELOPE_TYPE,
    },
]

/**
 * 行匹配（消费端权威判定，shared 单源推导）：door 与行 type 同名；
 * name 在 attachment.type；field 要求行顶层字段存在。生产端判别式在
 * register.js（mods 沙箱零 import，语义同形字面量，等值由 cli 测试锁定）。
 */
export function matchesTranscriptTapRule(
    row: { type?: unknown; attachment?: unknown } & Record<string, unknown>,
    matcher: TranscriptTapMatcher,
): boolean {
    if (matcher.door !== undefined && row.type !== matcher.door) return false;
    if (matcher.name !== undefined) {
        const payloadType = row.attachment ? (row.attachment as { type?: unknown }).type : undefined;
        if (payloadType !== matcher.name) return false;
    }
    if (matcher.field !== undefined && row[matcher.field] === undefined) return false;
    return true;
}

/**
 * 事件匹配（生产端触发面，shared 单源推导）：door 是事件自带字段；
 * name 在 message.name；field 要求事件顶层字段存在。register.js（mods 沙箱
 * 零 import）持有同形字面量，等值由 cli 测试锁定（mobiPluginHooks.test.ts）。
 */
export function matchesTranscriptTapTrigger(
    event: { door?: unknown; message?: { name?: unknown } } & Record<string, unknown>,
    matcher: TranscriptTapMatcher,
): boolean {
    if (matcher.door !== undefined && event.door !== matcher.door) return false;
    if (matcher.name !== undefined && event.message?.name !== matcher.name) return false;
    if (matcher.field !== undefined && event[matcher.field] === undefined) return false;
    return true;
}

/**
 * attachment 载荷校验注册表（按类型名）：管道侧的 generic 载荷 schema
 * （session claude/types 的 AttachmentPayloadSchema）据此分发校验——新 attachment
 * 消费者在此追加条目即全链路（tap 识别 + 载荷校验）跟上，管道 schema 零特判、
 * 保持零业务语义。未注册的类型名同样静默跳过（注册即「持久化 + 广播」白名单：
 * tap 只认注册类型，未注册行无人消费，放行只会无界扩大广播面）。
 */
export const TRANSCRIPT_TAP_ATTACHMENT_VALIDATORS: Readonly<Record<string, (value: unknown) => boolean>> = {
    goal_status: (value) => parseGoalStatusAttachment(value) !== null,
}
