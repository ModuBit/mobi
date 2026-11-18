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

import { Folder } from 'lucide-react'
import { FileTypeBadge } from '@/ui/base/display/FileTypeBadge'

export function MentionDirectoryIcon() {
    return <Folder size={13} strokeWidth={2.4} style={{ verticalAlign: -2, marginRight: 3 }} aria-hidden="true" />
}

/** 消息里的文件由 ActionLink 打开，编辑器的图标不参与编辑或导航。 */
export function FileMentionIcon({ path, kind }: { path: string; kind: 'file' | 'directory' }) {
    return kind === 'directory' ? <MentionDirectoryIcon /> : <FileTypeBadge path={path} knownFile />
}
