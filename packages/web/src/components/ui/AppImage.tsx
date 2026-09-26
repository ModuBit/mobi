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
 * antd Image 的 mobi 封装：全站展示决策「hover 不出灰色遮罩层」默认收口在
 * preview.cover=false（v6 把 cover 层挂在 preview 配置内，旧 mask prop 静默失效）。
 * 新的图片消费方经本组件即默认无遮罩；确需遮罩显式传 cover:true 覆写。
 * 配套：cover 层去除会丢掉挂在它上面的 pointer 光标，补偿规则在 antd.css
 * `.ant-image[role='button'] { cursor: pointer }`（与本决策同进退）。
 */

import { Image } from 'antd'
import type { ImageProps } from 'antd'

export function AppImage({ preview, ...rest }: ImageProps) {
    const merged = typeof preview === 'object' && preview !== null ? { cover: false as const, ...preview } : { cover: false }
    return <Image {...rest} preview={preview === false ? false : merged} />
}
