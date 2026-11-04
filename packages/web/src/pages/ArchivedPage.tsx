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

import styled from '@emotion/styled'
import { ArchivedSessionsPage } from '@/features/layout/ArchivedSessionsPage'
import { MobileMenuButton } from '@/features/layout/mobileMenu'
import { SidebarToggle } from '@/features/layout/SidebarToggle'
import { PageHeader } from '@/features/layout/PageHeader'

/** 页面根容器：MainLayout.Content 是 row 方向 flex——页面必须自带纵向列容器并
 *  flex:1 占满，否则 PageHeader 被拉伸成全高竖条、内容列塌缩成内容宽 */
const ArchivedContainer = styled.div`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
`

/**
 * 已归档会话页（session-retention 票 05，形态一比一对齐 ChatGPT 归档页）：
 * 头部横条只承载侧栏/菜单开关锚位，大标题与批量动作在内容区内（ArchivedSessionsPage）。
 */
export function ArchivedPage() {
    return (
        <ArchivedContainer>
            <PageHeader left={<>
                <SidebarToggle />
                <MobileMenuButton />
            </>} />
            <ArchivedSessionsPage />
        </ArchivedContainer>
    )
}
