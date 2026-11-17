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
 * 页题行动落点（单对 hook/host）的契约：分区动作 portal 进壳的标题行落点；
 * 无壳时（单独渲染 / 单测）就地右对齐渲染，不丢动作。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
    SettingsHeaderActions,
    useSettingsHeaderSlot,
} from '@/features/settings/blocks/settingsHeaderSlot'

// vitest 未开 globals：显式 cleanup（web 测试纪律）
afterEach(() => {
    cleanup()
})

function Shell() {
    const slot = useSettingsHeaderSlot()
    return slot.wrap(<>
        <div data-testid="title-row">{slot.host}</div>
        <SettingsHeaderActions><button type="button">安装</button></SettingsHeaderActions>
    </>)
}

describe('settingsHeaderSlot（hook/host 单对）', () => {
    it('动作 portal 进标题行落点', () => {
        render(<Shell />)
        const row = screen.getByTestId('title-row')
        const action = screen.getByRole('button', { name: '安装' })
        expect(row.contains(action)).toBe(true)
    })

    it('无宿主时动作就地渲染（右对齐兜底行）', () => {
        render(<SettingsHeaderActions><button type="button">安装</button></SettingsHeaderActions>)
        expect(screen.getByRole('button', { name: '安装' })).toBeTruthy()
    })
})
