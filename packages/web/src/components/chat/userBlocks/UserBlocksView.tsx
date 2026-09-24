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
import { useMemo, useState } from 'react'
import { Button, theme, Space, Image } from 'antd'
import { useTranslation } from 'react-i18next'
import { FileCard } from '@ant-design/x'
import { Bot, Pencil, User } from 'lucide-react'
import styled from '@emotion/styled'
import type {
    UserContentBlock, UserDocumentBlock, UserImageBlock, UserQuoteBlock, UserTextBlock,
} from '@mobi/shared'
import { groupUserBlocks } from '@/domain/chat/userContent'
import { quoteAnchorProps } from '@/domain/chat/quoteSelection'
import { truncatePreview } from '@/core/lib/truncatePreview'
import { resolveUserImageUrl, type FileRefContext } from '@/core/utils/fileUrl'
import { FALLBACK_IMAGE } from '@/core/utils/fallbackImage'
import { buildActionUri } from '@mobi/shared'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { ActionLink } from '@/components/ui/ActionLink'
import { SketchEditBadge } from '@/components/ui/SketchEditBadge'
import { AppTooltip } from '@/components/ui/AppTooltip'
import { TextBlock } from '../blocks/TextBlock'

/** 渲染视图共用的上下文：文本柔和样式（合成消息）与会话文件 URL 构造所需 */
export interface UserBlockRenderEnv {
    /** 合成消息：text 视图走弱化 span（原 TextBlock isSynthetic 语义，如 rewind 命令标记行） */
    isSynthetic?: boolean
    /** 附件取数上下文（session 优先，无会话行回退 machine；字段投影单源 fileRefContext） */
    refCtx?: FileRefContext
    /**
     * 画板重编辑入口（仅 sketch 标记的 image block 渲染编辑角标）：
     * 回调收到的 block 交由调用方取 PNG → 重开画板（历史不可变，产物落回 composer）
     */
    onEditSketch?: (block: UserImageBlock) => void
    /** 选区引用：text 视图落 data-quote-block 容器锚（聊天列表接线；其它使用方缺省不落） */
    quoteBlockAnchor?: boolean
    /**
     * 引用条目点击定位入口（消息级：滚动到源消息 + 高亮，见 core/lib/quoteLocate）。
     * 交互只在聊天列表接线处有意义——非聊天上下文缺省不传，引用组退化为纯展示
     * （对齐 onEditSketch 的可选能力位模式）
     */
    onQuoteLocate?: (messageId: string) => void
}

/** 各类型视图的统一 props 形态（block 字段按注册键收窄） */
interface UserBlockViewProps<B extends UserContentBlock> {
    block: B
    env: UserBlockRenderEnv
}

/** sketch 缩略图容器：hover 时浮现编辑角标（对齐 bubbleCopyStyles 的 hover 显现模式） */
const SketchEditableWrapper = styled.span`
    position: relative;
    display: inline-flex;

    .sketch-edit-badge {
        opacity: 0;
        transition: opacity 0.15s ease;
    }
    &:hover .sketch-edit-badge {
        opacity: 1;
    }
`

/**
 * text 视图：完全复用 agent 消息同款 Markdown 渲染通道（斜杠命令 / @ 引用徽章启用）。
 * 合成消息保持 TextBlock 的弱化样式语义。
 */
function TextView({ block, env }: UserBlockViewProps<UserTextBlock>) {
    const textNode = <TextBlock text={block.text} isSynthetic={env.isSynthetic} enableSlashCommand enableMention />
    // 选区引用 block 容器锚：仅聊天列表接线时落地（判定器要求选区端点落在 block 锚内）
    if (!env.quoteBlockAnchor) return textNode
    return <div {...quoteAnchorProps({ block: true })}>{textNode}</div>
}

/** 引用条目预览截断宽度：超出省略号截断，全文由 AppTooltip 承载（截断不阻碍阅读全文） */
const QUOTE_PREVIEW_MAX = 120

/**
 * quote 行视图（引用组内单条渲染）：编号 + 角色 icon + excerpt 预览（超 {@link QUOTE_PREVIEW_MAX}
 * 截断，全文走 AppTooltip 的 PC hover / 移动端长按）+ 可选评论全显异色——excerpt 是别人的话
 * （静音灰三级），comment 是用户自己的话（提一级次级灰），同为灰系 token 不引入主题外颜色。
 * 点击 = 消息级定位（env.onQuoteLocate 提供时）；缺省退化为纯展示（无 pointer 光标）。
 */
function QuoteView({ block, env, index = 0, divided = false }:
    UserBlockViewProps<UserQuoteBlock> & { index?: number; divided?: boolean }) {
    const { token } = theme.useToken()
    // 角色一眼可辨即可，配色取主题灰系 token
    const RoleIcon = block.role === 'user' ? User : Bot
    const clickable = !!env.onQuoteLocate
    return (
        <AppTooltip title={block.excerpt} mouseEnterDelay={0.4}>
            <div
                data-testid={`user-quote-${block.messageId}`}
                onClick={clickable ? () => env.onQuoteLocate?.(block.messageId) : undefined}
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                    padding: divided ? '5px 8px' : '4px 8px',
                    // 条间细分隔线（首条无线）
                    ...(divided ? { borderTop: `1px solid ${token.colorBorderSecondary}` } : {}),
                    cursor: clickable ? 'pointer' : undefined,
                    fontSize: 12,
                    lineHeight: '18px',
                    maxWidth: '100%',
                }}
            >
                <span style={{ flexShrink: 0, color: token.colorTextTertiary }}>{index + 1}.</span>
                <RoleIcon size={12} style={{ flexShrink: 0, marginTop: 3, color: token.colorTextTertiary }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: token.colorTextTertiary, wordBreak: 'break-word' }}>
                        {truncatePreview(block.excerpt, QUOTE_PREVIEW_MAX)}
                    </div>
                    {block.comment && (
                        <div style={{ color: token.colorTextSecondary, wordBreak: 'break-word' }}>
                            {block.comment}
                        </div>
                    )}
                </div>
            </div>
        </AppTooltip>
    )
}

/**
 * 引用组视图：发送后气泡内全部引用的合并呈现容器（对齐 CONTEXT「引用组」词条与 composer
 * 引用胶囊的编号词汇）——一个组件内编号连续、条间细分隔线，替代散落独立引用块。
 *
 * 编号恒显示（单条也编）：编号是 chip（「N 条引用」列表）/ prompt（<quote index>）/ 气泡
 * 三处一致的跨端锚点（spec 用户故事 26），单条省略编号会让「关于 #1」在气泡侧失去对应。
 *
 * 组是引用禁区：data-quote-forbidden（判定器的第二道防御）+ user-select:none——
 * 引用组内文本不可被选中引用，「引用的引用」语义混乱。
 */
function QuoteGroupView({ blocks, env }: { blocks: UserQuoteBlock[]; env: UserBlockRenderEnv }) {
    const { token } = theme.useToken()
    const anchorProps = quoteAnchorProps({ forbidden: true })
    return (
        // 闪烁动画样式不在此注入——每实例 Global 会在长会话重复挂载同名规则，
        // 单份注入在 ChatContainer（quoteFlashStyles，随聊天列表生灭）
        <div {...anchorProps}>
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                borderLeft: `3px solid ${token.colorBorderSecondary}`,
                background: token.colorFillQuaternary,
                borderRadius: token.borderRadiusSM,
                maxWidth: '100%',
            }}>
                {blocks.map((b, i) => (
                    <QuoteView key={`${i}-${b.messageId}`} block={b} index={i} divided={i > 0} env={env} />
                ))}
            </div>
        </div>
    )
}

/**
 * document 视图：FileCard 小尺寸文件卡。图标由 FileCard 按扩展名自动映射
 * PresetIcons（pdf/word/markdown/excel/ppt/zip/java/javascript/python 等，缺省 default）。
 *
 * 点击 = mobi://file/open（ADR 0003 二期）：在 inspector pane 打开该附件
 * （block.source.value 即 .mobi/uploads 相对路径，与 inspector 读文件同一条
 * read-file 链）。URI 由 block 数据渲染时构造走统一执行链——block 结构化字段
 * 本身就是冻结快照（消息即快照，Q3 裁决），不改落库内容。
 * 点击入口复用 ActionLink（preventDefault/键盘分发已收口），不用手搓可点击 span。
 */
export function DocumentView({ block }: UserBlockViewProps<UserDocumentBlock>) {
    const card = <FileCard size="small" type="file" name={block.filename} byte={block.size} />
    // data source 是骨架占位（无磁盘路径），没有可打开目标 → 不绑定点击
    if (block.source.type !== 'url') return card
    return (
        <ActionLink
            uri={buildActionUri('file/open', { path: block.source.value, name: block.filename })}
            style={{ display: 'inline-flex' }}
        >
            {card}
        </ActionLink>
    )
}

/** 缩略图尺寸：聊天气泡内的小方块（微信/Slack 风格），点击可放大看原图 */
const IMAGE_THUMB_SIZE = 80

/**
 * image 视图：FileCard 纯图卡压成 80×80 cover 小缩略图，点击 Image 自带 preview 放大看原图。
 * 取数 URL 经 resolveUserImageUrl（core/utils/fileUrl）统一构造。
 *
 * 失败兜底由组件自管 failed 态（对齐 ImageContentView 的做法）：新版 @rc-component/image
 * 的 fallback 依赖内部 isImageValid 异步真加载，机制不透明且版本间易变——显式 onError 置
 * failed 换 src 到兜底图，行为可预期也可直接单测。文件名承载于 img alt（无障碍），不挂 tooltip。
 */
export function ImageView({ block, env }: UserBlockViewProps<UserImageBlock>) {
    const { token } = theme.useToken()
    const { t } = useTranslation()
    const isMobile = useIsMobile()
    const [failedFor, setFailedFor] = useState<string | null>(null)
    // 受控预览开关：预览是草图图片交互的枢纽——移动端的编辑入口就放在预览工具栏里
    const [previewOpen, setPreviewOpen] = useState(false)
    // 不带 etag v 参数：.mobi/uploads 为 write-once（上传即 shortId 唯一名，无覆盖路径），
    // 不存在同路径内容变化的陈旧缓存问题——变更语义由「重新上传得新路径」承载。
    const computed = resolveUserImageUrl(block, env.refCtx ?? {})
    // 失败态钉死在触发它的具体 src 上：src 变化（重试/网络恢复后重新渲染）自动重试。
    // 兜底图无放大价值，preview 一并关闭（点击不再弹出兜底图预览）
    const failed = failedFor === computed
    const src = failed || computed === null ? FALLBACK_IMAGE : computed
    // 画板重编辑入口（spec D3/D4）：仅内嵌 scene 的草图 + 调用方提供回调时渲染
    const sketchEditable = !!block.sketch && block.source.type === 'url' && !!env.onEditSketch
    // PC：hover 浮现编辑角标（快捷入口）；移动端角标不渲染——编辑走预览工具栏，
    // 避免与气泡的 rewind 长按手势在同一缩略图上竞争、也免去触屏无 hover 的常显干扰
    const showBadge = sketchEditable && !isMobile
    // 进编辑器前先收起预览（预览是全屏层，叠加在画板之上会互相遮挡）
    const openEditor = () => {
        setPreviewOpen(false)
        env.onEditSketch?.(block)
    }
    const card = (
        <FileCard
            type="image"
            name={block.filename}
            src={src}
            styles={{ file: {
                width: IMAGE_THUMB_SIZE,
                height: IMAGE_THUMB_SIZE,
                borderRadius: token.borderRadiusSM,
                overflow: 'hidden',
            } }}
            imageProps={{
                // 受控预览（点击缩略图放大看原图）；草图在预览工具栏追加编辑入口
                //（保留原图缩放/旋转等默认操作，originalNode 原样渲染）
                preview: !failed && {
                    open: previewOpen,
                    onOpenChange: setPreviewOpen,
                    ...(sketchEditable
                        ? {
                            actionsRender: (originalNode) => (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                                    {originalNode}
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<Pencil size={14} />}
                                        onClick={openEditor}
                                    >
                                        {t('sketch.editSketch')}
                                    </Button>
                                </div>
                            ),
                        }
                        : {}),
                },
                fallback: FALLBACK_IMAGE,
                // 原生懒加载：rc-image COMMON_PROPS 白名单把 loading/decoding 透传到真实 <img>，
                // 视口外的历史图片不再随恢复/流式渲染一拥而上抢请求；已在视口内则立即加载，首屏无损。
                // 旧浏览器不支持时退化为 eager，安全降级。测试锁定该透传链路
                loading: 'lazy',
                decoding: 'async',
                // styles.image 才落在 <img> 元素上：width/height 只定外层容器，裁切必须单独传
                styles: { image: { objectFit: 'cover' } },
                onError: () => setFailedFor(computed),
            }}
        />
    )
    if (!sketchEditable) return card
    return (
        <SketchEditableWrapper>
            {card}
            {showBadge && (
                <SketchEditBadge
                    showOnHover
                    label={t('sketch.editSketch')}
                    onClick={(e) => {
                        // 角标只开编辑器，不穿透到缩略图的原图预览
                        e.stopPropagation()
                        env.onEditSketch?.(block)
                    }}
                />
            )}
        </SketchEditableWrapper>
    )
}

/**
 * 多图段视图：段内所有图共享一条组预览时间线（Image.PreviewGroup）——点击任一张放大后
 * 可直接上一张/下一张（含键盘 ←/→ 与 1/N 进度），不必关闭再点下一张。
 *
 * - items 显式下发而非依赖子 Image 注册：组预览的 current 与 blocks 顺序一一对应，
 *   不受「加载失败缩略图退出注册（canPreview=false）」造成的序号漂移影响；src 与
 *   ImageView 内部同源（resolveUserImageUrl），点击缩略图按 src 命中下标。
 * - 单图也走组（形态一致）；组内只有一张时无切换箭头与 1/N 计数，行为不变。
 * - 草图编辑入口从「单图预览工具栏」平移到「组预览工具栏」：按 current 反查 src 对应
 *   的 sketch 可编辑块（上传 shortId 路径唯一，src 即身份），仅草图块渲染编辑按钮，
 *   点击先收组预览再进编辑器（预览是全屏层，与画板互相遮挡）。
 */
export function UserImageGroupView({ blocks, env }: { blocks: readonly UserImageBlock[]; env: UserBlockRenderEnv }) {
    const { t } = useTranslation()
    // 组预览受控开关：关闭的唯一受控路径（草图编辑前先收起）；点击缩略图打开也经它
    const [previewOpen, setPreviewOpen] = useState(false)

    const items = useMemo(
        () => blocks
            .map(b => resolveUserImageUrl(b, env.refCtx ?? {}))
            .filter((src): src is string => src !== null)
            .map(src => ({ src })),
        [blocks, env.refCtx],
    )
    // src → sketch 可编辑块（仅 url 形态 + 调用方提供回调时进入映射）
    const sketchEditableBySrc = useMemo(() => new Map(
        blocks
            .filter(b => !!b.sketch && b.source.type === 'url' && !!env.onEditSketch)
            .map(b => [resolveUserImageUrl(b, env.refCtx ?? {}), b]),
    ), [blocks, env.onEditSketch, env.refCtx])

    return (
        <Image.PreviewGroup
            items={items}
            preview={{
                open: previewOpen,
                onOpenChange: setPreviewOpen,
                // 单图无切换语义：隐藏 1/N 进度（rc-image 对组预览恒渲染计数）
                ...(items.length > 1 ? {} : { countRender: () => '' }),
                ...(env.onEditSketch && {
                    actionsRender: (originalNode, info) => {
                        const sketchBlock = items[info.current] && sketchEditableBySrc.get(items[info.current].src)
                        return (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                                {originalNode}
                                {sketchBlock && (
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<Pencil size={14} />}
                                        onClick={() => {
                                            setPreviewOpen(false)
                                            env.onEditSketch?.(sketchBlock)
                                        }}
                                    >
                                        {t('sketch.editSketch')}
                                    </Button>
                                )}
                            </div>
                        )
                    },
                }),
            }}
        >
            <Space size={8} wrap style={{ maxWidth: '100%' }}>
                {blocks.map(b => <ImageView key={b.id} block={b} env={env} />)}
            </Space>
        </Image.PreviewGroup>
    )
}

/**
 * 用户消息 content block → 视图注册表（对齐 knownTools 工具卡注册惯例）：
 * shared 新增 block 类型时在此加一行即可接入渲染。
 *
 * 注意 document / image / quote 的渲染实际走 UserBlocksView 的分段合并分支
 * （{@link groupUserBlocks} 组段优先于注册表分发）——注册项保持类型全量并为
 * 非分组路径兜底（对齐组段 + 注册表双轨模式）。quote 项为单条也走组容器的适配。
 */
export const USER_BLOCK_RENDERERS: {
    [K in UserContentBlock['type']]: React.FC<UserBlockViewProps<Extract<UserContentBlock, { type: K }>>>
} = {
    text: TextView,
    quote: ({ block, env }) => <QuoteGroupView blocks={[block]} env={env} />,
    document: DocumentView,
    image: ImageView,
}

/**
 * 用户消息气泡内容视图：按 blocks 顺序分发到各类型视图。
 *
 * - 顶层段落间用垂直 Space 统一分隔（文本/引用组/图片段/附件段）；
 * - 连续 document 由 {@link groupUserBlocks} 归并后以横向 wrap Space 装单卡合并展示
 *   （不用 FileCard.List——其 list-content 自带 12px 16px padding，气泡内过肥）；
 * - 连续 image 归并到横向 wrap Space，多图不一张一行；
 * - 连续 quote 归并为引用组合并容器（{@link QuoteGroupView}：编号连续 + 条间分隔线）。
 */
export function UserBlocksView({ blocks, env }: { blocks: readonly UserContentBlock[]; env?: UserBlockRenderEnv }) {
    const renderEnv: UserBlockRenderEnv = env ?? {}
    return (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {groupUserBlocks(blocks).map((seg, i) => {
                if (seg.kind === 'documents') {
                    return (
                        <Space key={`docs-${seg.blocks[0].id}`} size={8} wrap style={{ maxWidth: '100%' }}>
                            {seg.blocks.map(d => <DocumentView key={d.id} block={d} env={renderEnv} />)}
                        </Space>
                    )
                }
                // 连续 image 归并到组预览容器（内部横向 Space 可换行），多图预览可连续切换
                if (seg.kind === 'images') {
                    return <UserImageGroupView key={`imgs-${seg.blocks[0].id}`} blocks={seg.blocks} env={renderEnv} />
                }
                // 连续 quote 归并为引用组合并容器（单条也同容器，形态一致）
                if (seg.kind === 'quotes') {
                    return <QuoteGroupView key={`quotes-${seg.blocks[0].messageId}`} blocks={seg.blocks} env={renderEnv} />
                }
                const b = seg.block
                // key：业务 id 优先；text 块无 id，用序号兜底（blocks 与分段一一对应，同内容下稳定）
                const key = b.type === 'quote' ? `quote-${b.messageId}` : ('id' in b ? b.id : `text-${i}`)
                // 注册表分发：索引访问得到四类视图的联合签名，收窄为统一调用形态。
                // 运行时安全——UserContentBlock 为 discriminatedUnion，type 与视图键一一对应
                const View = USER_BLOCK_RENDERERS[b.type] as React.FC<UserBlockViewProps<UserContentBlock>>
                return <View key={key} block={b} env={renderEnv} />
            })}
        </Space>
    )
}
