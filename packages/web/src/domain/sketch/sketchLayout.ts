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

/** PC 停靠底边与 composer 顶边的间距（px）：贴着会显得粘连成一体，留一缝保持「浮层」层次 */
export const SKETCH_DOCK_GAP = 8

/** PC 停靠浮层单侧水平留白（px）：浮层永远不贴左右边缘。不依赖 CHAT_MAX_WIDTH 居中兜底——
 *  视口减去侧栏/面板不足 1200 时按层宽渲染，无留白即贴边（与 composer 侧边距同一规则） */
export const SKETCH_DOCK_SIDE_INSET = 8

/** 载体开合动画时长（ms）：滑沉消隐——原地微沉/升起一段小距离 + 淡出/淡入（对称往返），
 *  不经过 composer（穿过其周边透明缝隙会「穿帮」）。时长单源 sketchLayout
 *  （画布 settle 定时从它派生，改这里自动跟随） */
export const SKETCH_SHEET_IN_MS = 240
export const SKETCH_SHEET_OUT_MS = 240

/** 停靠↔全屏几何过渡时长（ms）：四边 inset 的 CSS transition */
export const SKETCH_MORPH_MS = 280

/**
 * 画板浮层 stacking 阶梯（跨文件契约，单一来源在此）：
 * mask(100) < 停靠浮层(101) < composer(102，ChatContainer) < 全屏浮层(103)。
 * 停靠低于 composer 维持既有 stacking 阶梯（浮层是临时层）；全屏高于 composer 是画布不悬浮
 * 输入框的前提——四处魔数若靠注释互指，拼写错误会静默破坏动画，勿内联回去。
 *
 * 阶梯整体压在 antd 弹层 z 区间（默认 1000：Drawer/Modal）之下：画板浮层是页内临时层，
 * 不得盖过抽屉/对话框；曾用 1000–1003 与 antd 区间重叠，导致 composer(z 1002) 压住
 * agent 抽屉（z 1000），已降档修复。
 */
export const SKETCH_Z_MASK = 100
export const SKETCH_Z_DOCK = 101
export const SKETCH_Z_COMPOSER = 102
export const SKETCH_Z_FULLSCREEN = 103

/** 画布几何重算延迟：需盖过载体全部动画（开合/形变）——动画 transform 中间态会被
 *  excalidraw 缓存为画布 rect，动画结束不触发 resize/ResizeObserver，缓存不失效即整体
 *  偏移。从动画时长派生（最长动画 + 一拍余量），时长调整自动跟随，不再靠注释对齐 */
export const SKETCH_CANVAS_SETTLE_MS = Math.max(SKETCH_SHEET_IN_MS, SKETCH_SHEET_OUT_MS, SKETCH_MORPH_MS) + 190
