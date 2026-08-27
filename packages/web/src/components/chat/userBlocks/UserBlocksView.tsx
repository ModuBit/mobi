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

import type React from 'react'
import { theme } from 'antd'
import { FileCard } from '@ant-design/x'
import { Bot, User } from 'lucide-react'
import type {
    UserContentBlock, UserDocumentBlock, UserImageBlock, UserQuoteBlock, UserTextBlock,
} from '@mobi/shared'
import { groupUserBlocks } from '@/domain/chat/userContent'
import { buildReadFileUrl } from '@/core/utils/fileUrl'
import { TextBlock } from '../blocks/TextBlock'

/** 渲染视图共用的上下文：文本柔和样式（合成消息）与会话文件 URL 构造所需 */
export interface UserBlockRenderEnv {
    /** 合成消息：text 视图走弱化 span（原 TextBlock isSynthetic 语义，如 rewind 命令标记行） */
    isSynthetic?: boolean
    /** 会话 ID：image/document 的服务端路径经 read-file 端点构造 src */
    sessionId?: string
}

/** 各类型视图的统一 props 形态（block 字段按注册键收窄） */
interface UserBlockViewProps<B extends UserContentBlock> {
    block: B
    env: UserBlockRenderEnv
}

/**
 * text 视图：完全复用 agent 消息同款 Markdown 渲染通道（斜杠命令 / @ 引用徽章启用）。
 * 合成消息保持 TextBlock 的弱化样式语义。
 */
function TextView({ block, env }: UserBlockViewProps<UserTextBlock>) {
    return <TextBlock text={block.text} isSynthetic={env.isSynthetic} enableSlashCommand enableMention />
}

/**
 * quote 视图（自研轻量）：左边框灰底小条 + 角色 icon + excerpt。
 * hover title 展示全文；不承接点击定位原文——引用追溯走 RewindConfirmView 等既有入口（YAGNI）。
 */
function QuoteView({ block }: UserBlockViewProps<UserQuoteBlock>) {
    const { token } = theme.useToken()
    // 角色一眼可辨即可，配色取主题灰系 token，不引入主题外颜色
    const RoleIcon = block.role === 'user' ? User : Bot
    return (
        <div
            data-testid={`user-quote-${block.messageId}`}
            title={block.excerpt}
            style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
                padding: '4px 8px',
                borderLeft: `3px solid ${token.colorBorderSecondary}`,
                background: token.colorFillQuaternary,
                borderRadius: token.borderRadiusSM,
                color: token.colorTextSecondary,
                fontSize: 12,
                lineHeight: '18px',
                maxWidth: '100%',
            }}
        >
            <RoleIcon size={12} style={{ flexShrink: 0, marginTop: 3, color: token.colorTextTertiary }} />
            <span style={{ wordBreak: 'break-word' }}>{block.excerpt}</span>
        </div>
    )
}

/**
 * document 视图：FileCard 小尺寸文件卡。图标由 FileCard 按扩展名自动映射
 * PresetIcons（pdf/word/markdown/excel/ppt/zip/java/javascript/python 等，缺省 default），
 * 无需自维护映射表。
 */
function DocumentView({ block }: UserBlockViewProps<UserDocumentBlock>) {
    return <FileCard size="small" type="file" name={block.filename} byte={block.size} />
}

/**
 * image 视图：FileCard 小尺寸图片卡，antd Image 自带点击放大 preview。
 * blob:/data:/http(s):// 等自足 URL 直接用（乐观回显的本地预览）；
 * 否则视为服务端 .mobi/uploads 路径，经 read-file 端点构造（etag v 参数机制由该函数统管）。
 */
function ImageView({ block, env }: UserBlockViewProps<UserImageBlock>) {
    const raw = block.previewUrl ?? block.source.value
    const src = /^(blob:|data:|https?:\/\/)/i.test(raw) ? raw : buildReadFileUrl(env.sessionId ?? '', raw)
    return (
        <FileCard
            size="small"
            type="image"
            name={block.filename}
            byte={block.size}
            src={src}
            imageProps={{ preview: true }}
        />
    )
}

/**
 * 用户消息 content block → 视图注册表（对齐 knownTools 工具卡注册惯例）：
 * shared 新增 block 类型时在此加一行即可接入渲染。
 */
export const USER_BLOCK_RENDERERS: {
    [K in UserContentBlock['type']]: React.FC<UserBlockViewProps<Extract<UserContentBlock, { type: K }>>>
} = {
    text: TextView,
    quote: QuoteView,
    document: DocumentView,
    image: ImageView,
}

/**
 * 用户消息气泡内容视图：按 blocks 顺序分发到各类型视图。
 *
 * - 连续 document 由 {@link groupUserBlocks} 归并后以 FileCard.List（wrap 流式排布）合并展示；
 * - 其余 block 逐块渲染，保持发送侧分段顺序。
 */
export function UserBlocksView({ blocks, env }: { blocks: readonly UserContentBlock[]; env?: UserBlockRenderEnv }) {
    const renderEnv: UserBlockRenderEnv = env ?? {}
    return (
        <>
            {groupUserBlocks(blocks).map((seg, i) => {
                if (seg.kind === 'documents') {
                    return (
                        <FileCard.List
                            key={`docs-${seg.blocks[0].id}`}
                            size="small"
                            overflow="wrap"
                            items={seg.blocks.map(d => ({ name: d.filename, byte: d.size }))}
                        />
                    )
                }
                const b = seg.block
                // key：业务 id 优先；text 块无 id，用序号兜底（blocks 与分段一一对应，同内容下稳定）
                const key = b.type === 'quote' ? `quote-${b.messageId}` : ('id' in b ? b.id : `text-${i}`)
                // 注册表分发：索引访问得到四类视图的联合签名，收窄为统一调用形态。
                // 运行时安全——UserContentBlock 为 discriminatedUnion，type 与视图键一一对应
                const View = USER_BLOCK_RENDERERS[b.type] as React.FC<UserBlockViewProps<UserContentBlock>>
                return <View key={key} block={b} env={renderEnv} />
            })}
        </>
    )
}
