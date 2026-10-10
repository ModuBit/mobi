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
 * mode=app 入向 bridge（generative-ui 票 06）：沙箱 app → 宿主的受控通信通道。
 *
 * 形态参照 ChatGPT GenUI / CopilotKit Websandbox 的「宿主注入全局对象」：iframe load
 * 后注入 `window.MobiApp.issueNewTurn(text)`，内部经 postMessage 发宿主；宿主侧经
 * 四道校验后才进消息受理 intake（与 openui 回路② 同一单点）：
 *   1. 来源 frame：event.source 必须是宿主自己渲染的那个 sandbox iframe（组件层收口）
 *   2. 白名单：仅 type 'mobi-app' + action 'issueNewTurn'（本模块 parseAppBridgeMessage）
 *   3. schema：text 限 string / trim 非空 / 限长（超限整体拒绝，不截断——截断会静默改语义）
 *   4. 限流：app 内脚本自动调用与用户点击在宿主侧不可区分，最小间隔把「脚本刷消息」
 *      的伤害面压到「最多每秒一条」，配合气泡上的来源标记（sentFrom）供用户辨识
 *
 * 威胁评估与残余风险见 ADR 0007 增补（docs/adr/0007）。PREVIEW_CSP 的
 * script-src 带 'unsafe-inline'（产物页行内脚本是常规形态），宿主注入的脚本可执行；
 * connect-src 'none' 不影响 postMessage（非网络请求）。
 */

/** bridge 消息的 type 白名单值（唯一） */
export const APP_BRIDGE_MSG_TYPE = 'mobi-app'
/** bridge 消息的 action 白名单值（唯一；openLink 等第二通道需求出现再加，见票 06 记录） */
export const APP_BRIDGE_ACTION = 'issueNewTurn'
/** text 上限：app 状态摘要不该长过一条人写的消息 */
export const APP_BRIDGE_TEXT_MAX = 4000
/** 限流最小间隔（ms）：同一 frame 两次 issueNewTurn 之间至少隔这么久 */
export const APP_BRIDGE_MIN_INTERVAL_MS = 1000

/**
 * 校验宿主收到的 postMessage data（纯函数）。非白名单 type/action、text 非 string、
 * trim 后空或超限 → null（静默丢弃，不回错——app 无法处理也没有必要知道）。
 */
export function parseAppBridgeMessage(data: unknown): { text: string } | null {
    if (typeof data !== 'object' || data === null) return null
    const obj = data as Record<string, unknown>
    if (obj.type !== APP_BRIDGE_MSG_TYPE) return null
    if (obj.action !== APP_BRIDGE_ACTION) return null
    if (typeof obj.text !== 'string') return null
    const text = obj.text.trim()
    if (text.length === 0 || text.length > APP_BRIDGE_TEXT_MAX) return null
    return { text }
}

const APP_BRIDGE_SCRIPT_ID = 'mobi-app-bridge'

/**
 * 注入 app 侧 API 脚本（幂等）：`window.MobiApp.issueNewTurn(text)` → postMessage
 * 宿主。targetOrigin 用 iframe 自身的 origin（allow-same-origin 下即 mobi origin，
 * 不放宽到 '*'——即便消息被第三方 frame 截到也只是发给宿主的请求，宿主侧来源校验
 * 才是权威防线，但收紧无成本）。跨域/未就绪静默跳过。
 */
export function injectAppBridgeScript(doc: Document | null | undefined): void {
    try {
        if (!doc?.head || doc.getElementById(APP_BRIDGE_SCRIPT_ID)) return
        const script = doc.createElement('script')
        script.id = APP_BRIDGE_SCRIPT_ID
        script.textContent = `(function () {
  if (window.MobiApp) return;
  window.MobiApp = {
    issueNewTurn: function (text) {
      if (typeof text !== 'string') return;
      parent.postMessage({ type: ${JSON.stringify(APP_BRIDGE_MSG_TYPE)}, action: ${JSON.stringify(APP_BRIDGE_ACTION)}, text: text }, location.origin);
    }
  };
})();`
        doc.head.appendChild(script)
    } catch {
        // contentDocument 不可达（理论不可达：同源沙箱）——不注入
    }
}

/**
 * 限流器工厂（可测：注入时钟）。返回的判定函数通过放行一条、间隔内的后续全拒。
 * 每 frame 组件实例一个限流器——不同 app 的消息互不影响。
 */
export function createAppBridgeRateLimiter(now: () => number = () => Date.now()): () => boolean {
    let lastAt = -Infinity
    return () => {
        const at = now()
        if (at - lastAt < APP_BRIDGE_MIN_INTERVAL_MS) return false
        lastAt = at
        return true
    }
}
