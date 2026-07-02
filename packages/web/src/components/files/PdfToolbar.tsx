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

import { Button } from 'antd'
import { useTranslation } from 'react-i18next'

/** 缩放下界（到边界 - 按钮禁用） */
export const MIN_SCALE = 0.5
/** 缩放上界（到边界 + 按钮禁用） */
export const MAX_SCALE = 3
/** 缩放步进 */
export const SCALE_STEP = 0.2
/** 把缩放值约束到 [MIN_SCALE, MAX_SCALE]（按钮步进、pinch、适应宽度共用） */
export const clampScale = (s: number): number => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))

interface PdfToolbarProps {
    /** 当前缩放比例（1 = 100%） */
    scale: number
    /** 缩放变更回调（已 clamp + toFixed） */
    onScaleChange: (s: number) => void
    /** 适应宽度回调 */
    onFitWidth: () => void
    /** 还原 100% 回调 */
    onReset: () => void
}

/**
 * PDF 缩放工具栏（叶子组件，被 PdfContentViewImpl 使用）：
 * - `-` [比例%] `+` [适应宽度] [100%]
 * - 步进 SCALE_STEP，clamp 到 [MIN_SCALE, MAX_SCALE]，到边界按钮禁用
 * - 显示 Math.round(scale * 100)%
 *
 * 常量（MIN_SCALE/MAX_SCALE/SCALE_STEP）在此导出而非 PdfContentViewImpl，
 * 因为这里是叶子组件、被 Impl import，放这里避免循环依赖。
 */
export default function PdfToolbar({
    scale,
    onScaleChange,
    onFitWidth,
    onReset,
}: PdfToolbarProps) {
    const { t } = useTranslation()
    // toFixed(1) 避免浮点累加（0.1+0.2=0.30000000000000004）
    const zoomIn = () => onScaleChange(clampScale(+(scale + SCALE_STEP).toFixed(1)))
    const zoomOut = () => onScaleChange(clampScale(+(scale - SCALE_STEP).toFixed(1)))

    return (
        <div
            style={{
                padding: '4px 8px',
                flexShrink: 0,
                display: 'flex',
                gap: 4,
                alignItems: 'center',
                justifyContent: 'center',
                borderBottom: '1px solid var(--ant-color-border-secondary)',
            }}
        >
            <Button size="small" disabled={scale <= MIN_SCALE} onClick={zoomOut}>
                -
            </Button>
            <span style={{ fontSize: 12, minWidth: 48, textAlign: 'center' }}>
                {Math.round(scale * 100)}%
            </span>
            <Button size="small" disabled={scale >= MAX_SCALE} onClick={zoomIn}>
                +
            </Button>
            <Button size="small" onClick={onFitWidth}>
                {t('files.fitWidth')}
            </Button>
            <Button size="small" onClick={onReset}>
                {t('files.actualSize')}
            </Button>
        </div>
    )
}
