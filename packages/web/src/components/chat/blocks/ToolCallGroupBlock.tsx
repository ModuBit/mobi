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
import { Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentReasoningBlock, ToolCallBlock } from '@/domain/chat'
import type { ChatBlockContext } from './index'
import { ToolCallRenderer } from './ToolCallBlock'
import { ReasoningBlock } from './ReasoningBlock'
import { STATUS_DOT_COLORS, statusIconStyle } from '@/components/tool-card/toolIcons'
import {
  isActiveTool,
  countFailedInGroup,
  formatGroupTitle,
  formatGroupActiveTitle,
  type IsActiveReasoning,
} from '@/domain/chat/groupToolCalls'
import { CrossfadeText } from '@/components/ui/CrossfadeText'

/** 组内是否存在活跃块（运行中/等待审批的工具，或正在思考的 reasoning）—— 组头 icon 与标题形态的判定来源 */
function hasActiveBlock(blocks: Array<ToolCallBlock | AgentReasoningBlock>, isActiveReasoning?: IsActiveReasoning): boolean {
  return blocks.some(b =>
    b.kind === 'agent-reasoning'
      ? (isActiveReasoning?.(b) ?? false)
      : isActiveTool(b)
  )
}

/**
 * 组头状态 icon：Layers 图标承载组状态——组活跃（运行/审批中）蓝呼吸，落定绿静态；
 * 含失败工具时右上角叠小红角标提示。主体不染红（避免一个失败染红整组），
 * 也不掩盖失败（角标可见 + 标题「· N failed」承载计数）。
 */
function ToolCallGroupIcon({ hasError, hasActive }: { hasError: boolean; hasActive: boolean }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...statusIconStyle(hasActive ? 'running' : 'completed') }}>
      <Layers size={14} />
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
            // 描一圈容器底色，避免红点与图标重叠时糊在一起
            boxShadow: '0 0 0 1px var(--ant-color-bg-container)',
          }}
        />
      )}
    </span>
  )
}

export function ToolCallGroupRenderer({
  blocks,
  isActiveReasoning,
  ...ctx
}: {
  blocks: Array<ToolCallBlock | AgentReasoningBlock>
  /** 活跃 reasoning（正在思考）判定，由 buildBubbleItems 传入：驱动组头「正在思考」动态标题与组内 thinking 展开态 */
  isActiveReasoning?: IsActiveReasoning
} & ChatBlockContext) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  // hasError 与标题「· N failed」共用 countFailedInGroup，避免两处独立判定漂移
  const failedCount = useMemo(() => countFailedInGroup(blocks), [blocks])
  // 组头标题：有活跃块（运行中/等待审批/正在思考）展示时序最新的一个，否则回退汇总统计
  const title = useMemo(
    () => formatGroupActiveTitle(blocks, { t, isActiveReasoning }) ?? formatGroupTitle(blocks, t),
    [blocks, t, isActiveReasoning],
  )
  const hasActive = useMemo(() => hasActiveBlock(blocks, isActiveReasoning), [blocks, isActiveReasoning])

  return (
    <Think
      className="tool-call-think"
      icon={<ToolCallGroupIcon hasError={failedCount > 0} hasActive={hasActive} />}
      title={
        <span style={{ fontWeight: 500, fontSize: 13 }}>
          <CrossfadeText text={title} />
        </span>
      }
      expanded={expanded}
      onExpand={setExpanded}
    >
      <div style={{ paddingLeft: 12, paddingRight: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {blocks.map(block => block.kind === 'agent-reasoning' ? (
          // 组内 reasoning 用真实活跃态：正在思考时行头展开（「思考中...」），完成收起（「思考完成」）
          <ReasoningBlock
            key={block.id}
            text={block.text}
            thinking={isActiveReasoning?.(block) ?? false}
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
