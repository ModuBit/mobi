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

/** 未激活会话减淡（状态点 / 标题）——激活会话是列表视觉主角，桌面（SessionRow）与
 *  移动端（MobileSessionItem）共用同一组值，调整视觉强度只改这里 */
export const INACTIVE_SESSION_DIM = {
    /** 状态点透明度（StatusStateIcon 内联 opacity） */
    statusDot: 0.45,
    /** 标题透明度（SessionName styled $inactive） */
    title: 0.55,
} as const
