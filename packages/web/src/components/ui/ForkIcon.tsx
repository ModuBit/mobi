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

import { Split } from 'lucide-react'

/**
 * 分叉（fork）动作图标：Split 顺时针旋转 90°。
 * 旋转语义全网唯一由本组件承载——分叉方向的表达若散落各调用点会漂移
 * （如某处忘了转、某处转错方向），改朝向只动这里。
 */
export function ForkIcon({ size }: { size: number }) {
    return <Split size={size} style={{ transform: 'rotate(90deg)' }} />
}
