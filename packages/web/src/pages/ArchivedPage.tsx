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
 * 已归档会话页（session-retention 票 05，PC 形态一比一对齐 ChatGPT 归档页）：
 * 无独立头部横条——侧栏/菜单开关锚位并进标题行（ArchivedSessionsPage 的
 * headerLeft），避免 PC 侧栏展开时整行空占高度、移动端标题行再省一行。
 */
export function ArchivedPage() {
    return (
        <ArchivedContainer>
            <ArchivedSessionsPage
                headerLeft={<>
                    <SidebarToggle />
                    <MobileMenuButton />
                </>}
            />
        </ArchivedContainer>
    )
}
