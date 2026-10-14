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

import { css } from '@emotion/react'

/**
 * composer 叠层样式单一来源：聊天页的 ComposerDock 与新会话页的 InputCard
 * 是同一套「灰底容器 + 白卡浮出」结构，这里收口共享片段，两处 styled 块以
 * `${}` 插值消费，避免逐字复制后各自漂移。
 */

/**
 * 白卡头部内容行（建议 chip / 引用 chips / 附件列表）的统一内衬。
 * 同心规则：外圆角 = 内圆角 + 内衬——24px 白卡圆角下，顶衬 <12px 会被上圆弧咬住
 * （曾只有 4px，chip 顶在圆角上）；侧向对齐卡片 16px 基准。
 */
export const COMPOSER_CARD_HEADER_INSET = '12px 16px 0'

/**
 * Sender 浮出容器的「卡中卡」：白底 + 24px 大圆角、无投影无描边。
 * 左右负 margin 吃掉容器内衬 8px 再真悬挑 8px（-16 = 8 内衬 + 8 悬挑），
 * 上下正 margin 与相邻层拉开呼吸空隙。Sender 根节点 width:100%，必须
 * 覆盖成 auto 负 margin 才是对称悬挑，否则退化为纯左移（右侧缩进）。
 * 无投影：白卡比灰容器宽，投影跟着白卡走、投在上下薄灰条上就是一圈光晕；
 * 分层靠白卡与灰底的底色差 + 圆角即可（两页都无投影）。
 */
export const composerSenderCard = css`
    && .ant-sender {
        border: none !important;
        box-shadow: none !important;
        border-radius: 24px !important;
        background: var(--ant-color-bg-container) !important;
        width: auto !important;
        margin: 8px -16px;
    }
`

/**
 * 提交/停止按钮：深色大圆钮（中性反色，双档主题各自成立），disabled 回落灰底弱化。
 */
export const composerSubmitButton = css`
    && .ant-sender .ant-btn-primary.ant-btn-circle {
        width: 40px;
        height: 40px;
        min-width: 40px;
        font-size: 18px;
        background: var(--ant-color-text) !important;
        color: var(--ant-color-bg-container) !important;
        /* 逐项点名（不写 all）：除 hover 压暗的 opacity 外，保留背景/前景的过渡——
           背景色在此被整钮接管，disabled↔enabled、主题切换时不加会跳变 */
        transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
    }

    && .ant-sender .ant-btn-primary.ant-btn-circle:not(:disabled):hover {
        opacity: 0.88;
    }

    && .ant-sender .ant-btn-primary.ant-btn-circle:disabled {
        background: var(--ant-color-fill-secondary) !important;
        color: var(--ant-color-text-quaternary) !important;
    }
`
