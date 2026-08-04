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
import { StatusStateIcon, STATUS_DOT_COLORS } from '@/components/tool-card/toolIcons'
import { formatGroupTitle, countFailedInGroup } from '@/domain/chat/groupToolCalls'

/**
 * 组头状态 icon：主体 completed 绿点（组已落定），含失败工具时右上角叠小红角标提示。
 * 主体不染红（避免一个失败染红整组），也不掩盖失败（角标可见 + 标题「· N failed」承载计数）。
 */
function ToolCallGroupIcon({ hasError }: { hasError: boolean }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <StatusStateIcon state="completed" />
      {hasError && (
        <span
          style={{
            position: 'absolute',
            top: -1,
            right: -2,
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: STATUS_DOT_COLORS.error,
            // 描一圈容器底色，避免红点与绿点重叠时糊在一起
            boxShadow: '0 0 0 1px var(--ant-color-bg-container)',
          }}
        />
      )}
    </span>
  )
}

export function ToolCallGroupRenderer({
  blocks,
  ...ctx
}: {
  blocks: Array<ToolCallBlock | AgentReasoningBlock>
} & ChatBlockContext) {
  const [expanded, setExpanded] = useState(false)
  // hasError 与标题「· N failed」共用 countFailedInGroup，避免两处独立判定漂移
  const failedCount = useMemo(() => countFailedInGroup(blocks), [blocks])
  const title = useMemo(() => formatGroupTitle(blocks), [blocks])

  return (
    <Think
      className="tool-call-think"
      icon={<ToolCallGroupIcon hasError={failedCount > 0} />}
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
            inGroup
            {...ctx}
          />
        ))}
      </div>
    </Think>
  )
}
