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
 * 工具视图的共享类型。独立成文件（分层治理票 03）：此前定义在 _all.tsx，
 * 各 View 从 _all import type 而 _all import 各 View 组件——19 条类型循环的根因；
 * 类型抽离后 _all（注册表）与各 View（实现）都只依赖本文件，环破。
 */

import type { ComponentType } from 'react'
import type { ToolCallBlock } from '@/domain/tool/types'
import type { SessionMetadataSummary } from '@/core/data/api/types'

export type ToolViewProps = {
    block: ToolCallBlock
    metadata: SessionMetadataSummary | null
}

export type ToolViewComponent = ComponentType<ToolViewProps>
