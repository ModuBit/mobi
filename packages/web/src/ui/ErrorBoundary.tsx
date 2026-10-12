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

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Result } from 'antd'
import { useTranslation } from 'react-i18next'
import { reloadPage } from '@/core/utils/reload'

interface ErrorBoundaryProps {
    children: ReactNode
    /** 自定义降级 UI */
    fallback?: ReactNode
}

interface ErrorBoundaryState {
    hasError: boolean
    error: Error | null
}

/**
 * 判断是否为动态 import（懒加载 chunk）失败。
 *
 * 两种形态都要覆盖：
 * 1. 网络层失败（chunk 不存在 / 部署漂移 / 断网）：浏览器抛
 *    "Failed to fetch dynamically imported module" / "error loading dynamically imported module"。
 * 2. 取到了响应但不是合法 JS（如 SPA fallback 把缺失的 /assets/oldhash.js 回退成
 *    index.html 200）：作为 ES 模块解析抛 SyntaxError。
 *
 * 这两种情形下「仅清 state 重渲染」必然再次失败（lazy 会重试同一个已失效的 chunk），
 * 必须整页刷新拿到最新 no-cache index.html（含新 chunk 哈希）才能恢复。
 */
function isDynamicImportFailure(error: Error | null): boolean {
    if (!error) return false
    const msg = (error.message ?? '').toLowerCase()
    return (
        msg.includes('failed to fetch dynamically imported module') ||
        msg.includes('error loading dynamically imported module') ||
        msg.includes('importing a module script failed') ||
        error.name === 'SyntaxError'
    )
}

/**
 * 错误边界组件
 * 捕获子组件树中的未处理异常，展示降级 UI
 */
class ErrorBoundaryInner extends Component<ErrorBoundaryProps & { t: (key: string) => string }, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps & { t: (key: string) => string }) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ErrorBoundary]', error, info.componentStack)
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null })
    }

    /**
     * 重试：dynamic import 失败时整页刷新（拉最新 index.html）；其它错误清 state 重渲染。
     * 部署漂移下旧 chunk 已失效，仅清 state 会让 lazy 重试同一失效 chunk → 必然再失败。
     */
    handleRetry = () => {
        if (isDynamicImportFailure(this.state.error)) {
            reloadPage()
            return
        }
        this.handleReset()
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback
            }

            return (
                <div style={{ padding: 24, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
                    <Result
                        status="error"
                        title={this.props.t('errorBoundary.title')}
                        subTitle={this.props.t('errorBoundary.subtitle')}
                        extra={
                            <Button type="primary" onClick={this.handleRetry}>
                                {this.props.t('errorBoundary.retry')}
                            </Button>
                        }
                    />
                </div>
            )
        }

        return this.props.children
    }
}

/**
 * 带有 i18n 支持的 ErrorBoundary
 */
export function ErrorBoundary(props: ErrorBoundaryProps) {
    const { t } = useTranslation()
    return <ErrorBoundaryInner {...props} t={t} />
}
