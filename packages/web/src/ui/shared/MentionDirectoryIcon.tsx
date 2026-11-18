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

import type { FileTargetType } from '@/core/lib/fileTypeMeta'
import { createFileBadgeElement, MENTION_FOLDER_SVG } from '@/ui/base/display/FileTypeBadge'

const folderHtml = { __html: MENTION_FOLDER_SVG }
const folderClass = 'mention-directory-icon'

export function MentionDirectoryIcon() {
    return <span aria-hidden="true" className={folderClass} dangerouslySetInnerHTML={folderHtml} />
}

/** 只持有图标类型，不捕获文档、路径或本轮装饰状态。 */
export function fileMentionWidget(kind: 'file' | 'directory', type: FileTargetType | null) {
    return (view: { dom: HTMLElement }) => {
        const doc = view.dom.ownerDocument
        const dom = doc.createElement('span')
        dom.className = kind === 'directory' ? 'file-mention-widget mention-directory' : 'file-mention-widget'
        dom.setAttribute('aria-hidden', 'true')
        dom.setAttribute('data-mention-icon', kind)
        if (kind === 'directory') {
            dom.classList.add(folderClass)
            dom.innerHTML = folderHtml.__html
        } else if (type) {
            dom.append(createFileBadgeElement(doc, type))
        }
        return dom
    }
}
