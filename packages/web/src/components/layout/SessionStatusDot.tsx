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

import { getSessionLoader } from '@/core/utils/sessionStatus'
import type { Session } from '@/core/data/api/types'
import { INACTIVE_SESSION_DIM } from './inactiveDimming'
import { PixelLoader } from '@/components/ui/PixelLoader'

/**
 * 会话列表状态指示（桌面 SessionRow 与移动端 MobileSessionItem 共用）：
 * 波形映射（getSessionLoader）+ 列表小格（3px）+ 未激活减淡的单一组合点。
 * 指示器增加任何维度（如 aria 语义、tooltip）只改这里，两处行组件自动同步。
 */
export function SessionStatusDot({ session, inactive }: { session: Session; inactive: boolean }) {
    return (
        <PixelLoader
            {...getSessionLoader(session)}
            size={3}
            style={inactive ? { opacity: INACTIVE_SESSION_DIM.statusDot } : undefined}
        />
    )
}
