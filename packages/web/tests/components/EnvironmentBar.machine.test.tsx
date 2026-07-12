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
 * 回归守卫：单机器时隐藏机器选择器
 *
 * 只有一个可选机器时，机器选择对用户无意义（父组件 init effect 已自动选中），
 * 此时应隐藏机器 Select，减少视觉噪声。
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { ConfigProvider } from 'antd'
import { EnvironmentBar } from '@/components/composer/EnvironmentBar'
import type { Machine } from '@/core/data/api/types'

beforeAll(() => {
    // @ts-expect-error jsdom 无 ResizeObserver
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
})

afterEach(() => {
    cleanup()
})

const cpWrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

function makeMachine(id: string, active = true): Machine {
    return {
        id,
        active,
        metadata: { host: `${id}-host`, platform: 'darwin', displayName: id },
    }
}

describe('EnvironmentBar 机器选择器显隐', () => {
    it('单机器时不渲染机器选择器', () => {
        const { container } = render(
            <EnvironmentBar
                machines={[makeMachine('m1')]}
                selectedMachineId="m1"
                directoryOptions={[]}
                selectedDirectory=""
                onDirectoryChange={() => {}}
                onMachineChange={() => {}}
                recentPaths={[]}
            />,
            { wrapper: cpWrapper },
        )
        // 机器行以 DesktopOutlined（.anticon-desktop）为标识，单机器时该行隐藏
        expect(container.querySelector('.anticon-desktop')).toBeNull()
    })

    it('多机器时渲染机器选择器', () => {
        const { container } = render(
            <EnvironmentBar
                machines={[makeMachine('m1'), makeMachine('m2')]}
                selectedMachineId={null}
                directoryOptions={[]}
                selectedDirectory=""
                onDirectoryChange={() => {}}
                onMachineChange={() => {}}
                recentPaths={[]}
            />,
            { wrapper: cpWrapper },
        )
        // 机器行展示，DesktopOutlined 存在
        expect(container.querySelector('.anticon-desktop')).not.toBeNull()
    })
})
