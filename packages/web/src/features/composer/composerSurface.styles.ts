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
 * composer 叠层样式单一来源：聊天页的 ComposerDock 与新会话页的 InputCard
 * 是同一套「灰底容器 + 白卡浮出」结构，这里收口共享片段，两处 styled 块以
 * `${}` 插值消费，避免逐字复制后各自漂移。
 */

import { css } from '@emotion/react'

/**
 * 白卡头部内容行（命令提示 / 建议 chip / 附件列表）的统一内衬。
 * 同心规则：外圆角 = 内圆角 + 内衬——24px 白卡圆角下，顶衬 <12px 会被上圆弧咬住
 * （曾只有 4px，chip 顶在圆角上）。
 * 侧向 var(--composer-rail)（桌面 20px / 移动端 16px，定义见下方 composerRail）
 * 与输入区（ChatInput padding 左右）、参数条（padding 左右）同一条内容轨——
 * 头部 chip 的视觉左缘、正文首字、底部「+」图标同列；改这里会同时影响所有
 * 头部行（命令提示 / 建议 chip / 附件列表）的侧衬。
 */
export const COMPOSER_CARD_HEADER_INSET = '12px var(--composer-rail, 20px) 0'

/**
 * composer 内容轨侧衬变量：桌面 20px，移动端降一档到 16px（窄屏白卡绝对宽度小，
 * 20px 侧衬挤压正文）。断点与 useMediaQuery 的 isMobile 同界（< 768px）。
 * 定义在灰层容器上（新会话页 InputCard / 聊天页 ComposerDock），白卡内的
 * header/输入区/参数条与灰层的 SubBar/工作区行都继承同一值。
 */
export const composerRail = css`
    --composer-rail: 20px;

    @media (max-width: 767px) {
        --composer-rail: 16px;
    }
`

/**
 * 输入白卡容器 `.composer-card`（header 内容行 + 输入区 + 参数条共居的白底大圆角卡）。
 * 白底 + 无投影无描边：分层靠与灰底的底色差 + 圆角即可（两页都无投影）。
 * **margin 不在此收口**——聊天页空态 / 有内容层 / 新会话页三档悬挑几何各不相同，
 * 由各页 styled 块按自身容器内衬补（负 margin 语义是「吃掉容器内衬 + 真悬挑」，随容器而定）。
 */
export const composerCard = css`
    && .composer-card {
        border: none;
        border-radius: var(--radius-panel);
        background: var(--ant-color-bg-container);
        width: auto;
    }
`
