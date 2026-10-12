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

import type { CharacterSprite, PixelColor } from '../types';

export class SpriteRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private staticLayer: HTMLCanvasElement;
    private character: CharacterSprite;
    pixelSize: number;

    constructor(canvas: HTMLCanvasElement, character: CharacterSprite, displaySize: number = 80) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.character = character;
        this.pixelSize = Math.floor(displaySize / 15);

        // 15×15 方形网格，角色居中
        const canvasSize = 15 * this.pixelSize;
        canvas.width = canvasSize;
        canvas.height = canvasSize;

        this.staticLayer = document.createElement('canvas');
        this.staticLayer.width = canvasSize;
        this.staticLayer.height = canvasSize;
        this.renderStaticLayer();
    }

    private drawPixels(ctx: CanvasRenderingContext2D, pixels: [number, number, PixelColor][]) {
        const offsetX = 4;
        const offsetY = 2;
        for (const [x, y, color] of pixels) {
            const px = (x + offsetX) * this.pixelSize;
            const py = (y + offsetY) * this.pixelSize;
            if (color === 'transparent') {
                ctx.clearRect(px, py, this.pixelSize, this.pixelSize);
                continue;
            }
            ctx.fillStyle = color;
            ctx.fillRect(px, py, this.pixelSize, this.pixelSize);
        }
    }

    private renderStaticLayer() {
        const sctx = this.staticLayer.getContext('2d')!;
        sctx.clearRect(0, 0, this.staticLayer.width, this.staticLayer.height);
        this.drawPixels(sctx, this.character.body.pixels);
        this.drawPixels(sctx, this.character.outfit.pixels);
        this.drawPixels(sctx, this.character.face.pixels);
        this.drawPixels(sctx, this.character.eyes.pixels);
        this.drawPixels(sctx, this.character.hair.pixels);
        this.drawPixels(sctx, this.character.accessory.pixels);
    }

    renderFrame(diffs?: [number, number, PixelColor][]) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(this.staticLayer, 0, 0);
        if (diffs) {
            this.drawPixels(this.ctx, diffs);
        }
    }

    updateCharacter(character: CharacterSprite) {
        this.character = character;
        this.renderStaticLayer();
    }

    destroy() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}
