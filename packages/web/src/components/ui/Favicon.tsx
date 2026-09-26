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
 * 站点 favicon：http 链接前置站点图标（对齐 FileTypeBadge 的「链接前置徽章」形态）。
 *
 * 获取走三级降级探测（聚合服务解析页面真实 icon，裸 favicon.ico 直连很多站点 404）：
 * 1. 直连 `https://{host}/favicon.ico`——国内网络直连快，命中即止，不先过代理
 * 2. DuckDuckGo icons（服务端聚合、命中率高，且国内可直连——补「无代理 + 站点无
 *    favicon.ico」场景；缺点无自定义尺寸，14px 显示够用）
 * 3. Google s2 favicon 服务（ChatGPT 桌面端 asar 实证同款；需代理，直连/DDG 的
 *    onerror 是毫秒级，落这级代价小）
 * 全部失败画 Globe 占位——同尺寸占位保证零布局跳动，失败静默不重试。
 *
 * 异步纪律：探测在 effect 里进行，主渲染流程零等待；模块级缓存 host → 结果
 * （成功记命中 URL），同 host 多链接只探测一次，历史消息重渲染零请求。
 */

import { memo, useEffect, useState } from 'react'
import { Globe } from 'lucide-react'

/** host → favicon 探测结果（模块级，会话生命周期内复用；'fail' 不重试防离线死循环） */
const FAVICON_STATE = new Map<string, string | 'fail'>()

function FallbackGlobe({ size }: { size: number }) {
    return (
        <Globe
            aria-hidden="true"
            size={size - 2}
            strokeWidth={2}
            style={{
                // 与 img 同理：svg 被某层规则打成 block 时独占一行，内联 inline 稳压
                display: 'inline',
                verticalAlign: 'middle',
                margin: '0 4px 0 1px',
                opacity: 0.55,
                flexShrink: 0,
            }}
        />
    )
}

export const Favicon = memo(function Favicon({ href, size = 14 }: { href: string; size?: number }) {
    // host 提取失败（畸形 href 理论不可达——调用方已做 http(s) 校验）恒走 globe 占位
    const host = (() => {
        try {
            return new URL(href).hostname
        } catch {
            return null
        }
    })()

    const cached = host ? FAVICON_STATE.get(host) : undefined
    const [iconUrl, setIconUrl] = useState<string | null>(() => (typeof cached === 'string' ? cached : null))
    const [failed, setFailed] = useState(cached === 'fail')

    useEffect(() => {
        if (!host || iconUrl || failed) return
        const probes = [
            `https://${host}/favicon.ico`,
            `https://icons.duckduckgo.com/ip3/${host}.ico`,
            `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`,
        ]
        let cancelled = false
        let next = 0
        const tryNext = () => {
            if (cancelled) return
            const url = probes[next++]
            if (!url) {
                FAVICON_STATE.set(host, 'fail')
                setFailed(true)
                return
            }
            const probe = new Image()
            probe.referrerPolicy = 'no-referrer'
            probe.onload = () => {
                if (cancelled) return
                FAVICON_STATE.set(host, url)
                setIconUrl(url)
            }
            probe.onerror = tryNext
            probe.src = url
        }
        tryNext()
        return () => {
            cancelled = true
        }
    }, [host, iconUrl, failed])

    if (!iconUrl) return <FallbackGlobe size={size} />
    return (
        <img
            src={iconUrl}
            alt=""
            aria-hidden="true"
            width={size}
            height={size}
            referrerPolicy="no-referrer"
            loading="lazy"
            style={{
                // 强制 inline：行内 img 被某层规则打成 block 时会独占一行、把链接文本甩到
                // 下一行（2026-09-26 dev CDP 实测 34px→19px），内联样式稳压任何规则
                display: 'inline',
                verticalAlign: 'middle',
                margin: '0 4px 0 1px',
                borderRadius: 3,
                flexShrink: 0,
            }}
        />
    )
})
