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
 * Web 凭据验证抽象
 *
 * 第一阶段：只接受 webApiToken。
 * 后续「短期临时密钥」上线时，本函数扩展为「webApiToken 或有效临时凭据」，
 * 路由层（/api/auth）零改动 —— VerifiedWebCredential 的 deviceId/scope 字段已预留。
 */

import { configuration } from '../../configuration'
import { constantTimeEquals } from '../../utils/crypto'
import { parseAccessToken } from '../../utils/accessToken'

export interface VerifiedWebCredential {
    /** 设备标识，第一阶段恒为 undefined，给后续按设备签发短期密钥留位 */
    deviceId?: string
    /** 作用域，第一阶段恒为 undefined */
    scope?: string
}

/**
 * 验证 Web 凭据。
 * @returns 验证成功返回对象（第一阶段为空对象），失败返回 null
 */
export async function verifyWebCredential(rawToken: string): Promise<VerifiedWebCredential | null> {
    const parsed = parseAccessToken(rawToken)
    if (!parsed || !constantTimeEquals(parsed.baseToken, configuration.webApiToken)) {
        return null
    }
    return {}
}
