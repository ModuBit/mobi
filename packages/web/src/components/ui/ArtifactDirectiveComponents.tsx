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

import { createContext, useContext, type FC, type ReactNode } from 'react'
import { theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { File, FileText, Globe, Image as ImageIcon, Music, Video } from 'lucide-react'
import { buildActionUri } from '@mobi/shared'
import { ActionLink } from './ActionLink'
import { useFileMeta } from '@/core/data/hooks/queries/useFileTree'
import { buildReadFileUrl, type FileRefContext } from '@/core/utils/fileUrl'
import { HtmlInline, ImageInline, MediaInline } from '@/components/chat/artifact/ArtifactInlineViews'
import {
    ARTIFACT_INLINE_LIMIT_BYTES,
    isInlineCapableKind,
    parseArtifactParams,
    resolveArtifactKind,
    type ArtifactCardReason,
    type ArtifactKind,
} from '@/domain/chat/artifactDirectives'

/** 产物渲染寻址上下文：read-file / mobi://file/open 构造所需的会话寻址字段 */
interface ArtifactEnv {
    refCtx: FileRefContext
}

export const ArtifactEnvContext = createContext<ArtifactEnv | undefined>(undefined)

export function ArtifactEnvProvider({ refCtx, children }: { refCtx: FileRefContext, children: ReactNode }) {
    return <ArtifactEnvContext.Provider value={{ refCtx }}>{children}</ArtifactEnvContext.Provider>
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

/** 路径基名（卡片标题；声明恒为文件路径，无目录语义） */
function baseName(path: string): string {
    return path.split('/').pop() ?? path
}

/**
 * 产物卡：图标 + 文件名 + 降级原因（有则展示）+ 「打开」动作（inspector）。
 * HTML 文件附「浏览器打开」次动作——hub 服务的 read-file URL 新标签直开（带 CSP）。
 */
const ArtifactCard: FC<{ path: string, reason?: ArtifactCardReason, sessionId?: string | null }> = ({ path, reason, sessionId }) => {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const kind = resolveArtifactKind(path)
    const Icon = KIND_ICONS[kind]
    const openUri = buildActionUri('file/open', { path })
    const openInBrowser = kind === 'html' && sessionId
        ? () => window.open(buildReadFileUrl(sessionId, path), '_blank', 'noopener')
        : undefined

    return (
        <div
            data-testid="artifact-card"
            className="artifact-card"
            style={{
                display: 'flex', alignItems: 'center', gap: token.marginSM,
                padding: `${token.paddingSM}px ${token.marginSM}px`,
                border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG,
                background: token.colorFillQuaternary, maxWidth: 560,
            }}
        >
            <Icon size={20} style={{ flexShrink: 0, color: token.colorTextSecondary }} />
            <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                    fontSize: token.fontSize, color: token.colorText,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {baseName(path)}
                </div>
                {reason && (
                    <div style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                        {t(REASON_KEYS[reason], kind === 'unknown' || kind === 'pdf' ? {} : { limit: formatLimit(kind) })}
                    </div>
                )}
            </div>
            <ActionLink uri={openUri} style={{ flexShrink: 0 }}>
                {t('chat.artifact.open')}
            </ActionLink>
            {openInBrowser && (
                <button
                    type="button"
                    onClick={openInBrowser}
                    style={{
                        flexShrink: 0, border: 'none', background: 'none', cursor: 'pointer',
                        color: token.colorLink, fontSize: token.fontSize, padding: 0,
                    }}
                >
                    {t('chat.artifact.browser')}
                </button>
            )}
        </div>
    )
}

/**
 * :mobi-artifact 渲染入口（MobiDirective 路由表项）：attrs → 类型化参数，非法降级原文；
 * fileMeta 校验三分支——查询失败（不存在/越界）→ missing 卡，超限/不可 inline → 原因卡，
 * 其余 → 卡片（票 02/03 在此分支接管 inline）。
 */
export const ArtifactDirectiveView: FC<{ path?: string, mode?: string, children?: ReactNode }> = ({ path, mode, children }) => {
    const env = useContext(ArtifactEnvContext)
    const params = path !== undefined ? parseArtifactParams({ path, mode: mode ?? '' }) : null
    const sessionId = env?.refCtx.sessionId ?? null
    // hooks 先于条件返回（规则序）；path 非法时 enabled=false 不发请求
    const metaQuery = useFileMeta(sessionId, params?.path ?? null)

    if (!params) return <span>{children}</span>

    const kind = resolveArtifactKind(params.path)

    // 寻址上下文缺失（非聊天场景/测试）：直接卡，不打无效请求
    if (!sessionId) return <ArtifactCard path={params.path} />

    if (metaQuery.isPending) return <ArtifactCard path={params.path} sessionId={sessionId} />
    if (metaQuery.isError || !metaQuery.data) return <ArtifactCard path={params.path} reason="missing" sessionId={sessionId} />

    if (kind === 'unknown' || kind === 'pdf') return <ArtifactCard path={params.path} reason="unsupported" sessionId={sessionId} />
    const limit = ARTIFACT_INLINE_LIMIT_BYTES[kind]
    if (metaQuery.data.size > limit) return <ArtifactCard path={params.path} reason="too-large" sessionId={sessionId} />
    if (params.mode === 'card' || !isInlineCapableKind(kind)) {
        return <ArtifactCard path={params.path} sessionId={sessionId} />
    }

    // inline 渲染：校验全部通过且类型可 inline。etag 并入 URL 作内容版本（fileUrl 模块头）
    const etag = metaQuery.data.etag
    if (kind === 'image') return <ImageInline sessionId={sessionId} path={params.path} etag={etag} />
    if (kind === 'audio' || kind === 'video') return <MediaInline sessionId={sessionId} path={params.path} etag={etag} kind={kind} />
    return <HtmlInline sessionId={sessionId} path={params.path} etag={etag} wide={params.mode === 'wide'} />
}
