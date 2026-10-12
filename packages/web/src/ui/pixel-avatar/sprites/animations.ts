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

import type { AnimationSet, AgentStatus } from '../types';

const SKIN = '#fde0c8';

export const ANIMATIONS: Record<AgentStatus, AnimationSet> = {
    // 输出中：角色跳动 + 嘴巴开合 + 手臂摆动
    outputting: {
        frames: [
            // 帧0: 嘴开 + 左臂上抬 + 左脚抬起
            [
                [3, 4, '#c0392b'],
                [-1, 7, SKIN], [-1, 9, 'transparent'],
                [1, 10, 'transparent'], [2, 10, 'transparent'],
                [0, 11, 'transparent'], [1, 11, 'transparent'], [2, 11, 'transparent'],
            ],
            // 帧1: 嘴闭 + 右脚抬起
            [
                [3, 4, SKIN],
                [4, 10, 'transparent'], [5, 10, 'transparent'],
                [4, 11, 'transparent'], [5, 11, 'transparent'], [6, 11, 'transparent'],
            ],
            // 帧2: 嘴开 + 右臂上抬 + 右脚抬起
            [
                [3, 4, '#c0392b'],
                [7, 7, SKIN], [7, 9, 'transparent'],
                [4, 10, 'transparent'], [5, 10, 'transparent'],
                [4, 11, 'transparent'], [5, 11, 'transparent'], [6, 11, 'transparent'],
            ],
            // 帧3: 嘴闭 + 左脚抬起
            [
                [3, 4, SKIN],
                [1, 10, 'transparent'], [2, 10, 'transparent'],
                [0, 11, 'transparent'], [1, 11, 'transparent'], [2, 11, 'transparent'],
            ],
        ],
        interval: 120,
    },
    // 等待授权：角色挥手 + 头部微倾 + 眼睛闪烁
    awaiting_auth: {
        frames: [
            [[7, 7, SKIN], [7, 9, 'transparent']],
            [[7, 6, SKIN], [7, 7, SKIN], [7, 8, 'transparent'], [7, 9, 'transparent']],
            [[6, 5, SKIN], [7, 6, 'transparent']],
            [[7, 5, SKIN], [6, 5, 'transparent'], [2, 3, SKIN], [4, 3, SKIN]],
            [[6, 5, SKIN], [7, 5, 'transparent'], [2, 3, '#1a1a2e'], [4, 3, '#1a1a2e']],
            [[6, 5, 'transparent'], [7, 7, 'transparent']],
            [],
            [[2, 3, SKIN], [4, 3, SKIN]],
            [[2, 3, '#1a1a2e'], [4, 3, '#1a1a2e']],
        ],
        interval: 150,
    },
    // 等待输入：角色静坐 + 缓慢呼吸 + 偶尔眨眼
    idle: {
        frames: [
            [[2, 3, SKIN], [4, 3, SKIN]],
            [[2, 3, '#1a1a2e'], [4, 3, '#1a1a2e']],
            [], [], [], [], [], [],
        ],
        interval: 350,
    },
    // 未激活：静态无动画
    inactive: {
        frames: [[]],
        interval: 1000,
    },
};
