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
 * Settings 类型独立定义。
 *
 * 断环（personal-agent-rewrite ticket-11）：configuration →（type）persistence 与
 * persistence →（值）configuration 构成循环依赖，类型边抽到本文件后两模块均只
 * 单向依赖此类型源。persistence 保留 re-export，调用方零改动。
 */

import type { WebToolsConfig } from '@mobi/shared'

export interface Settings {
  // This ID is used as the actual database ID on the server
  // All machine operations use this ID
  machineId?: string
  // cli 的连接凭证（`mobi auth login` 写入，随 cli 部署位置走）；
  // hub 侧验证基准存 settings.hub.json，两份语义独立
  cliApiToken?: string
  // API URL for server connections (priority: env MOBI_API_URL > this > default)
  apiUrl?: string
  // Legacy field name (for migration, read-only)
  serverUrl?: string
  // 超时配置
  disconnectTimeoutMs?: number   // 连接断开超时
  idleTimeoutMs?: number         // 交互不活跃超时
  timeoutWarningMs?: number      // 预警提前时间
  // 升级 channel: 'stable' | 'rc'，默认 'stable'
  updateChannel?: 'stable' | 'rc'
  // 注入给 claude 子进程的额外环境变量（优先级高于 process.env 与内置开关）
  // 由 buildClaudeFeatureEnv 合并进 sdkOptions.env，用户可在 settings.cli.json 自由扩展
  claudeEnv?: Record<string, string>
  // !bash 命令本地执行后，是否把命令+输出作为隐藏上下文注入 SDK，让模型感知并响应。
  // true（默认）= 注入即响应（等同 Claude CLI 的 respondToBashCommands:true）；
  // false = 仅本地执行、UI 展示合成工具对，模型完全不参与（!cmd 不耗 token）。
  bashInjectContext?: boolean
  // web 工具配置（provider 启停/凭据/当前选择），由 runner RPC 读写；会话进程 mtime 惰性读
  webTools?: WebToolsConfig
}
