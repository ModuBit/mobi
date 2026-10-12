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
 * 会话侧 agent 状态词汇（src 分层治理票 01 自 pixel-avatar/types 下沉）。
 * 它是「会话正在干什么」的语义（getSessionAvatarStatus 的产出），像素头像只是
 * 其呈现载体之一——定义权归 core，载体组件反向引用。
 */

/** 会话侧 agent 状态（outputting=输出中 / awaiting_auth=待审批 / idle=空闲 / inactive=未激活） */
export type AgentStatus = 'outputting' | 'awaiting_auth' | 'idle' | 'inactive'
