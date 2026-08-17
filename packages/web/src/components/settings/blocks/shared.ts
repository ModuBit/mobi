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

import { keyframes } from '@emotion/react'
import styled from '@emotion/styled'

/** 卡片入场：轻微上浮 + 淡入（主卡 / 说明区块 / PWA 卡共享） */
export const enter = keyframes`
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
`

/**
 * 线性图标容器，中性色，无色块徽章（主卡 / 说明区块 / PWA 卡共享）。
 * $token 只声明用到的字段（portable 子集），避免 export 时引用 antd 内部类型触发 TS2883。
 * aria-hidden：旁边有文本，图标为装饰。
 */
export const IconBox = styled.span<{ $token: { colorTextSecondary: string } }>`
    display: grid;
    place-items: center;
    width: 22px;
    flex-shrink: 0;
    color: ${p => p.$token.colorTextSecondary};
    font-size: 17px;
`

/**
 * 设置页主卡容器（容器色 + 细边框 + 12px 圆角 + 入场动画）。
 * RouteCard / ProviderCard 等设置分区卡片共享，padding/gap/边框态由各卡按需扩展——
 * 主题圆角或卡片语言调整只改这一处，不再逐卡漂移。
 */
export const SettingsCard = styled.section<{ $token: { colorBgContainer: string; colorBorderSecondary: string } }>`
    display: flex;
    flex-direction: column;
    border-radius: 12px;
    background: ${p => p.$token.colorBgContainer};
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    animation: ${enter} 0.3s ease-out;
`
