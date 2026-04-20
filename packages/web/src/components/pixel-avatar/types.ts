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

export type AgentStatus = 'outputting' | 'awaiting_auth' | 'idle' | 'inactive';

export type PixelColor = string;

export interface SpritePart {
    pixels: [number, number, PixelColor][];
}

export interface CharacterSprite {
    hair: SpritePart;
    face: SpritePart;
    eyes: SpritePart;
    outfit: SpritePart;
    accessory: SpritePart;
    body: SpritePart;
}

export interface AnimationSet {
    frames: [number, number, PixelColor][][];
    interval: number;
}

export interface StatusStyle {
    /** 容器背景色，设为 'none' 则透明 */
    background?: string;
    /** 边框样式，设为 'none' 则无边框 */
    border?: string;
    /** 发光效果，设为 'none' 则无发光 */
    glow?: string;
    /** CSS animation 名称，设为 'none' 则禁用动画 */
    animation?: string;
}

export interface PixelAvatarProps {
    name?: string;
    character?: CharacterSprite;
    status: AgentStatus;
    size?: number;
    showLabel?: boolean;
    /** 状态样式映射，可覆盖各状态的背景/边框/发光/动画 */
    statusStyles?: Partial<Record<AgentStatus, StatusStyle>>;
}
