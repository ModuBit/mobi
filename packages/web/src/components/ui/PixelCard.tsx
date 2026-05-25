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
 * PixelCard — 鼠标悬停时像素粒子从中心向外扩散的效果
 * 基于 React Bits PixelCard 改造，适配项目主题
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

class Pixel {
    width: number
    height: number
    ctx: CanvasRenderingContext2D
    x: number
    y: number
    color: string
    speed: number
    size = 0
    sizeStep: number
    minSize: number
    maxSizeInteger: number
    maxSize: number
    delay: number
    counter = 0
    counterStep: number
    isIdle = false
    isReverse = false
    isShimmer = false

    constructor(
        canvas: HTMLCanvasElement,
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        color: string,
        speed: number,
        delay: number,
    ) {
        this.width = canvas.width
        this.height = canvas.height
        this.ctx = ctx
        this.x = x
        this.y = y
        this.color = color
        this.speed = this.random(0.1, 0.9) * speed
        this.sizeStep = Math.random() * 0.4
        this.minSize = 0.5
        this.maxSizeInteger = 2
        this.maxSize = this.random(this.minSize, this.maxSizeInteger)
        this.delay = delay
        this.counterStep = Math.random() * 4 + (this.width + this.height) * 0.01
    }

    private random(min: number, max: number) {
        return Math.random() * (max - min) + min
    }

    draw() {
        const offset = this.maxSizeInteger * 0.5 - this.size * 0.5
        this.ctx.fillStyle = this.color
        this.ctx.fillRect(this.x + offset, this.y + offset, this.size, this.size)
    }

    appear() {
        this.isIdle = false
        if (this.counter <= this.delay) {
            this.counter += this.counterStep
            return
        }
        if (this.size >= this.maxSize) this.isShimmer = true
        if (this.isShimmer) {
            this.shimmer()
        } else {
            this.size += this.sizeStep
        }
        this.draw()
    }

    disappear() {
        this.isShimmer = false
        this.counter = 0
        if (this.size <= 0) {
            this.isIdle = true
            return
        }
        this.size -= 0.1
        this.draw()
    }

    shimmer() {
        if (this.size >= this.maxSize) this.isReverse = true
        else if (this.size <= this.minSize) this.isReverse = false
        this.size += this.isReverse ? -this.speed : this.speed
    }
}

function effectiveSpeed(value: number, reducedMotion: boolean): number {
    if (value <= 0 || reducedMotion) return 0
    if (value >= 100) return 100 * 0.001
    return value * 0.001
}

export type PixelCardProps = {
    /** 像素间距，默认 5 */
    gap?: number
    /** 动画速度 0-100，默认 35 */
    speed?: number
    /** 逗号分隔的颜色列表 */
    colors?: string
    className?: string
    style?: CSSProperties
    children: ReactNode
}

export function PixelCard({
    gap = 5,
    speed = 35,
    colors = '#f8fafc,#f1f5f9,#cbd5e1',
    className = '',
    style,
    children,
}: PixelCardProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const pixelsRef = useRef<Pixel[]>([])
    const rafRef = useRef<number | null>(null)
    const prevTimeRef = useRef(performance.now())
    const reducedMotion = useRef(
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ).current

    const initPixels = () => {
        const container = containerRef.current
        const canvas = canvasRef.current
        if (!container || !canvas) return

        const rect = container.getBoundingClientRect()
        const w = Math.floor(rect.width)
        const h = Math.floor(rect.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        canvas.width = w
        canvas.height = h
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`

        const colorsArr = colors.split(',')
        const spd = effectiveSpeed(speed, reducedMotion)
        const pxs: Pixel[] = []
        for (let x = 0; x < w; x += gap) {
            for (let y = 0; y < h; y += gap) {
                const color = colorsArr[Math.floor(Math.random() * colorsArr.length)]
                const dx = x - w / 2
                const dy = y - h / 2
                const delay = reducedMotion ? 0 : Math.sqrt(dx * dx + dy * dy)
                pxs.push(new Pixel(canvas, ctx, x, y, color, spd, delay))
            }
        }
        pixelsRef.current = pxs
    }

    const animate = (fnName: 'appear' | 'disappear') => {
        rafRef.current = requestAnimationFrame(() => animate(fnName))
        const now = performance.now()
        const elapsed = now - prevTimeRef.current
        if (elapsed < 1000 / 60) return
        prevTimeRef.current = now - (elapsed % (1000 / 60))

        const ctx = canvasRef.current?.getContext('2d')
        if (!ctx || !canvasRef.current) return
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)

        let allIdle = true
        for (const px of pixelsRef.current) {
            px[fnName]()
            if (!px.isIdle) allIdle = false
        }
        if (allIdle && rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
        }
    }

    const startAnimation = (name: 'appear' | 'disappear') => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => animate(name))
    }

    useEffect(() => {
        initPixels()
        const observer = new ResizeObserver(initPixels)
        if (containerRef.current) observer.observe(containerRef.current)
        return () => {
            observer.disconnect()
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gap, speed, colors])

    return (
        <div
            ref={containerRef}
            className={`pixel-card ${className}`}
            style={{ position: 'relative', overflow: 'hidden', ...style }}
            onMouseEnter={() => startAnimation('appear')}
            onMouseLeave={() => startAnimation('disappear')}
        >
            <canvas style={{ display: 'block', position: 'absolute', inset: 0, pointerEvents: 'none' }} ref={canvasRef} />
            <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
        </div>
    )
}
