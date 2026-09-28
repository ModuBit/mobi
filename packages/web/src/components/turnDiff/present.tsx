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
 * 轮次变更的共享呈现原语：变更类型徽标（KIND_BADGES）与路径标签（FilePathLabel）。
 * 聊天侧轮次变更卡（TurnDiffCard）与审查视图（GitReviewView / DiffTreePanel）共用——
 * 徽标语义与配色只此一处，勿复制。
 */

import { theme } from 'antd'
import type { TurnDiffFileKind } from '@mobi/shared'
import { basename } from '@/core/utils/path'

/**
 * 变更类型徽标字面量与配色（kind → 短标 + 明暗双档色；字面量固定不随主题，色值双档各自验证）。
 */
export const KIND_BADGES: Record<TurnDiffFileKind, { label: string; light: string; dark: string }> = {
    add: { label: 'A', light: '#4E9A51', dark: '#6FBF73' },
    delete: { label: 'D', light: '#C2544D', dark: '#E08A84' },
    rename: { label: 'R', light: '#8A6FC9', dark: '#B9A5E8' }, // 暗档提亮：旧紫在暗底上不可读（真机实证 2026-09-27）
    modify: { label: 'M', light: '#B8860B', dark: '#D9A83C' },
}

/**
 * 路径单行展示、空间不足从左侧省略（保留尾段文件名，用户认路径靠的是尾部）。
 * 两层结构缺一不可（真机实证 2026-09-27）：外层 direction:rtl 让 text-overflow 的
 * 省略号落在行首；内层 unicode-bidi:isolate + LTR 保证路径字符序——若路径直接暴露在
 * rtl 段落里，`__`/`.` 等中性字符会被段落方向重排到行尾（「__pycache__」显示成
 * 「pycache__…__」）。目录/文件名两段配色在内层保持。
 */
export function FilePathLabel({ path }: { path: string }) {
    const { token } = theme.useToken()
    const base = basename(path)
    const dir = base && path.endsWith(base) ? path.slice(0, path.length - base.length) : ''
    return (
        <span
            style={{
                flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                direction: 'rtl', textAlign: 'left',
                fontSize: token.fontSizeSM, fontFamily: 'mono',
            }}
        >
            <span style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>
                {dir && <span style={{ color: token.colorTextTertiary }}>{dir}</span>}
                <span style={{ color: token.colorText }}>{base || path}</span>
            </span>
        </span>
    )
}
