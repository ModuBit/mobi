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

import { createContext, useContext, useMemo, type FC } from 'react'
import { Sources } from '@ant-design/x'
import { Popover, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { type ComponentProps } from '@ant-design/x-markdown'
import { getSourceIcon } from './sourceIcon'
import { type FootnoteItem } from './footnotePlugin'

/** 脚注数据 Context，Markdown 组件注入，FootnoteRef 消费 */
export const FootnoteContext = createContext<Map<number, FootnoteItem>>(new Map())

/** 脚注引用组件：tag 样式 + hover 展示 title + 点击打开链接 */
export const FootnoteRef: FC<ComponentProps<{ 'data-num'?: string }>> = ({ 'data-num': dataNum, children }) => {
    const footnotesMap = useContext(FootnoteContext)
    const num = parseInt(dataNum ?? '0', 10)
    const fn = footnotesMap.get(num)
    const title = fn?.title
    const href = fn?.url

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (href) window.open(href, '_blank', 'noopener,noreferrer')
    }

    const tag = (
        <sup className="footnote-ref" onClick={handleClick}>
            <Tag color="blue" style={{
                padding: '0 0.3em',
                marginLeft: '0.1em',
                lineHeight: '1.2em',
                cursor: href ? 'pointer' : 'default',
                textDecoration: 'none',
                userSelect: 'none',
                transition: 'background-color 0.2s',
            }}>
                {children}
            </Tag>
        </sup>
    )

    if (!title) return tag

    return (
        <Popover content={title} trigger="hover">
            {tag}
        </Popover>
    )
}

/** 脚注定义列表组件：使用 antx Sources 渲染 */
export const FootnoteSources: FC<{ footnotes: FootnoteItem[] }> = ({ footnotes }) => {
    const { t } = useTranslation()
    const items = useMemo(
        () => footnotes.map((fn) => ({
            key: fn.key,
            title: `${fn.num}. ${fn.title}`,
            url: fn.url,
            icon: getSourceIcon(fn),
            description: fn.description,
        })),
        [footnotes],
    )

    return (
        <Sources
            style={{ marginTop: 8 }}
            title={t('chat.footnoteSources')}
            items={items}
            defaultExpanded
        />
    )
}
