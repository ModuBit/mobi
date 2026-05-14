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

import { useState } from 'react'
import { Think } from '@ant-design/x'
import { CheckCircleOutlined } from '@ant-design/icons'
import type { ToolCallBlock } from '@/domain/chat'
import type { ChatBlockContext } from './index'
import { ToolCallRenderer } from './ToolCallBlock'
import { formatGroupTitle } from '@/domain/chat/groupToolCalls'

export function ToolCallGroupRenderer({
  blocks,
  ...ctx
}: {
  blocks: ToolCallBlock[]
} & ChatBlockContext) {
  const [expanded, setExpanded] = useState(false)
  const title = formatGroupTitle(blocks)

  return (
    <Think
      className="tool-call-think"
      icon={<CheckCircleOutlined style={{ fontSize: 14, color: 'var(--ant-color-success)' }} />}
      title={
        <span style={{ fontWeight: 500, fontSize: 13 }}>
          {title}
        </span>
      }
      expanded={expanded}
      onExpand={setExpanded}
    >
      {blocks.map(block => (
        <ToolCallRenderer
          key={block.id}
          block={block}
          {...ctx}
        />
      ))}
    </Think>
  )
}
