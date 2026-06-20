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

import { Layout } from 'antd'
import FileTree from './FileTree'

interface FileViewProps {
    sessionId: string
}

/**
 * 文件视图：仅渲染文件树。
 * 顶部 chrome（Tabs、收起按钮）由 InspectorPane 提供；Git 由顶层 InspectorTab 承载。
 */
export function FileView({ sessionId }: FileViewProps) {
    return (
        <Layout style={{ height: '100%' }}>
            <Layout.Content style={{ flex: 1, overflow: 'hidden' }}>
                <FileTree sessionId={sessionId} />
            </Layout.Content>
        </Layout>
    )
}
