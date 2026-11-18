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
 * 历史 local 会话的只读遮罩（tui-fork 票 04）。
 *
 * local 模式已不再产生新会话；该遮罩只服务存量会话：盖住输入区并说明原因，
 * **不提供任何操作入口**（模式切换能力已随 local 退场删除）。
 */

export function LocalModeCover({ message }: { message: string }) {
    return (
        <div
            className="activate-cover-mask"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 56,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--radius-panel)',
                zIndex: 10,
            }}
        >
            <span style={{ color: 'var(--ant-color-text-secondary)', fontSize: 14 }}>{message}</span>
        </div>
    )
}
