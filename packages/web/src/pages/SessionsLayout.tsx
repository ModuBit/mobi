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

import { Outlet } from '@tanstack/react-router'
import styled from '@emotion/styled'

const MainContentArea = styled.div`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
`

/**
 * 会话布局组件
 * Session list 改为 overlay Drawer 模式，内容区始终占满宽度
 */
export function SessionsLayout() {
    return (
        <MainContentArea>
            <Outlet />
        </MainContentArea>
    )
}
