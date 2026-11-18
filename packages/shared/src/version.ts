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
 * CLI↔Server REST/Socket API 发生破坏性变更时提升。
 *
 * v2（tui-fork 票 07）：删除模式互切协议面（`switch` RPC 与
 * `POST /sessions/:id/switch`），会话恒由 daemon/Web 驱动。
 */
export const PROTOCOL_VERSION = 2
