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

/** 未激活会话减淡（标题）——激活会话是列表视觉主角，桌面（SessionRow）与
 *  移动端（MobileSessionItem）共用同一组值。
 *  注：状态指示（ghost 波形）的亮度由 PixelLoader 的 ghost 格自带（0.12），
 *  不在此叠加透明度——两层暗相乘会把它埋进背景（0.07×0.45≈0.03 的教训）。 */
export const INACTIVE_SESSION_DIM = {
    /** 标题透明度（SessionName styled $inactive） */
    title: 0.55,
} as const
