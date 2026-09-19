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
