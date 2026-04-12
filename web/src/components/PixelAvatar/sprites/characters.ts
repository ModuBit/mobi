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

function hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash);
}

// 像素标记色（构建时替换）
const OUTLINE = '#1a1a2e';
const SKIN = '#fde0c8';
const OUTFIT = '#e74c3c';
const PANTS = '#2c3e50';

const SKIN_COLORS: PixelColor[] = ['#fde0c8', '#e8b88a', '#c68e5b', '#8d5e3c'];
const HAIR_COLORS: PixelColor[] = ['#1a1a2e', '#6b4423', '#f0c040', '#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#ecf0f1'];
const OUTFIT_COLORS: PixelColor[] = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#e67e22', '#ecf0f1', '#7f8c8d', '#1abc9c'];

type PixelData = [number, number, PixelColor][];

// Q版角色布局：7宽网格(x:0-6)，手臂在x:-1和x:7
// y=-2 ~ -1: 头发（高发型）
// y= 0 ~  6: 头部（7x7含轮廓）
// y= 7 ~  9: 身体（7x3含轮廓）
// y=10:       腿部（各2像素）
// y=11:       鞋子（各3像素）

// 头部：圆角矩形 7宽 × 7高
const FACE_DATA: PixelData = [
    // 顶部轮廓
    [0, 0, OUTLINE], [1, 0, OUTLINE], [2, 0, OUTLINE], [3, 0, OUTLINE], [4, 0, OUTLINE], [5, 0, OUTLINE], [6, 0, OUTLINE],
    // 第1-5行：两侧轮廓 + 肤色填充
    [0, 1, OUTLINE], [1, 1, SKIN], [2, 1, SKIN], [3, 1, SKIN], [4, 1, SKIN], [5, 1, SKIN], [6, 1, OUTLINE],
    [0, 2, OUTLINE], [1, 2, SKIN], [2, 2, SKIN], [3, 2, SKIN], [4, 2, SKIN], [5, 2, SKIN], [6, 2, OUTLINE],
    [0, 3, OUTLINE], [1, 3, SKIN], [2, 3, SKIN], [3, 3, SKIN], [4, 3, SKIN], [5, 3, SKIN], [6, 3, OUTLINE],
    [0, 4, OUTLINE], [1, 4, SKIN], [2, 4, SKIN], [3, 4, SKIN], [4, 4, SKIN], [5, 4, SKIN], [6, 4, OUTLINE],
    [0, 5, OUTLINE], [1, 5, SKIN], [2, 5, SKIN], [3, 5, SKIN], [4, 5, SKIN], [5, 5, SKIN], [6, 5, OUTLINE],
    // 下巴轮廓（较窄）
    [1, 6, OUTLINE], [2, 6, OUTLINE], [3, 6, OUTLINE], [4, 6, OUTLINE], [5, 6, OUTLINE],
];

// 眼睛样式
const EYES_STYLES: PixelData[] = [
    // 圆点眼
    [[2, 3, OUTLINE], [4, 3, OUTLINE]],
    // 宽眼
    [[2, 3, OUTLINE], [3, 3, OUTLINE], [4, 3, OUTLINE]],
];

// 发型样式（#000 占位符 → 发色）
const HAIR_STYLES: { pixels: PixelData }[] = [
    // 短发
    { pixels: [[1, -1, '#000'], [2, -1, '#000'], [3, -1, '#000'], [4, -1, '#000'], [5, -1, '#000'], [0, 0, '#000'], [1, 0, '#000'], [2, 0, '#000'], [3, 0, '#000'], [4, 0, '#000'], [5, 0, '#000'], [6, 0, '#000'], [0, 1, '#000'], [0, 2, '#000']] },
    // 中长发
    { pixels: [[1, -1, '#000'], [2, -1, '#000'], [3, -1, '#000'], [4, -1, '#000'], [5, -1, '#000'], [0, 0, '#000'], [1, 0, '#000'], [2, 0, '#000'], [3, 0, '#000'], [4, 0, '#000'], [5, 0, '#000'], [6, 0, '#000'], [0, 1, '#000'], [0, 2, '#000'], [0, 3, '#000'], [0, 4, '#000']] },
    // 长发
    { pixels: [[1, -1, '#000'], [2, -1, '#000'], [3, -1, '#000'], [4, -1, '#000'], [5, -1, '#000'], [0, 0, '#000'], [1, 0, '#000'], [2, 0, '#000'], [3, 0, '#000'], [4, 0, '#000'], [5, 0, '#000'], [6, 0, '#000'], [0, 1, '#000'], [0, 2, '#000'], [0, 3, '#000'], [0, 4, '#000'], [0, 5, '#000'], [-1, 3, '#000'], [-1, 4, '#000'], [-1, 5, '#000'], [-1, 6, '#000']] },
    // 卷发
    { pixels: [[0, -1, '#000'], [2, -1, '#000'], [4, -1, '#000'], [6, -1, '#000'], [1, -1, '#000'], [3, -1, '#000'], [5, -1, '#000'], [0, 0, '#000'], [1, 0, '#000'], [2, 0, '#000'], [3, 0, '#000'], [4, 0, '#000'], [5, 0, '#000'], [6, 0, '#000'], [0, 1, '#000'], [0, 2, '#000'], [0, 3, '#000'], [0, 4, '#000'], [-1, 2, '#000'], [-1, 3, '#000'], [-1, 4, '#000'], [-1, 5, '#000']] },
    // 寸头
    { pixels: [[1, 0, '#000'], [2, 0, '#000'], [3, 0, '#000'], [4, 0, '#000'], [5, 0, '#000'], [0, 1, '#000']] },
    // 丸子头
    { pixels: [[3, -2, '#000'], [4, -2, '#000'], [2, -1, '#000'], [3, -1, '#000'], [4, -1, '#000'], [5, -1, '#000'], [1, 0, '#000'], [2, 0, '#000'], [3, 0, '#000'], [4, 0, '#000'], [5, 0, '#000'], [0, 1, '#000'], [0, 2, '#000']] },
    // 马尾
    { pixels: [[1, 0, '#000'], [2, 0, '#000'], [3, 0, '#000'], [4, 0, '#000'], [5, 0, '#000'], [0, 1, '#000'], [0, 2, '#000'], [7, 2, '#000'], [7, 3, '#000'], [7, 4, '#000'], [7, 5, '#000']] },
    // 莫西干
    { pixels: [[3, -2, '#000'], [4, -2, '#000'], [2, -1, '#000'], [3, -1, '#000'], [4, -1, '#000'], [5, -1, '#000'], [2, 0, '#000'], [3, 0, '#000'], [4, 0, '#000'], [5, 0, '#000'], [3, 1, '#000'], [4, 1, '#000']] },
];

// 衣服样式（身体 y=7-9，含轮廓）
const OUTFIT_STYLES: { pixels: PixelData }[] = [
    // T恤
    { pixels: [[0, 7, OUTLINE], [1, 7, OUTLINE], [2, 7, OUTLINE], [3, 7, OUTLINE], [4, 7, OUTLINE], [5, 7, OUTLINE], [6, 7, OUTLINE], [0, 8, OUTLINE], [1, 8, OUTFIT], [2, 8, OUTFIT], [3, 8, OUTFIT], [4, 8, OUTFIT], [5, 8, OUTFIT], [6, 8, OUTLINE], [0, 9, OUTLINE], [1, 9, OUTFIT], [2, 9, OUTFIT], [3, 9, OUTFIT], [4, 9, OUTFIT], [5, 9, OUTFIT], [6, 9, OUTLINE]] },
    // 衬衫（领子+纽扣）
    { pixels: [[0, 7, OUTLINE], [1, 7, OUTFIT], [2, 7, OUTFIT], [3, 7, '#ecf0f1'], [4, 7, OUTFIT], [5, 7, OUTFIT], [6, 7, OUTLINE], [0, 8, OUTLINE], [1, 8, OUTFIT], [2, 8, OUTFIT], [3, 8, '#ecf0f1'], [4, 8, OUTFIT], [5, 8, OUTFIT], [6, 8, OUTLINE], [0, 9, OUTLINE], [1, 9, OUTFIT], [2, 9, '#f1c40f'], [3, 9, OUTFIT], [4, 9, '#f1c40f'], [5, 9, OUTFIT], [6, 9, OUTLINE]] },
    // 背心（较窄）
    { pixels: [[1, 7, OUTLINE], [2, 7, OUTLINE], [3, 7, OUTLINE], [4, 7, OUTLINE], [5, 7, OUTLINE], [1, 8, OUTLINE], [2, 8, OUTFIT], [3, 8, OUTFIT], [4, 8, OUTFIT], [5, 8, OUTLINE], [1, 9, OUTLINE], [2, 9, OUTFIT], [3, 9, OUTFIT], [4, 9, OUTFIT], [5, 9, OUTLINE]] },
    // 卫衣（底部口袋）
    { pixels: [[0, 7, OUTLINE], [1, 7, OUTFIT], [2, 7, OUTFIT], [3, 7, OUTFIT], [4, 7, OUTFIT], [5, 7, OUTFIT], [6, 7, OUTLINE], [0, 8, OUTLINE], [1, 8, OUTFIT], [2, 8, OUTFIT], [3, 8, OUTFIT], [4, 8, OUTFIT], [5, 8, OUTFIT], [6, 8, OUTLINE], [0, 9, OUTLINE], [1, 9, OUTFIT], [2, 9, '#ecf0f1'], [3, 9, '#ecf0f1'], [4, 9, '#ecf0f1'], [5, 9, OUTFIT], [6, 9, OUTLINE]] },
    // 马甲（腰带+敞开中缝）
    { pixels: [[0, 7, OUTLINE], [1, 7, OUTLINE], [2, 7, OUTFIT], [3, 7, OUTFIT], [4, 7, OUTFIT], [5, 7, OUTLINE], [6, 7, OUTLINE], [0, 8, OUTLINE], [1, 8, OUTFIT], [2, 8, OUTFIT], [3, 8, '#f1c40f'], [4, 8, OUTFIT], [5, 8, OUTFIT], [6, 8, OUTLINE], [0, 9, OUTLINE], [1, 9, OUTFIT], [2, 9, OUTFIT], [3, 9, OUTFIT], [4, 9, OUTFIT], [5, 9, OUTFIT], [6, 9, OUTLINE]] },
];

// 配饰样式
const ACCESSORY_STYLES: { pixels: PixelData }[] = [
    // 无
    { pixels: [] },
    // 圆框眼镜
    { pixels: [[1, 2, '#8B4513'], [2, 2, '#8B4513'], [3, 2, '#8B4513'], [4, 2, '#8B4513'], [5, 2, '#8B4513'], [1, 3, '#8B4513'], [3, 3, '#8B4513'], [5, 3, '#8B4513'], [1, 4, '#8B4513'], [2, 4, '#8B4513'], [3, 4, '#8B4513'], [4, 4, '#8B4513'], [5, 4, '#8B4513']] },
    // 帽子
    { pixels: [[2, -2, '#f39c12'], [3, -2, '#f39c12'], [4, -2, '#f39c12'], [1, -1, '#f39c12'], [2, -1, '#f39c12'], [3, -1, '#f39c12'], [4, -1, '#f39c12'], [5, -1, '#f39c12'], [-1, 0, '#f39c12'], [0, 0, '#f39c12'], [6, 0, '#f39c12'], [7, 0, '#f39c12']] },
    // 耳环
    { pixels: [[-1, 3, '#f1c40f'], [7, 3, '#f1c40f']] },
    // 围巾
    { pixels: [[1, 6, '#e74c3c'], [2, 6, '#e74c3c'], [3, 6, '#e74c3c'], [4, 6, '#e74c3c'], [5, 6, '#e74c3c'], [5, 7, '#e74c3c'], [5, 8, '#e74c3c']] },
];

// 身体：手臂 + 腿 + 鞋
const BODY_DATA: PixelData = [
    // 手臂（肤色）
    [-1, 8, SKIN], [-1, 9, SKIN], [7, 8, SKIN], [7, 9, SKIN],
    // 腿（裤子）
    [1, 10, PANTS], [2, 10, PANTS], [4, 10, PANTS], [5, 10, PANTS],
    // 鞋
    [0, 11, OUTLINE], [1, 11, OUTLINE], [2, 11, OUTLINE],
    [4, 11, OUTLINE], [5, 11, OUTLINE], [6, 11, OUTLINE],
];

export function buildCharacter(parts: {
    hairStyle: number;
    hairColor: number;
    skinColor: number;
    eyesStyle: number;
    outfitStyle: number;
    outfitColor: number;
    accessoryStyle: number;
}): CharacterSprite {
    const skinColor = SKIN_COLORS[parts.skinColor % SKIN_COLORS.length];

    const face = FACE_DATA.map(([x, y, c]) => {
        if (c === SKIN) return [x, y, skinColor] as [number, number, PixelColor];
        return [x, y, c] as [number, number, PixelColor];
    });

    const body = BODY_DATA.map(([x, y, c]) => {
        if (c === SKIN) return [x, y, skinColor] as [number, number, PixelColor];
        return [x, y, c] as [number, number, PixelColor];
    });

    const hairStyle = HAIR_STYLES[parts.hairStyle % HAIR_STYLES.length];
    const hairColor = HAIR_COLORS[parts.hairColor % HAIR_COLORS.length];
    const hair = hairStyle.pixels.map(([x, y]) => [x, y, hairColor] as [number, number, PixelColor]);

    const eyes = EYES_STYLES[parts.eyesStyle % EYES_STYLES.length];

    const outfitStyle = OUTFIT_STYLES[parts.outfitStyle % OUTFIT_STYLES.length];
    const outfitColor = OUTFIT_COLORS[parts.outfitColor % OUTFIT_COLORS.length];
    const outfit = outfitStyle.pixels.map(([x, y, c]) => {
        if (c === OUTFIT) return [x, y, outfitColor] as [number, number, PixelColor];
        return [x, y, c] as [number, number, PixelColor];
    });

    const accessory = ACCESSORY_STYLES[parts.accessoryStyle % ACCESSORY_STYLES.length];

    return {
        hair: { pixels: hair },
        face: { pixels: face },
        eyes: { pixels: eyes },
        outfit: { pixels: outfit },
        accessory: { pixels: accessory.pixels },
        body: { pixels: body },
    };
}

export function generateCharacter(name: string): CharacterSprite {
    const seed = hashString(name);
    return buildCharacter({
        hairStyle: seed % 8,
        hairColor: (seed >>> 3) % 8,
        skinColor: (seed >>> 6) % 4,
        eyesStyle: (seed >>> 8) % 2,
        outfitStyle: (seed >>> 10) % 5,
        outfitColor: (seed >>> 13) % 8,
        accessoryStyle: (seed >>> 16) % 5,
    });
}
