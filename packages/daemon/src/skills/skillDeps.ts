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
 * skills 域可注入依赖的单一声明源（架构深化候选⑤）：
 * appDeps / 路由工厂 / 测试装置三处共引此类型，避免同一组依赖在装配链上
 * 被逐字段声明/投影四遍。纯依赖聚合——行为编排仍在路由（候选③裁决），
 * 等 mcp 管理页（迭代 2）真出现第二个资源族再议服务化。
 */
import type { SkillScanRoots } from './skillScanner'
import type { SkillsCliRunner } from './skillCli'
import type { SkillsBundledDeps } from './bundledSkills'

export type SkillsDeps = {
    /** 扫描根 fixture（缺省生产值由路由内部解析） */
    scanRoots?: SkillScanRoots
    /** CLI 执行器（缺省生产值 spawn npx；测试必须注入，见 setupTestApp fail-fast） */
    cliRunner?: SkillsCliRunner
    /** bundled 名单依赖（缺省生产值 = dataDir 缓存 + 真 SDK 自采） */
    bundled?: SkillsBundledDeps
}
