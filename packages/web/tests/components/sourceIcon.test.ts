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

import { describe, it, expect } from 'vitest'
import { extractDomain, extractExt, getSourceIcon, DOMAIN_ICON_MAP, EXT_ICON_MAP } from '@/components/ui/sourceIcon'
import { render } from '@testing-library/react'

describe('extractDomain', () => {
    it('提取普通二级域名', () => {
        expect(extractDomain('https://github.com/user/repo')).toBe('github.com')
    })

    it('子域名逐级剥离匹配映射', () => {
        expect(extractDomain('https://docs.github.com/page')).toBe('github.com')
    })

    it('提取短链域名', () => {
        expect(extractDomain('https://youtu.be/abc')).toBe('youtu.be')
    })

    it('提取三级子域名', () => {
        expect(extractDomain('https://help.aliyun.com/doc')).toBe('aliyun.com')
    })

    it('无效 URL 返回 undefined', () => {
        expect(extractDomain('not-a-url')).toBeUndefined()
    })

    it('完整 hostname 能匹配映射时直接返回', () => {
        expect(extractDomain('https://weixin.qq.com/s/abc')).toBe('weixin.qq.com')
    })

    it('三级域名匹配映射后回退', () => {
        expect(extractDomain('https://help.aliyun.com/doc')).toBe('aliyun.com')
    })

    it('无映射的子域名回退到二级+顶级', () => {
        expect(extractDomain('https://docs.python.org/3/')).toBe('python.org')
    })

    it('IP 地址直接返回完整 hostname', () => {
        expect(extractDomain('http://192.168.1.1/file')).toBe('192.168.1.1')
    })

    it('http 协议也正常解析', () => {
        expect(extractDomain('http://example.com/path')).toBe('example.com')
    })
})

describe('extractExt', () => {
    it('提取 .ts 扩展名', () => {
        expect(extractExt('/src/index.ts')).toBe('ts')
    })

    it('大写扩展名转小写', () => {
        expect(extractExt('/file.JS')).toBe('js')
    })

    it('无扩展名返回 undefined', () => {
        expect(extractExt('/path/to/file')).toBeUndefined()
    })

    it('隐藏文件返回 undefined', () => {
        expect(extractExt('.gitignore')).toBeUndefined()
    })
})

describe('DOMAIN_ICON_MAP 覆盖率', () => {
    const knownDomains = [
        'github.com', 'x.com', 'twitter.com', 'youtube.com', 'youtu.be',
        'google.com', 'reddit.com', 'linkedin.com', 'facebook.com',
        'docker.com', 'gitlab.com', 'slack.com', 'apple.com',
        'instagram.com', 'microsoft.com',
        'wechat.com', 'weixin.qq.com', 'dingtalk.com',
        'aliyun.com', 'alibaba.com', 'aliyun-inc.com', 'yuque.com',
    ]

    it('所有已知域名都有映射', () => {
        for (const domain of knownDomains) {
            expect(DOMAIN_ICON_MAP[domain], `域名 ${domain} 未映射`).toBeDefined()
        }
    })
})

describe('EXT_ICON_MAP 覆盖率', () => {
    it('常见代码文件都有映射', () => {
        const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs', 'css', 'vue', 'html']
        for (const ext of codeExts) {
            expect(EXT_ICON_MAP[ext], `扩展名 .${ext} 未映射`).toBeDefined()
        }
    })

    it('常见文档文件都有映射', () => {
        const docExts = ['md', 'txt', 'log', 'pdf', 'doc', 'docx', 'xls', 'xlsx']
        for (const ext of docExts) {
            expect(EXT_ICON_MAP[ext], `扩展名 .${ext} 未映射`).toBeDefined()
        }
    })

    it('图片文件都有映射', () => {
        const imgExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']
        for (const ext of imgExts) {
            expect(EXT_ICON_MAP[ext], `扩展名 .${ext} 未映射`).toBeDefined()
        }
    })

    it('音视频文件都有映射', () => {
        const mediaExts = ['mp4', 'mp3', 'wav', 'flac']
        for (const ext of mediaExts) {
            expect(EXT_ICON_MAP[ext], `扩展名 .${ext} 未映射`).toBeDefined()
        }
    })
})

describe('getSourceIcon', () => {
    it('无 url 时返回 Link2 图标', () => {
        const { container } = render(getSourceIcon({})!)
        expect(container.querySelector('svg')).toBeTruthy()
    })

    it('品牌域名返回对应 antd 图标', () => {
        const { container } = render(getSourceIcon({ url: 'https://github.com/user/repo' })!)
        expect(container.querySelector('.anticon')).toBeTruthy()
    })

    it('未知网站返回 Globe 图标', () => {
        const { container } = render(getSourceIcon({ url: 'https://example.com/page' })!)
        const svg = container.querySelector('svg')
        expect(svg).toBeTruthy()
    })

    it('文件路径按扩展名返回 lucide 图标', () => {
        const { container } = render(getSourceIcon({ url: '/src/index.ts' })!)
        const svg = container.querySelector('svg')
        expect(svg).toBeTruthy()
    })

    it('无法识别的路径返回 File 图标', () => {
        const { container } = render(getSourceIcon({ url: 'no-extension-path' })!)
        const svg = container.querySelector('svg')
        expect(svg).toBeTruthy()
    })

    it('weixin.qq.com 返回 Wechat 图标', () => {
        const { container } = render(getSourceIcon({ url: 'https://weixin.qq.com/s/abc' })!)
        expect(container.querySelector('.anticon-wechat')).toBeTruthy()
    })
})
