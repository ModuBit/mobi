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

interface DropdownContainerProps {
    loading: boolean
    hasItems: boolean
    children: React.ReactNode
}

/** 下拉列表容器，统一样式与加载态 */
export function DropdownContainer({ loading, hasItems, children }: DropdownContainerProps) {
    if (!hasItems && !loading) return null

    return (
        <div
            role="listbox"
            style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                maxHeight: 240,
                overflowY: 'auto',
                backgroundColor: 'var(--ant-color-bg-elevated)',
                borderRadius: 'var(--ant-border-radius)',
                boxShadow: 'var(--ant-box-shadow-secondary)',
                zIndex: 50,
                marginBottom: 4,
            }}
        >
            {loading && !hasItems ? (
                <div style={{ padding: '8px 12px', color: 'var(--ant-color-text-tertiary)', fontSize: 14 }}>
                    ...
                </div>
            ) : children}
        </div>
    )
}
