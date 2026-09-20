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
 * 画板布局常量（零依赖模块）：画板载体（SketchDrawer）与停靠几何测量方
 * （ChatContainer）共享的单一来源。独立成文件避免测量方为拿常量而静态引入
 * 载体组件（连带 excalidraw 重依赖进入其测试/主 bundle）。
 */

/** PC 停靠高度（占消息列表高度比例）：从 composer 上方抽出，拉满即吊顶（消息区顶） */
export const SKETCH_DOCK_HEIGHT_RATIO = 0.7

/** 载体开合动画时长（ms）：对齐 antd Drawer 的 300ms（运动曲线同在 SketchDrawer）；
 *  入场/出场同长——底部抽屉的滑入滑出本就是同一动画的往返 */
export const SKETCH_SHEET_IN_MS = 300
export const SKETCH_SHEET_OUT_MS = 300

/** 停靠↔全屏几何过渡时长（ms）：四边 inset 的 CSS transition */
export const SKETCH_MORPH_MS = 280

/** 画布几何重算延迟：需盖过载体全部动画（开合/形变）——动画 transform 中间态会被
 *  excalidraw 缓存为画布 rect，动画结束不触发 resize/ResizeObserver，缓存不失效即整体
 *  偏移。从动画时长派生（最长动画 + 一拍余量），时长调整自动跟随，不再靠注释对齐 */
export const SKETCH_CANVAS_SETTLE_MS = Math.max(SKETCH_SHEET_IN_MS, SKETCH_SHEET_OUT_MS, SKETCH_MORPH_MS) + 190
