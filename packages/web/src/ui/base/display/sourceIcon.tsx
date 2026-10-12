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

import type { FC, ReactNode } from 'react'
import {
    Globe, Image, FileCode2, FileJson2, FileText,
    FileType2, FileVideo, FileAudio, FileArchive, File, Link2,
} from 'lucide-react'
import {
    GithubOutlined,
    TwitterOutlined,
    YoutubeOutlined,
    GoogleOutlined,
    RedditOutlined,
    LinkedinOutlined,
    FacebookOutlined,
    DockerOutlined,
    GitlabOutlined,
    SlackOutlined,
    AppleOutlined,
    InstagramOutlined,
    WindowsOutlined,
    WechatOutlined,
    DingtalkOutlined,
    AliyunOutlined,
    YuqueOutlined,
} from '@ant-design/icons'

/** 统一图标尺寸：跟随文字大小 */
const ICON_SIZE = 14

/** Lucide 图标包装：统一尺寸 */
function lucide(Icon: FC<{ size?: number }>): ReactNode {
    return <Icon size={ICON_SIZE} />
}

// ─── 域名 → antd 品牌图标 ──────────────────────────────────────────

export const DOMAIN_ICON_MAP: Record<string, FC<{ style?: React.CSSProperties }>> = {
    'github.com': GithubOutlined,
    'x.com': TwitterOutlined,
    'twitter.com': TwitterOutlined,
    'youtube.com': YoutubeOutlined,
    'youtu.be': YoutubeOutlined,
    'google.com': GoogleOutlined,
    'reddit.com': RedditOutlined,
    'linkedin.com': LinkedinOutlined,
    'facebook.com': FacebookOutlined,
    'docker.com': DockerOutlined,
    'gitlab.com': GitlabOutlined,
    'slack.com': SlackOutlined,
    'apple.com': AppleOutlined,
    'instagram.com': InstagramOutlined,
    'microsoft.com': WindowsOutlined,
    'wechat.com': WechatOutlined,
    'weixin.qq.com': WechatOutlined,
    'dingtalk.com': DingtalkOutlined,
    'aliyun.com': AliyunOutlined,
    'alibaba.com': AliyunOutlined,
    'aliyun-inc.com': AliyunOutlined,
    'yuque.com': YuqueOutlined,
}

// ─── 文件扩展名 → lucide 图标 ───────────────────────────────────────

export const EXT_ICON_MAP: Record<string, FC<{ size?: number }>> = {
    // 图片
    png: Image, jpg: Image, jpeg: Image, gif: Image, svg: Image, webp: Image, ico: Image, bmp: Image,
    // 代码
    ts: FileCode2, tsx: FileCode2, js: FileCode2, jsx: FileCode2,
    py: FileCode2, java: FileCode2, go: FileCode2, rs: FileCode2,
    css: FileCode2, less: FileCode2, scss: FileCode2, sass: FileCode2,
    vue: FileCode2, html: FileCode2, rb: FileCode2, php: FileCode2,
    c: FileCode2, cpp: FileCode2, h: FileCode2, hpp: FileCode2,
    kt: FileCode2, swift: FileCode2, zig: FileCode2, lua: FileCode2,
    sh: FileCode2, bash: FileCode2, zsh: FileCode2,
    // 数据
    json: FileJson2, yaml: FileJson2, yml: FileJson2, toml: FileJson2, xml: FileJson2, csv: FileJson2,
    // 文档
    md: FileText, txt: FileText, log: FileText, rst: FileText,
    // Office
    doc: FileType2, docx: FileType2, xls: FileType2, xlsx: FileType2,
    ppt: FileType2, pptx: FileType2, pdf: FileType2, rtf: FileType2,
    // 视频
    mp4: FileVideo, avi: FileVideo, mov: FileVideo, mkv: FileVideo, webm: FileVideo,
    // 音频
    mp3: FileAudio, wav: FileAudio, ogg: FileAudio, flac: FileAudio,
    // 压缩
    zip: FileArchive, tar: FileArchive, gz: FileArchive, rar: FileArchive, '7z': FileArchive,
}

/** IP 地址正则 */
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * 从 URL 中提取域名，用于匹配品牌图标。
 *
 * 策略：先尝试完整 hostname 匹配 DOMAIN_ICON_MAP，再逐步剥离子域名，
 * 最后回退到「二级+顶级」作为默认返回值。
 * IP 地址直接返回完整 hostname。
 */
export function extractDomain(url: string): string | undefined {
    try {
        const hostname = new URL(url).hostname
        // IP 地址直接返回
        if (IP_RE.test(hostname)) return hostname
        // 先用完整 hostname 查表（支持 weixin.qq.com 等三级域名映射）
        if (DOMAIN_ICON_MAP[hostname]) return hostname
        // 逐步剥离子域名查表
        const parts = hostname.split('.')
        for (let i = 1; i < parts.length - 1; i++) {
            const candidate = parts.slice(i).join('.')
            if (DOMAIN_ICON_MAP[candidate]) return candidate
        }
        // 回退：返回二级+顶级
        if (parts.length > 2) return parts.slice(-2).join('.')
        return hostname
    } catch {
        return undefined
    }
}

/** 从路径中提取文件扩展名（小写、无点） */
export function extractExt(path: string): string | undefined {
    const match = path.match(/(?<!^|[./])\.([a-zA-Z0-9+]+)$/)
    return match?.[1].toLowerCase()
}

/**
 * 根据脚注 item 的 url/title 自动匹配图标。
 *
 * 优先级：知名域名品牌图标 > 文件类型图标 > 通用网站图标 > 兜底图标
 */
export function getSourceIcon(item: { url?: string; title?: string }): ReactNode {
    const { url } = item

    if (!url) return lucide(Link2)

    // 网站链接
    if (/^https?:\/\//i.test(url)) {
        const domain = extractDomain(url)
        if (domain) {
            const BrandIcon = DOMAIN_ICON_MAP[domain]
            if (BrandIcon) return <BrandIcon style={{ fontSize: ICON_SIZE }} />
        }
        return lucide(Globe)
    }

    // 文件路径：按扩展名匹配
    const ext = extractExt(url)
    if (ext) {
        const FileIcon = EXT_ICON_MAP[ext]
        if (FileIcon) return lucide(FileIcon)
    }

    return lucide(File)
}
