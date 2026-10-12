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
 * 临时验证页（shadcn 底座票 03）——四项共存风险的浏览器侧断言宿主。
 * 验证完成后整页删除、路由还原，不提交。断言经 CDP evaluate_script 读
 * computed style / elementFromPoint，页面只负责搭场景。
 */

import { useState } from 'react'
import styled from '@emotion/styled'
import { Modal, Button as AntButton } from 'antd'
import { Button as ArcButton } from '@/components/arc/button/button'
import { Dialog, DialogTrigger, DialogContent } from '@/components/arc/dialog/dialog'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
// 仅供验证跑通的临时引入：foundation.css 的 :root[data-theme='dark']（特异性 0,2,0）
// 会盖过 cssVars.ts 注入的 :root/.dark（0,1,0），全局引入不可行——票 03 结论素材
import '@/components/arc/foundation.css'

// TanStack Router lazy() 走 module.default（对齐 PocPierreDiff 模式）
export default ShadcnVerifyPage

/** 二分定位壳：只标注崩溃源 */
function Probe({ name, children }: { name: string; children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <div data-probe={name}>{children}</div>
        </ErrorBoundary>
    )
}

// 风险①场景：emotion unlayered `& > *` 对 layer 内 Tailwind utilities 的压制
const CascadeHost = styled.div`
    & > * {
        background-color: rgb(255, 0, 0);
    }
`

export function ShadcnVerifyPage() {
    const [antdOpen, setAntdOpen] = useState(false)
    const [arcOpen, setArcOpen] = useState(false)
    const [standaloneOpen, setStandaloneOpen] = useState(false)
    return (
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 风险①：级联优先级 */}
            <section data-testid="cascade-section">
                <CascadeHost>
                    <div data-testid="cascade-target" className="bg-background" style={{ width: 40, height: 40 }} />
                </CascadeHost>
            </section>

            {/* 风险②：antd Modal 内叠开 uiarc Dialog（Radix portal z-50/51 vs antd 1000+） */}
            <section data-testid="stack-section" style={{ display: 'flex', gap: 8 }}>
                <Probe name="antd-button">
                    <AntButton data-testid="open-antd-modal" onClick={() => setAntdOpen(true)}>
                        打开 antd Modal
                    </AntButton>
                </Probe>
                <Probe name="arc-button">
                    <ArcButton data-testid="arc-hello">arc 按钮</ArcButton>
                </Probe>
            </section>

            {/* 风险③：滚动锁——快速开关 uiarc Dialog */}
            <section data-testid="lock-section" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Probe name="arc-dialog-closed">
                    <Dialog open={standaloneOpen} onOpenChange={setStandaloneOpen}>
                        <DialogTrigger asChild>
                            <ArcButton data-testid="open-arc-standalone">开/关 arc Dialog</ArcButton>
                        </DialogTrigger>
                        <DialogContent title="standalone dialog" description="滚动锁验证用">
                            <div>内容</div>
                        </DialogContent>
                    </Dialog>
                </Probe>
                <AntButton
                    data-testid="toggle-arc-fast"
                    onClick={() => {
                        for (let i = 0; i < 5; i++) {
                            setStandaloneOpen((v) => !v)
                        }
                    }}
                >
                    连续开关 5 次
                </AntButton>
                <span data-testid="arc-open-flag">{String(standaloneOpen)}</span>
            </section>

            {/* 撑出页面滚动，验证 body 锁与滚动条补偿 */}
            <div style={{ height: 2000, background: 'repeating-linear-gradient(0deg, transparent, transparent 99px, rgba(128,128,128,.15) 100px)' }} />

            <Modal title="antd Modal" open={antdOpen} onCancel={() => setAntdOpen(false)} footer={null}>
                <div data-testid="antd-modal-body">
                    <ArcButton data-testid="open-arc-in-modal" onClick={() => setArcOpen(true)}>
                        在 Modal 内开 arc Dialog
                    </ArcButton>
                </div>
            </Modal>

            {/* 风险②的受测实体（受控，打开时 Radix portal 到 body） */}
            <Probe name="arc-dialog-controlled">
                <Dialog open={arcOpen} onOpenChange={setArcOpen}>
                    <DialogContent title="nested dialog" description="z-index 验证用">
                        <div data-testid="arc-dialog-body">内容</div>
                    </DialogContent>
                </Dialog>
            </Probe>
        </div>
    )
}
