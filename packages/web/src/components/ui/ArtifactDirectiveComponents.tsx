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

/**
 * 产物声明（:mobi-artifact）渲染组件（spec .scratch/inline-artifacts 票 01）
 *
 * 声明 → fileMeta 校验（存在 + 类型白名单 + inline 大小上限，判定单源
 * domain/chat/artifactDirectives）→ 渲染。本票产物恒呈卡片形态；inline 渲染
 * （媒体/HTML）由票 02/03 在「校验通过且类型可 inline」分支接管。
 * 校验失败/未决降级为产物卡并标注原因——降级是诚实呈现，不是错误提示。
 * 会话寻址上下文由 agent-text 渲染分支经 ArtifactEnvProvider 注入（与
 * QuoteAnnotationsProvider 同点注入），缺省（测试/非聊天场景）仍可渲染卡片，
 * 仅「打开」动作不可用。
 */

import { createContext, useCallback, useContext, useMemo, type FC, type ReactNode } from 'react'
import { Dropdown, message, theme } from 'antd'
import type { MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { ChevronDown, File, FileText, Globe, Image as ImageIcon, Link2, Music, Video } from 'lucide-react'
import { buildActionUri } from '@mobi/shared'
import { copyTextToClipboard } from '@/components/chat/CopyButton'
import { useActionDispatcher } from './ActionLink'
import { useFileMeta } from '@/core/data/hooks/queries/useFileTree'
import { basename } from '@/core/utils/path'
import { buildReadFileUrl, type FileRefContext } from '@/core/utils/fileUrl'
import { HtmlInline, ImageInline, MediaInline } from '@/components/chat/artifact/ArtifactInlineViews'
import {
    ARTIFACT_INLINE_LIMIT_BYTES,
    classifyArtifact,
    parseArtifactParams,
    resolveArtifactKind,
    type ArtifactCardReason,
    type ArtifactKind,
    type ArtifactMetaState,
} from '@/domain/chat/artifactDirectives'

/** 产物渲染环境：寻址上下文 + fileMeta 数据端口 */
interface ArtifactEnv {
    refCtx: FileRefContext
    /**
     * fileMeta 数据端口（accept 进 interface 而非组件直连 react-query）：
     * 缺省走 useFileMeta（生产 adapter）；测试/嵌入环境注入假端口即可驱动
     * 校验降级链，不必穿到 query cache 层 mock。
     */
    fileMeta?: (sessionId: string, path: string) => ArtifactMetaState
}

const ArtifactEnvContext = createContext<ArtifactEnv | undefined>(undefined)

export function ArtifactEnvProvider({ refCtx, fileMeta, children }: { refCtx: FileRefContext, fileMeta?: (sessionId: string, path: string) => ArtifactMetaState, children: ReactNode }) {
    // value 按 refCtx 的原始字段 memo：调用点每渲染重建 refCtx 对象（消息列表流式期间
    // 每 chunk 重跑），不 memo 会换新引用把树里全部产物消费者强拉重渲染
    const { sessionId, machineId, cwd, sessionAddressingBroken } = refCtx
    const value = useMemo(
        () => ({ refCtx: { sessionId, machineId, cwd, sessionAddressingBroken } as FileRefContext, fileMeta }),
        [sessionId, machineId, cwd, sessionAddressingBroken, fileMeta],
    )
    return <ArtifactEnvContext.Provider value={value}>{children}</ArtifactEnvContext.Provider>
}

const KIND_ICONS: Record<ArtifactKind, typeof File> = {
    image: ImageIcon,
    audio: Music,
    video: Video,
    html: Globe,
    pdf: FileText,
    unknown: File,
}

/** 卡片降级原因 → i18n key（chat.artifact.reason.*） */
const REASON_KEYS: Record<ArtifactCardReason, string> = {
    'missing': 'chat.artifact.reason.missing',
    'too-large': 'chat.artifact.reason.tooLarge',
    'unsupported': 'chat.artifact.reason.unsupported',
}

function formatLimit(kind: ArtifactKind): string {
    const bytes = ARTIFACT_INLINE_LIMIT_BYTES[kind as keyof typeof ARTIFACT_INLINE_LIMIT_BYTES]
    return `${Math.round(bytes / 1024 / 1024)}MB`
}

/** 路径基名（卡片标题；声明恒为文件路径，无目录语义）——basename 单源在 core/utils/path */

/**
 * 产物卡（交互参照「打开方式」分体式按钮）：
 * - 整卡可点 + 「打开方式」标签点击 → app 内查看文件（默认动作，mobi://file/open）
 * - 「打开方式」右侧箭头 → 下拉菜单：浏览器打开（仅 HTML 且有会话寻址）、
 *   复制链接（read-file URL，文件不存在时不提供）
 * 降级原因卡复用同一交互——原因只是副标题标注，动作能力按可用性收敛。
 */
const ArtifactCard: FC<{ path: string, reason?: ArtifactCardReason, sessionId?: string | null }> = ({ path, reason, sessionId }) => {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const dispatch = useActionDispatcher()
    const kind = resolveArtifactKind(path)
    const Icon = KIND_ICONS[kind]
    const openUri = buildActionUri('file/open', { path })

    const openInInspector = useCallback(() => {
        dispatch(openUri, sessionId ? { sessionId } : undefined)
    }, [dispatch, openUri, sessionId])

    // 菜单可用性收敛：文件不存在时浏览器/复制都无意义，整个下拉不出现
    const openInBrowser = reason !== 'missing' && kind === 'html' && sessionId
        ? () => window.open(buildReadFileUrl(sessionId, path), '_blank', 'noopener')
        : undefined
    const copyLink = sessionId && reason !== 'missing'
        ? () => {
            void copyTextToClipboard(buildReadFileUrl(sessionId, path))
            message.success(t('chat.copied'))
        }
        : undefined

    // 图标统一 26px 底色块（.artifact-menu-icon，样式在 styles/antd.css）——对齐
    // 原生 App 菜单的观感；次级动作（复制链接）前加分隔线
    const menuItems: MenuProps['items'] = [
        openInBrowser && {
            key: 'browser',
            icon: <span className="artifact-menu-icon"><Globe size={15} /></span>,
            label: t('chat.artifact.browser'),
        },
        copyLink && { type: 'divider' as const },
        copyLink && {
            key: 'copy',
            icon: <span className="artifact-menu-icon"><Link2 size={15} /></span>,
            label: t('chat.artifact.copyLink'),
        },
    ].filter((item): item is NonNullable<typeof item> => Boolean(item))

    const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
        if (key === 'browser') openInBrowser?.()
        if (key === 'copy') copyLink?.()
    }

    const subtitle = reason
        ? t(REASON_KEYS[reason], kind === 'unknown' || kind === 'pdf' ? {} : { limit: formatLimit(kind) })
        : kind === 'html'
            ? t('chat.artifact.htmlTitle')
            : null

    return (
        <div
            data-testid="artifact-card"
            role="button"
            tabIndex={0}
            aria-label={t('chat.artifact.open')}
            onClick={openInInspector}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault()
                    openInInspector()
                }
            }}
            style={{
                display: 'flex', alignItems: 'center', gap: token.marginSM,
                padding: `${token.paddingSM}px ${token.marginSM}px`,
                border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG,
                background: token.colorFillQuaternary, maxWidth: 560, cursor: 'pointer',
            }}
        >
            <div style={{
                width: 36, height: 36, flexShrink: 0, borderRadius: token.borderRadiusLG,
                background: token.colorFillTertiary, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                <Icon size={18} style={{ color: token.colorTextSecondary }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                    fontSize: token.fontSize, color: token.colorText,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {basename(path)}
                </div>
                {subtitle && (
                    <div style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                        {subtitle}
                    </div>
                )}
            </div>
            {/* 「打开方式」分体式按钮：标签=默认动作（app 内查看），箭头=下拉；点击止于自身，
                不冒泡到整卡 onClick 造成双触发 */}
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    flexShrink: 0, display: 'inline-flex', alignItems: 'center',
                    border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 999,
                    background: token.colorBgContainer, overflow: 'hidden',
                }}
            >
                <button
                    type="button"
                    onClick={openInInspector}
                    style={{
                        border: 'none', background: 'none', cursor: 'pointer', padding: `4px 6px 4px ${token.paddingXS}px`,
                        color: token.colorText, fontSize: token.fontSizeSM, lineHeight: 1.5,
                    }}
                >
                    {t('chat.artifact.openWith')}
                </button>
                {menuItems.length > 0 && (
                    <Dropdown
                        menu={{ items: menuItems, onClick: handleMenuClick }}
                        trigger={['click']}
                        overlayClassName="artifact-card-menu"
                    >
                        <button
                            type="button"
                            data-testid="artifact-card-menu-trigger"
                            aria-label={t('chat.artifact.openWith')}
                            style={{
                                border: 'none', borderLeft: `1px solid ${token.colorBorderSecondary}`,
                                background: 'none', cursor: 'pointer', padding: '4px 6px',
                                color: token.colorTextSecondary, display: 'inline-flex', alignItems: 'center',
                            }}
                        >
                            <ChevronDown size={14} />
                        </button>
                    </Dropdown>
                )}
            </div>
        </div>
    )
}

/**
 * :mobi-artifact 渲染入口（MobiDirective 路由表项）：attrs → 类型化参数，非法降级原文；
 * 渲染形态由 classifyArtifact（domain 裁决纯函数）唯一确定，本层只做端口装配：
 * 无寻址 → 卡（不打无效请求）；有端口 → 直接裁决；缺省 → react-query adapter。
 */
export const ArtifactDirectiveView: FC<{ path?: string, mode?: string, children?: ReactNode }> = ({ path, mode, children }) => {
    const env = useContext(ArtifactEnvContext)
    const params = path !== undefined ? parseArtifactParams({ path, mode: mode ?? '' }) : null

    if (!params) return <span>{children}</span>

    const sessionId = env?.refCtx.sessionId ?? null
    // 寻址上下文缺失（非聊天场景/测试）：直接卡，不打无效请求
    if (!sessionId) return <ArtifactCard path={params.path} />

    if (env?.fileMeta) {
        return (
            <ArtifactVerdictView
                path={params.path}
                mode={params.mode}
                sessionId={sessionId}
                meta={env.fileMeta(sessionId, params.path)}
            />
        )
    }
    return <ArtifactQueryView path={params.path} mode={params.mode} sessionId={sessionId} />
}

/** 缺省 fileMeta 端口：react-query → 三态映射（hooks 只活在这一层） */
const ArtifactQueryView: FC<{ path: string, mode?: string, sessionId: string }> = ({ path, mode, sessionId }) => {
    const metaQuery = useFileMeta(sessionId, path)
    const meta: ArtifactMetaState = metaQuery.isPending
        ? { status: 'pending' }
        : metaQuery.isError || !metaQuery.data
            ? { status: 'missing' }
            : { status: 'ready', size: metaQuery.data.size, etag: metaQuery.data.etag }
    return <ArtifactVerdictView path={path} mode={mode} sessionId={sessionId} meta={meta} />
}

/** Verdict → 视图映射（无数据 hook；inline 所需 kind/etag/wide 已在 verdict 齐备） */
const ArtifactVerdictView: FC<{ path: string, mode?: string, sessionId: string, meta: ArtifactMetaState }> = ({ path, mode, sessionId, meta }) => {
    const verdict = classifyArtifact(path, meta, mode)
    if (verdict.action === 'card') {
        return <ArtifactCard path={path} reason={verdict.reason} sessionId={sessionId} />
    }
    if (verdict.kind === 'image') return <ImageInline sessionId={sessionId} path={path} etag={verdict.etag} />
    if (verdict.kind === 'audio' || verdict.kind === 'video') {
        return <MediaInline sessionId={sessionId} path={path} etag={verdict.etag} kind={verdict.kind} />
    }
    return <HtmlInline sessionId={sessionId} path={path} etag={verdict.etag} wide={verdict.wide} />
}
