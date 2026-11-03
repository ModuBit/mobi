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

import { Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { ArchivedSessionsPage } from '@/features/layout/ArchivedSessionsPage'
import { MobileMenuButton } from '@/features/layout/mobileMenu'
import { SidebarToggle } from '@/features/layout/SidebarToggle'
import { PageHeader } from '@/features/layout/PageHeader'

const { Title } = Typography

/**
 * 已归档会话页（session-retention 票 05）：独立整页路由（非抽屉/弹窗），
 * 桌面从侧栏「已归档」入口进入、移动端从汉堡菜单整页打开。列表本体在
 * features/layout/ArchivedSessionsPage，此处只做头部与骨架组装。
 */
export function ArchivedPage() {
    const { t } = useTranslation()

    return (
        <>
            <PageHeader
                left={<>
                    <SidebarToggle />
                    <MobileMenuButton />
                    <Title level={5} style={{ margin: 0 }}>{t('archived.title')}</Title>
                </>}
            />
            <ArchivedSessionsPage />
        </>
    )
}
