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
 * 产物 inline 渲染视图（spec .scratch/inline-artifacts 票 02/03）
 *
 * 声明校验通过后的聊天流内嵌形态：图片 lightbox / 音视频播放器 / HTML 沙箱 iframe。
 * 取数走 buildReadFileUrl（etag 进 URL 作内容版本，见 fileUrl 模块头）；HTML 走
 * serve-file（子资源相对路径基准 + 服务端 PREVIEW_CSP，ADR 0007——安全规则不在本层复刻，
 * iframe 的 sandbox 组合与 HtmlPreviewView 保持同源语义，含 ORB 规避的 allow-same-origin）。
 * 每个视图都自带「inspector 打开」逃生口——inline 是快看，不是替代品。
 */

import { useState } from 'react'
import { Button, Image, Segmented, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { FileSearch } from 'lucide-react'
import { buildActionUri } from '@mobi/shared'
import { ActionLink } from '@/components/ui/ActionLink'
import { SandboxHtmlFrame } from '@/components/files/SandboxHtmlFrame'
import { useFileMediaSrc } from '@/components/files/useFileMediaSrc'
import { useDirectiveStreaming } from '@/components/ui/directiveStreamGate'

/** inline 视图公共 props：寻址与校验产物（ArtifactDirectiveView 已把关） */
export interface ArtifactInlineProps {
    sessionId: string
    path: string
    /** meta.etag——进 URL 作内容版本，文件原地变化后浏览器才会重新拉取 */
    etag: string
}

/** inspector 逃生口：inline 下方常驻小入口（快看≠替代品） */
function InspectorEntry({ path }: { path: string }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    return (
        <ActionLink
            uri={buildActionUri('file/open', { path })}
            className="artifact-inspector-entry"
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: token.fontSizeSM, color: token.colorTextTertiary,
                textDecoration: 'none',
            }}
        >
            <FileSearch size={12} />
            {t('chat.artifact.open')}
        </ActionLink>
    )
}

/** inline 媒体失败态：紧凑一行（与聊天流体量相称，区别于 inspector 的整屏兜底）。
 * 401 cookie 过期等失败此前在 inline 是静默破框——聊天流恰恰驻留最久、最容易撞会话
 * 休眠后的认证失效；闭锁机制单源在 useFileMediaSrc。 */
function InlineMediaError({ onRetry }: { onRetry: () => void }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    return (
        <div
            data-testid="artifact-inline-media-error"
            className="artifact-inline-media-error"
            style={{
                display: 'flex', alignItems: 'center', gap: token.marginSM,
                padding: '12px 14px',
                border: `1px dashed ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusLG,
                background: token.colorFillQuaternary,
            }}
        >
            <span style={{ flex: 1, fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                {t('files.loadFailed')}
            </span>
            <Button size="small" onClick={onRetry}>{t('files.retry')}</Button>
        </div>
    )
}

/** 图片 inline：缩略图 + antd lightbox（点击看大图），宽度收敛 480；cover=false 去 hover 遮罩（antd v6 mask 配置不再控制 cover 层）；失败/重试闭锁与 inspector 同源（useFileMediaSrc） */
export function ImageInline({ sessionId, path, etag }: ArtifactInlineProps) {
    const { src, failed, onError, retry } = useFileMediaSrc(sessionId, path, etag)
    if (failed) {
        return (
            <div data-testid="artifact-inline-image" className="artifact-inline" style={{ maxWidth: 480 }}>
                <InlineMediaError onRetry={retry} />
                <div><InspectorEntry path={path} /></div>
            </div>
        )
    }
    return (
        <div data-testid="artifact-inline-image" className="artifact-inline" style={{ maxWidth: 480 }}>
            <Image
                src={src}
                alt={path.split('/').pop() ?? path}
                style={{ maxWidth: '100%', borderRadius: 8 }}
                referrerPolicy="no-referrer"
                // cover=false 去 hover 遮罩（v6 把 cover 层挂在 preview 配置内；点击预览不受影响）
                preview={{ cover: false }}
                onError={onError}
            />
            <div><InspectorEntry path={path} /></div>
        </div>
    )
}

/** 音视频 inline：原生控件，不自动播放，只预载元数据（移动端流量友好）；播放锁 + 失败重试与 inspector 同源 */
export function MediaInline({ sessionId, path, etag, kind }: ArtifactInlineProps & { kind: 'audio' | 'video' }) {
    const { src, failed, onError, reportPlaying, retry } = useFileMediaSrc(sessionId, path, etag)
    const { token } = theme.useToken()
    return (
        <div
            data-testid={`artifact-inline-${kind}`}
            className="artifact-inline"
            style={{ maxWidth: kind === 'audio' ? 480 : 640 }}
        >
            {failed
                ? <InlineMediaError onRetry={retry} />
                : kind === 'video'
                    ? (
                        <video
                            controls
                            preload="metadata"
                            src={src}
                            onError={onError}
                            onPlay={() => reportPlaying(true)}
                            onPause={() => reportPlaying(false)}
                            onEnded={() => reportPlaying(false)}
                            style={{ width: '100%', borderRadius: token.borderRadiusLG, display: 'block' }}
                        />
                    )
                    : (
                        <audio
                            controls
                            preload="metadata"
                            src={src}
                            onError={onError}
                            onPlay={() => reportPlaying(true)}
                            onPause={() => reportPlaying(false)}
                            onEnded={() => reportPlaying(false)}
                            style={{ width: '100%', display: 'block' }}
                        />
                    )}
            <InspectorEntry path={path} />
        </div>
    )
}

/** 宽度档位：自适应（撑满聊天列）或固定像素档 */
type WidthMode = 'auto' | '736' | '1024'

const WIDTH_MODE_VALUE: Record<WidthMode, string> = {
    auto: '100%',
    '736': '736px',
    '1024': '1024px',
}

/**
 * HTML inline：SandboxHtmlFrame 的聊天流 chrome（定高 480/640 + 宽度三档）。
 * iframe 机制（serve-file URL/sandbox/meta 驱动重建/滚动条主题）单源在 frame。
 */
export function HtmlInline({ sessionId, path, wide }: ArtifactInlineProps & { wide?: boolean }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    // 流式闸：流式揭示期间不挂 iframe（加载竞速逐字揭示 = 布局抖动），同尺寸占位顶住
    const streaming = useDirectiveStreaming()
    const [widthMode, setWidthMode] = useState<WidthMode>('auto')
    const frameHeight = wide ? 640 : 480
    return (
        <div
            data-testid="artifact-inline-html"
            className="artifact-inline"
            // 宽度档位切换走主题 motion 曲线平滑过渡（初挂载 width 不变不触发）
            style={{ width: WIDTH_MODE_VALUE[widthMode], transition: `width ${token.motionDurationMid} ${token.motionEaseInOut}` }}
        >
            {streaming
                ? (
                    <div
                        data-artifact-html-placeholder="true"
                        style={{
                            height: frameHeight,
                            border: `1px dashed ${token.colorBorderSecondary}`,
                            borderRadius: token.borderRadiusLG,
                            background: token.colorFillQuaternary,
                        }}
                    />
                )
                : (
                    <SandboxHtmlFrame
                        sessionId={sessionId}
                        path={path}
                        title={t('chat.artifact.htmlTitle', { defaultValue: path.split('/').pop() ?? path })}
                        style={{
                            width: '100%', height: frameHeight,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            borderRadius: token.borderRadiusLG, display: 'block',
                        }}
                    />
                )}
            {/* 底部动作行：查看文件（inspector 逃生口）+ 宽度档位（右对齐） */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: token.marginSM, marginTop: 4 }}>
                <InspectorEntry path={path} />
                <Segmented
                    size="small"
                    value={widthMode}
                    onChange={(v) => setWidthMode(v as WidthMode)}
                    options={[
                        { label: t('chat.artifact.widthFit'), value: 'auto' },
                        { label: '736', value: '736' },
                        { label: '1024', value: '1024' },
                    ]}
                />
            </div>
        </div>
    )
}
