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
import { Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentReasoningBlock, ToolCallBlock } from '@/domain/chat'
import type { ChatBlockContext } from './index'
import { ToolCallRenderer } from './ToolCallBlock'
import { ReasoningBlock } from './ReasoningBlock'
import { STATUS_DOT_COLORS, StatusIcon } from '@/components/tool-card/toolIcons'
import {
  countFailedInGroup,
  formatGroupTitle,
  formatGroupActiveTitle,
  type IsActiveReasoning,
} from '@/domain/chat/groupToolCalls'
import { CrossfadeText } from '@/components/ui/CrossfadeText'

/**
 * 组头状态 icon：Layers 图标承载组状态——组活跃（运行/审批中）蓝呼吸，落定绿静态；
 * 含失败工具时右上角叠小红角标提示。主体不染红（避免一个失败染红整组），
 * 失败计数由标题「· N 个失败」后缀承载（汇总/动态两种形态均追加，withFailedSuffix 单点实现）。
 */
function ToolCallGroupIcon({ hasError, hasActive }: { hasError: boolean; hasActive: boolean }) {
  return (
    <StatusIcon state={hasActive ? 'running' : 'completed'} style={{ position: 'relative' }}>
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
    </StatusIcon>
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
  // 失败数/动态标题/活跃态单处派生（activeTitle 非 null ⟺ 组活跃）。
  // failedCount 只算一次、传给两种标题形态（动态形态也追加「· N 个失败」，失败不变式两态通用）。
  // 注：blocks/isActiveReasoning 每帧都是新引用，此处不做 memo——计算本身即每帧必付的成本
  const failedCount = countFailedInGroup(blocks)
  const activeTitle = formatGroupActiveTitle(blocks, { t, isActiveReasoning, failedCount })
  const hasActive = activeTitle != null
  const title = activeTitle ?? formatGroupTitle(blocks, t, { failedCount })

  return (
    <Think
      className="tool-call-think"
      icon={<ToolCallGroupIcon hasError={failedCount > 0} hasActive={hasActive} />}
      title={
        <span style={{ fontWeight: 500, fontSize: 13 }}>
          {/* 组活跃时标题微光扫过（强调「正在推进」），落定回汇总文案自动停止 */}
          <CrossfadeText text={title} shimmer={hasActive} />
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

