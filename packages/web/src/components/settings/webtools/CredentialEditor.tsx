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

import type { RedactedWebToolsConfig } from '@mobi/shared'

/**
 * 验证连接结果（verify RPC envelope，success 风格）：
 * 成功带延迟毫秒数；失败带错误文案（runner/传输层错误统一收敛为 success:false 由调用侧包装）。
 */
export type VerifyResult = { success: true; latencyMs: number } | { success: false; error: string }

/** 脱敏配置中的 provider 条目（凭据只有 set 标记 + 掩码 preview，无明文） */
export type ProviderEntry = NonNullable<RedactedWebToolsConfig['providers']>[number]

export interface CredentialEditorProps {
    provider: ProviderEntry
    /** 在场性提交：只提交编辑中的凭据键（string=新值；null=清除） */
    onSave: (credentials: Record<string, string | null>) => Promise<boolean>
    onVerify: (credentials: Record<string, string>) => Promise<VerifyResult>
}

/**
 * 凭据编辑器（S9 实装）：只读预览态（掩码 preview）/ 替换编辑态 / 验证连接。
 * 本占位仅定义契约——ProviderCard 展开区先渲染 null，S9 落地后恢复真实交互与测试。
 */
export function CredentialEditor(_props: CredentialEditorProps): null {
    return null
}
