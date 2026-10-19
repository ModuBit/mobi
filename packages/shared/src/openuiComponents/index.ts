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
 * openui 自定义组件目录（票 03，12 个组件）——**签名单源**，两个消费端：
 * - web 渲染器（mobiLibrary）：签名 + React 实现组成 defineComponent
 * - session prompt 生成器：只需签名（component 用空桩），随 library.prompt()
 *   进入 openui skill 全量目录
 *
 * 为什么拆分实现与签名：两包（web / session）互不可依赖，shared 是唯一共同
 * 依赖；而组件实现触 React（daemon/session 不能引入 React），故 shared 只放
 * name/props/description 三件生成端协议。实现见 web 侧 `ui/openui/`。
 *
 * 来源：https://github.com/thesysdev/open-intelligent-ui
 * `src/lib/components/{chart,svg,html-view}.tsx`（Chart / Svg 图元 / HtmlView）。
 * 上游为 MIT 许可，以下声明随代码保留：
 *
 * MIT License
 *
 * Copyright (c) Thesys Dev
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * 未移植：demo 中的 MapView（依赖 demo 自有瓦片服务）；mobi 的 Map 组件另行
 * 基于高德地图实现（`map.ts`，三档渲染），不复用 demo 实现。差异：HtmlView 的
 * CSP 按 mobi 安全基线收紧（connect-src 关闭，见 web 实现注释）。
 */

export { chartComponentSpec, chartProps } from './chart'
export {
    mapComponentSpec,
    mapCoordinate,
    mapMarkerSchema,
    mapPathSchema,
    mapProps,
    CHINA_BOUNDS,
    OVERSEAS_MAX_STATIC_ZOOM,
    isInChina,
    isOverseasMapView,
    type MapProps,
} from './map'
export { htmlViewComponentSpec } from './htmlView'
export {
    children,
    circleComponentSpec,
    color,
    ellipseComponentSpec,
    gComponentSpec,
    length,
    lineComponentSpec,
    pathComponentSpec,
    polygonComponentSpec,
    polylineComponentSpec,
    rectComponentSpec,
    svgComponentSpec,
    svgComponentSpecs,
    svgTextComponentSpec,
} from './svg'

import { chartComponentSpec } from './chart'
import { htmlViewComponentSpec } from './htmlView'
import { mapComponentSpec } from './map'
import { svgComponentSpecs } from './svg'

/** 全量自定义组件签名（13 个）——注册顺序与 prompt 排序无关，仅保证确定 */
export const openuiComponentSpecs = [chartComponentSpec, mapComponentSpec, ...svgComponentSpecs, htmlViewComponentSpec]
