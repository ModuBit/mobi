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

import { useRef, useMemo, memo } from 'react';
import type { PixelAvatarProps, StatusStyle, AgentStatus } from './types';
import { generateCharacter } from './sprites/characters';
import { useAnimationLoop } from './hooks/useAnimationLoop';
import './PixelAvatar.css';

// 各状态默认样式
const DEFAULT_STATUS_STYLES: Record<AgentStatus, StatusStyle> = {
    outputting: {
        border: 'none',
        animation: 'pixel-avatar-pulse 1.2s ease-in-out infinite',
    },
    awaiting_auth: {
        border: 'none',
        animation: 'pixel-avatar-breathe-yellow 2s ease-in-out infinite',
    },
    idle: {
        border: 'none',
        animation: 'pixel-avatar-breathe-gray 3s ease-in-out infinite',
    },
    inactive: {
        background: 'none',
        border: 'none',
        glow: 'none',
        animation: 'none',
    },
};

function getContainerStyle(status: AgentStatus, size: number, overrides?: StatusStyle): React.CSSProperties {
    const defaults = DEFAULT_STATUS_STYLES[status];
    const bg = overrides?.background !== undefined ? overrides.background : defaults.background;
    const border = overrides?.border !== undefined ? overrides.border : defaults.border;
    const glow = overrides?.glow !== undefined ? overrides.glow : defaults.glow;
    const animation = overrides?.animation !== undefined ? overrides.animation : defaults.animation;

    const style: React.CSSProperties = {
        width: size,
        height: size,
        borderRadius: 12,
        overflow: 'hidden',
        transition: 'background 0.3s, border-color 0.3s, box-shadow 0.3s, opacity 0.3s',
    };

    if (bg === 'none') {
        style.background = 'transparent';
    } else if (bg) {
        style.background = bg;
    }

    if (border === 'none') {
        style.border = 'none';
    } else if (border) {
        style.border = border;
    }

    if (glow === 'none') {
        style.boxShadow = 'none';
    } else if (glow) {
        style.boxShadow = glow;
    }

    if (animation === 'none') {
        style.animation = 'none';
    } else if (animation) {
        style.animation = animation;
    }

    // inactive 状态：灰度 + 降低透明度
    if (status === 'inactive') {
        style.opacity = 0.45;
        style.filter = 'grayscale(1)';
    }

    return style;
}

function PixelAvatarInner({ name, character: characterProp, status, size = 36, showLabel = false, statusStyles }: PixelAvatarProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const character = characterProp ?? useMemo(() => generateCharacter(name ?? ''), [name]);

    useAnimationLoop(canvasRef, character, status, size);

    const override = statusStyles?.[status];
    const containerStyle = useMemo(
        () => getContainerStyle(status, size, override),
        [status, size, override],
    );

    return (
        <div className="pixel-avatar" style={containerStyle}>
            <canvas ref={canvasRef} />
            {showLabel && name && (
                <span style={{
                    position: 'absolute', bottom: 2, left: 0, right: 0,
                    textAlign: 'center', fontSize: 8, fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {name}
                </span>
            )}
        </div>
    );
}

export const PixelAvatar = memo(PixelAvatarInner);
