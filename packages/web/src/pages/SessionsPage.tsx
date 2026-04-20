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

import { Button, Empty, Layout, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/core/data/stores/uiStore'
import { useSessionGroups } from '@/core/data/hooks/queries/useSessionGroups'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { PageHeader } from '@/components/layout/PageHeader'
import { IconButton } from '@/components/ui/IconButton'
import { Plus, List } from 'lucide-react'

/**
 * 会话列表页（索引）
 * - 空列表时显示新建按钮，点击打开新建会话 Drawer
 * - 有会话时提示选择
 */
export function SessionsPage() {
    const { t } = useTranslation()
    const { data: groups = [], isLoading } = useSessionGroups()
    const hasSessions = groups.some(g => g.totalCount > 0)
    const isMobile = useIsMobile()
    const { setSessionListDrawerOpen, setNewSessionDrawerOpen } = useUiStore()

    const handleNewSession = () => {
        setNewSessionDrawerOpen(true)
    }

    const content = !hasSessions
        ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Empty
                    description={t('session.empty')}
                >
                    <Button
                        type="primary"
                        icon={<Plus size={16} />}
                        onClick={handleNewSession}
                    >
                        {t('session.newSession')}
                    </Button>
                </Empty>
            </div>
        )
        : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Empty description={t('session.selectToView')}>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                            icon={<List size={16} />}
                            onClick={() => setSessionListDrawerOpen(true)}
                        >
                            {t('nav.sessions')}
                        </Button>
                        <Button
                            type="primary"
                            icon={<Plus size={16} />}
                            onClick={handleNewSession}
                        >
                            {t('session.newSession')}
                        </Button>
                    </div>
                </Empty>
            </div>
        )

    if (isLoading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Spin size="large" />
            </div>
        )
    }

    // 移动端：顶部 header + 内容
    if (isMobile) {
        return (
            <Layout style={{ height: '100%' }}>
                <PageHeader
                    left={<MobileMenuButton />}
                    right={
                        <IconButton
                            icon={<List size={18} />}
                            onClick={() => setSessionListDrawerOpen(true)}
                        />
                    }
                />
                <Layout.Content>
                    {content}
                </Layout.Content>
            </Layout>
        )
    }

    // PC 端：header + 内容
    return (
        <Layout style={{ height: '100%' }}>
            <PageHeader
                right={
                    <IconButton
                        icon={<List size={18} />}
                        tooltip={t('nav.sessions')}
                        onClick={() => setSessionListDrawerOpen(true)}
                    />
                }
            />
            <Layout.Content>
                {content}
            </Layout.Content>
        </Layout>
    )
}
