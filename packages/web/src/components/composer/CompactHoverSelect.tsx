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
 * 预配置的紧凑 Select（composer 参数区共用：权限模式 / 模型 / output style）。
 * 单一定义点：缩小 dropdown 字体的全局样式注入也收口在此，不随调用方复制漂移。
 */

import { HoverSelect } from '@/components/ui/HoverSelect'

// 缩小 dropdown 弹出层的 option 字体（全局注入一次）
export const COMPACT_DROPDOWN_CLASS = 'compact-select-dropdown'
export const MODEL_DROPDOWN_CLASS = 'model-select-dropdown'
let compactStyleInjected = false
function useCompactDropdownStyle() {
    if (!compactStyleInjected && typeof document !== 'undefined') {
        const style = document.createElement('style')
        style.textContent = `
.${COMPACT_DROPDOWN_CLASS} .ant-select-item-option { font-size: 12px !important; padding: 4px 8px !important; min-height: auto !important; }
.${COMPACT_DROPDOWN_CLASS} { max-width: 100vw !important; }
@media (max-width: 640px) {
    .${MODEL_DROPDOWN_CLASS} { right: auto !important; left: 12px !important; max-width: calc(100vw - 24px) !important; }
}
.effort-popover .ant-popover-container { padding: 4px 0 !important; }
.effort-popover .ant-popover-arrow { display: none !important; }
.effort-popover .effort-item:hover { background: var(--ant-color-bg-text-hover) !important; }
.effort-popover .effort-arrow { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; min-height: 24px; border-radius: 4px; }
.effort-popover .effort-arrow:hover { background: var(--ant-color-bg-text-hover); }
`
        document.head.appendChild(style)
        compactStyleInjected = true
    }
}

// 预配置的紧凑 Select，复用共享样式属性
export function CompactHoverSelect(props: Omit<React.ComponentProps<typeof HoverSelect>, 'size' | 'variant' | 'popupMatchSelectWidth' | '$compact'>) {
    useCompactDropdownStyle()
    const { classNames: propsClassNames, ...rest } = props
    // antd Select 的 classNames 是对象 | 函数联合；仅取对象式分支的 popup.root（函数式由 antd 内部消费）
    const extraPopupRoot = typeof propsClassNames === 'object' ? propsClassNames?.popup?.root : undefined
    return (
        <HoverSelect
            {...rest}
            $compact
            size="small"
            variant="filled"
            popupMatchSelectWidth={false}
            classNames={{ popup: { root: [COMPACT_DROPDOWN_CLASS, extraPopupRoot].filter(Boolean).join(' ') } }}
        />
    )
}
