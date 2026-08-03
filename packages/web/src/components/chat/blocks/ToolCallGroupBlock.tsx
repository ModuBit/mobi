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

import { useState, useMemo } from 'react'
import { Think } from '@ant-design/x'
import type { AgentReasoningBlock, ToolCallBlock } from '@/domain/chat'
import type { ChatBlockContext } from './index'
import { ToolCallRenderer } from './ToolCallBlock'
import { ReasoningBlock } from './ReasoningBlock'
import { StatusStateIcon } from '@/components/tool-card/toolIcons'
import { formatGroupTitle } from '@/domain/chat/groupToolCalls'

export function ToolCallGroupRenderer({
  blocks,
  ...ctx
}: {
  blocks: Array<ToolCallBlock | AgentReasoningBlock>
} & ChatBlockContext) {
  const [expanded, setExpanded] = useState(false)
  const title = useMemo(() => formatGroupTitle(blocks), [blocks])

  return (
    <Think
      className="tool-call-think"
      icon={<StatusStateIcon state="completed" />}
      title={
        <span style={{ fontWeight: 500, fontSize: 13 }}>
          {title}
        </span>
      }
      expanded={expanded}
      onExpand={setExpanded}
    >
      <div style={{ paddingLeft: 12, paddingRight: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {blocks.map(block => block.kind === 'agent-reasoning' ? (
          // 组内 reasoning 都是已完成（活跃的已在分组时散落到组外）：thinking=false，仅透传 durationMs
          <ReasoningBlock
            key={block.id}
            text={block.text}
            thinking={false}
            durationMs={block.durationMs}
          />
        ) : (
          <ToolCallRenderer
            key={block.id}
            block={block}
            {...ctx}
          />
        ))}
      </div>
    </Think>
  )
}
