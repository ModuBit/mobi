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

import { Component, type ReactNode } from 'react'
import { Button, Result } from 'antd'
import { useTranslation } from 'react-i18next'

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

    handleReset = () => {
        this.setState({ hasError: false, error: null })
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
                            <Button type="primary" onClick={this.handleReset}>
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
