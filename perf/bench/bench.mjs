#!/usr/bin/env bun
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
 * mobi 性能测速台：CDP 驱动无头 Chrome，「打开到能用」p50/p75/p95 + 确定性计数。
 *
 * 口径（权威定义见 perf/BRIEF.md）：
 * - 冷缓存：每次测量全新 browser context
 * - 配对测：--url-b 传入 B 版地址，A、B、A、B 交替
 * - profile：lan（不限速，主口径）/ cpu4（CPU 4 倍限速，慢机档）
 *
 * 用法：
 *   bun perf/bench/bench.mjs --target sessions --url http://localhost:5176 \
 *     --runs 10 --profile lan --out perf/bench/runs/base.json
 *   # 配对测：
 *   bun perf/bench/bench.mjs --target session --url <A> --url-b <B> \
 *     --runs 10 --profile cpu4 --out perf/bench/runs/a.json --out-b perf/bench/runs/b.json
 *
 * 认证：MOBI_BENCH_TOKEN 环境变量优先，缺省读 ~/.mobi/settings.hub.json 的
 * webApiToken。经被测 base 的 /api/auth 换 httpOnly cookie 后注入浏览器。
 *
 * 依赖：bun 原生 WebSocket + 本机 Chrome（CDP），零 npm 依赖。
 */

import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

// ---------- 常量 ----------

const CHROME_CANDIDATES = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
]

const PROFILES = {
    lan: { cpuRate: 1 },
    cpu4: { cpuRate: 4 },
}

const NAVIGATE_TIMEOUT_MS = 60_000
const READY_POLL_MS = 50
/** ready 后再等一会再收终态计数，让缓冲的 observer 事件落盘 */
const SETTLE_MS = 500

/**
 * 核心操作的「能用」判定表达式（权威口径，与 perf/BRIEF.md 同步维护）。
 * 注入为页面初始化脚本，每 16ms 轮询一次；names 是目标会话的候选展示名。
 */
const TARGETS = {
    sessions: {
        path: () => '/sessions',
        readyExpr: names =>
            `() => !location.pathname.startsWith('/login') && document.body !== null && (${names
                .map(n => `document.body.innerText.includes(${JSON.stringify(n)})`)
                .join(' || ')})`,
    },
    session: {
        path: id => `/sessions/${id}`,
        readyExpr: names => `() => {
            if (location.pathname.startsWith('/login')) return false
            const t = document.querySelector('.ant-sender textarea')
            return !!t && t.offsetParent !== null && (${names
                .map(n => `document.body.innerText.includes(${JSON.stringify(n)})`)
                .join(' || ')})
        }`,
    },
    /** 会话内容可见：composer 可输入 + 消息气泡已渲染——消息链路（含首拉）优化的主指标 */
    sessionMessages: {
        path: id => `/sessions/${id}`,
        readyExpr: names => `() => {
            if (location.pathname.startsWith('/login')) return false
            const t = document.querySelector('.ant-sender textarea')
            return !!t && t.offsetParent !== null && document.querySelector('.ant-bubble') !== null && (${names
                .map(n => `document.body.innerText.includes(${JSON.stringify(n)})`)
                .join(' || ')})
        }`,
    },
}

// ---------- CLI ----------

const { values } = parseArgs({
    options: {
        target: { type: 'string' }, // sessions | session
        url: { type: 'string' },
        'url-b': { type: 'string' },
        runs: { type: 'string', default: '10' },
        profile: { type: 'string', default: 'lan' },
        'session-id': { type: 'string' },
        out: { type: 'string' },
        'out-b': { type: 'string' },
        token: { type: 'string' },
        loaf: { type: 'boolean' }, // 单次归因模式：Long Animation Frames 拆解长任务，不出报告
        'cpu-profile': { type: 'boolean' }, // 单次归因模式：CDP CPU Profiler 自耗时拓扑（函数级）
        eval: { type: 'string' }, // 单次验证模式：ready 后在页面里求值并打印结果（如检查高亮 span）
    },
})

if (!values.target || !(values.target in TARGETS)) {
    console.error(`--target 必须是 ${Object.keys(TARGETS).join(' | ')}`)
    process.exit(2)
}
if (!values.url) {
    console.error('--url 必填（被测 base URL，如 http://localhost:5176）')
    process.exit(2)
}
if (values['url-b'] && !values['out-b']) {
    console.error('配对测需要 --out-b 指定 B 版输出文件')
    process.exit(2)
}
const runs = Number(values.runs)
if (!Number.isInteger(runs) || runs < 3) {
    console.error('--runs 必须是不小于 3 的整数（口径要求 ≥10，3 仅为冒烟下限）')
    process.exit(2)
}
if (!(values.profile in PROFILES)) {
    console.error(`--profile 必须是 ${Object.keys(PROFILES).join(' | ')}`)
    process.exit(2)
}

// ---------- 认证 ----------

function resolveToken() {
    if (values.token) return values.token
    if (process.env.MOBI_BENCH_TOKEN) return process.env.MOBI_BENCH_TOKEN
    const settingsPath = path.join(os.homedir(), '.mobi', 'settings.hub.json')
    if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
        if (settings.webApiToken) return settings.webApiToken
    }
    console.error('找不到 webApiToken：设 MOBI_BENCH_TOKEN 或检查 ~/.mobi/settings.hub.json')
    process.exit(2)
}

/** 经被测 base 登录，返回 { cookie, jwt }（cookie 随同源请求自动携带；jwt 供 API 调用） */
async function login(base, token) {
    const res = await fetch(`${base}/api/auth`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessToken: token }),
    })
    if (!res.ok) throw new Error(`登录失败 ${res.status}（base=${base}）`)
    const setCookie = res.headers.getSetCookie?.()[0]
    if (!setCookie) throw new Error('登录响应没有 Set-Cookie')
    const [pair] = setCookie.split(';')
    const idx = pair.indexOf('=')
    const { token: jwt } = await res.json()
    return { cookie: { name: pair.slice(0, idx), value: pair.slice(idx + 1) }, jwt }
}

async function fetchSessions(base, token) {
    const res = await fetch(`${base}/api/sessions`, {
        headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`拉会话列表失败 ${res.status}`)
    const data = await res.json()
    return data.sessions ?? []
}

/** 会话在页面文本中可能出现的候选名：metadata.name / 路径末段 / id */
function sessionDisplayNames(session) {
    const names = new Set()
    if (session.metadata?.name) names.add(session.metadata.name)
    if (session.metadata?.path) names.add(path.basename(session.metadata.path))
    names.add(session.id)
    return [...names]
}

// ---------- CDP 客户端 ----------

class Cdp {
    constructor(ws) {
        this.ws = ws
        this.nextId = 1
        this.pending = new Map()
        this.listeners = []
        ws.addEventListener('message', ev => {
            if (typeof ev.data !== 'string') return
            const msg = JSON.parse(ev.data)
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id)
                this.pending.delete(msg.id)
                if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`))
                else resolve(msg.result)
            } else if (msg.method) {
                for (const l of this.listeners) l(msg)
            }
        })
    }

    static connect(port, browserPath) {
        return new Promise((resolve, reject) => {
            // 用 DevToolsActivePort 第二行的精确路径——不带 uuid 的 /devtools/browser
            // 是 302 跳转，Bun 的 WebSocket 不跟重定向
            const ws = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`)
            ws.addEventListener('open', () => resolve(new Cdp(ws)))
            ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')))
        })
    }

    send(method, params = {}, sessionId) {
        const id = this.nextId++
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject })
            const payload = { id, method, params }
            if (sessionId) payload.sessionId = sessionId
            this.ws.send(JSON.stringify(payload))
        })
    }

    waitEvent(method, sessionId, timeoutMs) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`等待事件 ${method} 超时`)), timeoutMs)
            const listener = msg => {
                if (msg.method !== method) return
                if (sessionId && msg.sessionId !== sessionId) return
                clearTimeout(timer)
                this.listeners = this.listeners.filter(l => l !== listener)
                resolve(msg.params)
            }
            this.listeners.push(listener)
        })
    }

    close() {
        this.ws.close()
    }
}

// ---------- 页面初始化脚本：判定轮询 + 确定性计数 ----------

function buildInitScript(readyExpr) {
    return `(() => {
  const counters = { longTasks: 0, longTaskMs: 0, qsa: 0, styleWrites: 0, layoutShifts: 0, layoutShiftScore: 0 }
  window.__counters = counters
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) { counters.longTasks++; counters.longTaskMs += e.duration } })
      .observe({ type: 'longtask', buffered: true })
  } catch (e) {}
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) { counters.layoutShifts++; counters.layoutShiftScore += e.value } })
      .observe({ type: 'layout-shift', buffered: true })
  } catch (e) {}
  const patchQsa = proto => {
    const orig = proto.querySelectorAll
    if (orig) proto.querySelectorAll = function (...a) { counters.qsa++; return orig.apply(this, a) }
  }
  patchQsa(Element.prototype); patchQsa(Document.prototype); patchQsa(DocumentFragment.prototype)
  const origSetProperty = CSSStyleDeclaration.prototype.setProperty
  CSSStyleDeclaration.prototype.setProperty = function (...a) { counters.styleWrites++; return origSetProperty.apply(this, a) }
  let lcpValue = 0
  try {
    new PerformanceObserver(l => { const es = l.getEntries(); if (es.length) lcpValue = es[es.length - 1].startTime })
      .observe({ type: 'largest-contentful-paint', buffered: true })
  } catch (e) {}
  const ready = (${readyExpr})
  window.__readyAt = 0
  window.__countersAtReady = null
  // 每 16ms 轮询判定表达式；ready 翻真时刻的计数快照即「到达能用为止」的确定性计数
  setInterval(() => {
    if (window.__readyAt) return
    let ok = false
    try { ok = ready() } catch (e) { ok = false }
    if (ok) {
      window.__readyAt = performance.now()
      window.__countersAtReady = { ...counters, lcp: lcpValue }
    }
  }, 16)
})()`
}

// ---------- 单次测量 ----------

/** 开一个全新 browser context（冷缓存）+ 注入 cookie 与初始化脚本，导航到目标页并等到「能用」 */
async function openPage(cdp, { base, cookie, targetPath, readyExpr, cpuRate, xhrStack }, { profiler = false } = {}) {
    const ctx = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true })
    const { targetId } = await cdp.send('Target.createTarget', {
        url: 'about:blank',
        browserContextId: ctx.browserContextId,
    })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Network.enable', {}, sessionId)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate }, sessionId)
    if (profiler) {
        // 采样间隔 100µs：函数级归因需要亚毫秒分辨率（默认 1ms 太粗）
        await cdp.send('Profiler.enable', {}, sessionId)
        await cdp.send('Profiler.setSamplingInterval', { interval: 100 }, sessionId)
        // 导航前开采，覆盖模块求值全程
        await cdp.send('Profiler.start', {}, sessionId)
    }
    // 冷缓存由全新 context 天然保证；cookie 需在导航前注入，否则被重定向到 /login
    await cdp.send('Network.setCookie', { name: cookie.name, value: cookie.value, url: base, httpOnly: true }, sessionId)
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: buildInitScript(readyExpr) }, sessionId)
    if (xhrStack) {
        // console 转发需要 Runtime domain（归因模式抓 [perf-debug] 日志用）
        await cdp.send('Runtime.enable', {}, sessionId)
        // 归因专用：XHR open 时抓同步调用栈（CDP initiator 栈只留 axios 一帧，不够定位调用方）。
        // 会拖慢请求路径，仅归因模式用，正式测量不开
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
            source: `(() => {
                window.__apiCalls = []
                Error.stackTraceLimit = 50
                const origOpen = XMLHttpRequest.prototype.open
                XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                    if (String(url).includes('/api/')) {
                        const stack = (new Error().stack ?? '').split('\\n').slice(2, 26).map(l => l.trim())
                        window.__apiCalls.push({ method, url: String(url), at: Math.round(performance.now()), stack })
                    }
                    return origOpen.call(this, method, url, ...rest)
                }
            })()`,
        }, sessionId)
    }

    const t0 = Date.now()
    await cdp.send('Page.navigate', { url: base + targetPath }, sessionId)
    return { ctx, targetId, sessionId, t0 }
}

/** 轮询直到「能用」判定翻真 */
async function waitReady(cdp, sessionId, t0) {
    for (;;) {
        if (Date.now() - t0 > NAVIGATE_TIMEOUT_MS) throw new Error('60s 内未到达「能用」')
        await new Promise(r => setTimeout(r, READY_POLL_MS))
        const r = await cdp.send(
            'Runtime.evaluate',
            { expression: 'window.__readyAt || 0', returnByValue: true },
            sessionId,
        )
        if ((r.result?.value ?? 0) > 0) return
    }
}

async function closePage(cdp, { ctx, targetId }) {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {})
    await cdp.send('Target.disposeBrowserContext', { browserContextId: ctx.browserContextId }).catch(() => {})
}

async function runOnce(cdp, { base, cookie, targetPath, readyExpr, cpuRate }) {
    const page = await openPage(cdp, { base, cookie, targetPath, readyExpr, cpuRate })
    const { sessionId, t0 } = page
    try {
        await waitReady(cdp, sessionId, t0)
        await new Promise(r => setTimeout(r, SETTLE_MS))

        const collected = await cdp.send(
            'Runtime.evaluate',
            {
                returnByValue: true,
                expression: `JSON.stringify((() => {
                    const nav = performance.getEntriesByType('navigation')[0]
                    const rs = performance.getEntriesByType('resource')
                    return {
                        readyAt: window.__readyAt,
                        countersAtReady: window.__countersAtReady,
                        countersFinal: window.__counters,
                        lcpFinal: window.__lcpValue ?? 0,
                        nav: nav ? { transferSize: nav.transferSize, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd } : null,
                        resources: {
                            count: rs.length,
                            transferBytes: rs.reduce((s, r) => s + (r.transferSize || 0), 0),
                            decodedBytes: rs.reduce((s, r) => s + (r.decodedBodySize || 0), 0),
                        },
                        domNodes: document.getElementsByTagName('*').length,
                        url: location.href,
                    }
                })())`,
            },
            sessionId,
        )
        const data = JSON.parse(collected.result.value)
        if (data.url.includes('/login')) throw new Error('被重定向到 /login——cookie 注入失效')
        return data
    } finally {
        await closePage(cdp, page)
    }
}

// ---------- 统计 ----------

function percentile(sorted, p) {
    if (sorted.length === 0) return 0
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    return sorted[Math.max(0, idx)]
}

function summarize(runList) {
    const readyTimes = runList.map(r => r.readyAt).sort((a, b) => a - b)
    return {
        readyP50: percentile(readyTimes, 50),
        readyP75: percentile(readyTimes, 75),
        readyP95: percentile(readyTimes, 95),
    }
}

function report(name, runList) {
    const s = summarize(runList)
    console.log(`\n[${name}] n=${runList.length} 「能用」p50=${s.readyP50.toFixed(0)}ms p75=${s.readyP75.toFixed(0)}ms p95=${s.readyP95.toFixed(0)}ms`)
    const lt = runList.map(r => r.countersAtReady?.longTaskMs ?? 0).sort((a, b) => a - b)
    console.log(`  ready 前长任务总时长 p75=${percentile(lt, 75).toFixed(0)}ms  qsa p75=${percentile(runList.map(r => r.countersAtReady?.qsa ?? 0).sort((a, b) => a - b), 75)}  styleWrites p75=${percentile(runList.map(r => r.countersAtReady?.styleWrites ?? 0).sort((a, b) => a - b), 75)}  CLS p75=${percentile(runList.map(r => r.countersAtReady?.layoutShiftScore ?? 0).sort((a, b) => a - b), 75).toFixed(4)}`)
    return s
}

// ---------- 长任务归因（Long Animation Frames） ----------

/** ready 后多等一会，把 ready 边缘上尾随的长帧也收进来 */
const LOAF_SETTLE_MS = 1500

async function runLoafAttribution(cdp, runOpts) {
    // 顺带记录 API 请求（看 messages 接口是否重复拉取/重试）+ 发起方调用栈
    const apiCalls = []
    const isApi = url => url.includes('/api/')
    const netListener = msg => {
        if (msg.method === 'Network.requestWillBeSent' && isApi(msg.params.request.url)) {
            // initiator.stack 是链式结构：callFrames + parent 逐层嵌套，要沿 parent 走到底
            const frames = []
            for (let s = msg.params.initiator?.stack; s && frames.length < 8; s = s.parent) {
                for (const f of s.callFrames) {
                    if (frames.length >= 8) break
                    frames.push(`${(f.url || '').split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}${f.functionName ? ' ' + f.functionName : ''}`)
                }
            }
            apiCalls.push({ url: msg.params.request.url.replace(runOpts.base, ''), stack: frames })
        } else if (msg.method === 'Network.responseReceived' && isApi(msg.params.response.url)) {
            const entry = apiCalls.findLast(c => c.url === msg.params.response.url.replace(runOpts.base, '') && c.status === undefined)
            if (entry) entry.status = msg.params.response.status
        }
    }
    cdp.listeners.push(netListener)
    const page = await openPage(cdp, runOpts)
    try {
        // 抓页面 console（配合源码内 [perf-debug] 类诊断日志使用，源侧无日志时输出为空）
        const consoleLines = []
        const consoleListener = msg => {
            if (msg.method === 'Runtime.consoleAPICalled' && msg.sessionId === page.sessionId) {
                const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ')
                if (text.includes('perf-debug')) consoleLines.push(`@${Math.round(msg.params.timestamp % 1e6)} ${text}`)
            }
        }
        cdp.listeners.push(consoleListener)
        await waitReady(cdp, page.sessionId, page.t0)
        await new Promise(r => setTimeout(r, LOAF_SETTLE_MS))
        const res = await cdp.send(
            'Runtime.evaluate',
            {
                returnByValue: true,
                expression: `JSON.stringify((() => {
                    const loaf = performance.getEntriesByType('long-animation-frame').map(e => ({
                        start: Math.round(e.startTime),
                        dur: Math.round(e.duration),
                        blocking: Math.round(e.blockingDuration ?? 0),
                        styleLayout: Math.round(e.forcedStyleAndLayoutDuration ?? 0),
                        scripts: (e.scripts ?? []).map(s => ({
                            dur: Math.round(s.duration),
                            url: s.sourceURL,
                            fn: s.functionName || '',
                            invoker: s.invokerType ? s.invokerType + ':' + (s.invoker ?? '') : '',
                        })),
                    }))
                    const lt = performance.getEntriesByType('longtask').map(e => ({ start: Math.round(e.startTime), dur: Math.round(e.duration) }))
                    return { readyAt: Math.round(window.__readyAt), loaf, longtasks: lt, apiCalls: window.__apiCalls ?? [] }
                })())`,
            },
            page.sessionId,
        )
        const data = JSON.parse(res.result.value)

        console.log(`readyAt=${data.readyAt}ms；longtask ${data.longtasks.length} 个：`)
        for (const t of data.longtasks) console.log(`  @${t.start}ms ${t.dur}ms`)
        console.log(`\n===== 页面内 XHR 调用栈（/messages）=====`)
        for (const c of data.apiCalls ?? []) {
            if (!c.url.includes('/messages')) continue
            console.log(`  @${c.at}ms  ${c.method} ${c.url.replace(runOpts.base, '')}`)
            for (const f of c.stack) console.log(`      ${f}`)
        }
        console.log('\n===== [perf-debug] console =====')
        for (const l of consoleLines) console.log(`  ${l}`)
        console.log(`\nLong Animation Frames（>=50ms 的主线程长帧，含归因脚本）：`)

        // 按 URL 聚合脚本耗时，给出「谁贡献了长任务」的总账
        const byUrl = new Map()
        for (const frame of data.loaf) {
            console.log(`\n@${frame.start}ms 帧长 ${frame.dur}ms（阻塞 ${frame.blocking}ms，强制样式/布局 ${frame.styleLayout}ms）`)
            for (const s of [...frame.scripts].sort((a, b) => b.dur - a.dur).slice(0, 6)) {
                const base = s.url ? s.url.split('/').pop() : '(inline)'
                console.log(`    ${String(s.dur).padStart(5)}ms  ${base}${s.fn ? ` :: ${s.fn}` : ''}${s.invoker ? ` [${s.invoker}]` : ''}`)
            }
            for (const s of frame.scripts) {
                const key = s.url ? s.url.split('/').pop() : '(inline)'
                byUrl.set(key, (byUrl.get(key) ?? 0) + s.dur)
            }
        }
        console.log('\n===== API 请求 =====')
        for (const c of apiCalls) {
            console.log(`  ${c.status ?? '?'}  ${c.url}`)
            for (const f of c.stack ?? []) console.log(`        at ${f}`)
        }
        console.log('\n===== 按脚本聚合（top 15）=====')
        for (const [url, dur] of [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
            console.log(`${String(dur).padStart(6)}ms  ${url}`)
        }
    } finally {
        cdp.listeners = cdp.listeners.filter(l => l !== consoleListener && l !== netListener)
        await closePage(cdp, page)
    }
}

// ---------- CPU Profiler 归因 ----------

/** ready 后再采样一会，覆盖 ready 边缘的收尾工作 */
const PROFILE_TAIL_MS = 1500

async function runCpuProfile(cdp, runOpts) {
    const page = await openPage(cdp, runOpts, { profiler: true })
    try {
        await waitReady(cdp, page.sessionId, page.t0)
        await new Promise(r => setTimeout(r, PROFILE_TAIL_MS))
        const { profile } = await cdp.send('Profiler.stop', {}, page.sessionId)
        const nodes = new Map(profile.nodes.map(n => [n.id, n]))
        const interval = (profile.timeDeltas?.[0] ?? 1000)
        // 自耗时 = 该节点被采样到的次数 × 采样间隔；按 url:line:col 聚合
        const selfByPos = new Map()
        for (const n of profile.nodes) {
            if (!n.hitCount) continue
            const cf = n.callFrame
            const key = `${(cf.url || '(vm)').split('/').pop()}:${cf.lineNumber + 1}:${cf.columnNumber + 1}${cf.functionName ? ' ' + cf.functionName : ''}`
            selfByPos.set(key, (selfByPos.get(key) ?? 0) + n.hitCount * interval)
        }
        console.log(`总采样 ${((profile.endTime - profile.startTime) / 1000).toFixed(0)}ms；自耗时 top 25：`)
        for (const [pos, us] of [...selfByPos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
            console.log(`${String(Math.round(us / 1000)).padStart(6)}ms  ${pos}`)
        }
        // 补充：总耗时 top 的调用路径（找大帧的「谁调用谁」）
        const totalByNode = new Map()
        const total = id => {
            if (totalByNode.has(id)) return totalByNode.get(id)
            totalByNode.set(id, 0) // 防环
            const n = nodes.get(id)
            const sum = (n.hitCount ?? 0) * interval + (n.children ?? []).reduce((s, c) => s + total(c), 0)
            totalByNode.set(id, sum)
            return sum
        }
        const root = profile.nodes.find(n => !n.callFrame.url && !n.parentId) ?? profile.nodes[0]
        console.log('\n调用树 top（总耗时 > 150ms 的路径，root 起）：')
        const walk = (id, depth, parentTotal) => {
            if (depth > 8) return
            const n = nodes.get(id)
            if (!n) return
            const t = total(id)
            const cf = n.callFrame
            if (t > parentTotal * 0.05 && t > 150_000) {
                console.log(`${'  '.repeat(depth)}${Math.round(t / 1000)}ms  ${(cf.url || '').split('/').pop()}:${cf.lineNumber + 1}${cf.functionName ? ' ' + cf.functionName : ''}`)
                for (const c of (n.children ?? []).map(total).sort((a, b) => b - a).slice(0, 2)) {
                    // 找到该总耗时对应的 child id
                    const cid = (n.children ?? []).find(x => total(x) === c)
                    walk(cid, depth + 1, t)
                }
            }
        }
        walk(root.id, 0, Infinity)
    } finally {
        await closePage(cdp, page)
    }
}



// ---------- 主流程 ----------

async function main() {
    const token = resolveToken()
    const bases = [values.url, values['url-b']].filter(Boolean)
    const profile = PROFILES[values.profile]

    // 认证与目标会话准备（读操作，对 hub 无副作用）
    const cookies = new Map()
    const jwts = new Map()
    for (const base of bases) {
        const { cookie, jwt } = await login(base, token)
        cookies.set(base, cookie)
        jwts.set(base, jwt)
    }
    const firstSession = (await fetchSessions(bases[0], jwts.get(bases[0])))[0]
    if (!firstSession) {
        console.error('hub 没有任何会话，无法定义「打开会话」的判定')
        if (values.target === 'session') process.exit(2)
    }
    const names = firstSession ? sessionDisplayNames(firstSession) : []
    const sessionId = values['session-id'] ?? firstSession?.id
    if (values.target === 'session' && !sessionId) {
        console.error('没有可用的 sessionId')
        process.exit(2)
    }
    const target = TARGETS[values.target]
    const targetPath = target.path(sessionId)
    const readyExpr = target.readyExpr(names)

    // 启动无头 Chrome
    const chromeBin = CHROME_CANDIDATES.find(existsSync)
    if (!chromeBin) {
        console.error('找不到 Chrome')
        process.exit(2)
    }
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'mobi-bench-chrome-'))
    const chrome = spawn(
        chromeBin,
        [
            '--headless=new',
            '--remote-debugging-port=0',
            `--user-data-dir=${userDataDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            '--window-size=1440,900',
            'about:blank',
        ],
        { stdio: 'ignore' },
    )
    try {
        const portFile = path.join(userDataDir, 'DevToolsActivePort')
        let port = null
        let browserPath = null
        for (let i = 0; i < 100 && !port; i++) {
            await new Promise(r => setTimeout(r, 100))
            if (existsSync(portFile)) {
                const [p, bp] = readFileSync(portFile, 'utf8').trim().split('\n')
                port = Number(p)
                browserPath = bp
            }
        }
        if (!port) throw new Error('Chrome 启动超时（未产出 DevToolsActivePort）')
        const cdp = await Cdp.connect(port, browserPath)

        // 归因模式：单次 run，LoAF 拆解长任务后直接退出
        if (values.loaf) {
            await runLoafAttribution(cdp, { base: bases[0], cookie: cookies.get(bases[0]), targetPath, readyExpr, cpuRate: profile.cpuRate, xhrStack: true })
            return
        }

        // 归因模式：单次 run，CPU Profiler 自耗时拓扑
        if (values['cpu-profile']) {
            await runCpuProfile(cdp, { base: bases[0], cookie: cookies.get(bases[0]), targetPath, readyExpr, cpuRate: profile.cpuRate })
            return
        }

        // 验证模式：单次 run，ready 后求值 --eval 表达式并打印（无 --eval 时输出 readyAt）
        if (values.eval !== undefined || values.eval === '') {
            const page = await openPage(cdp, { base: bases[0], cookie: cookies.get(bases[0]), targetPath, readyExpr, cpuRate: profile.cpuRate })
            try {
                await waitReady(cdp, page.sessionId, page.t0)
                const expr = values.eval || 'window.__readyAt'
                const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, page.sessionId)
                console.log(JSON.stringify(r.result?.value ?? r.result))
            } finally {
                await closePage(cdp, page)
            }
            return
        }

        // 配对交替 A,B,A,B…；单 A 则顺序跑
        const aRuns = []
        const bRuns = []
        const pairCount = values['url-b'] ? runs : 0
        const soloCount = values['url-b'] ? 0 : runs
        for (let i = 0; i < Math.max(pairCount, soloCount); i++) {
            if (values['url-b']) {
                aRuns.push(await runOnce(cdp, { base: bases[0], cookie: cookies.get(bases[0]), targetPath, readyExpr, cpuRate: profile.cpuRate }))
                bRuns.push(await runOnce(cdp, { base: bases[1], cookie: cookies.get(bases[1]), targetPath, readyExpr, cpuRate: profile.cpuRate }))
            } else {
                aRuns.push(await runOnce(cdp, { base: bases[0], cookie: cookies.get(bases[0]), targetPath, readyExpr, cpuRate: profile.cpuRate }))
            }
            process.stdout.write(`\r${i + 1}/${Math.max(pairCount, soloCount)} 轮完成`)
        }
        process.stdout.write('\n')

        const meta = {
            target: values.target,
            targetPath,
            profile: values.profile,
            runs,
            date: new Date().toISOString(),
            gitSha: (() => {
                try {
                    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
                } catch {
                    return 'unknown'
                }
            })(),
        }

        const aSummary = report(`A ${bases[0]}`, aRuns)
        writeOut(values.out, { ...meta, base: bases[0], summary: aSummary, runs: aRuns })
        if (values['url-b']) {
            const bSummary = report(`B ${bases[1]}`, bRuns)
            writeOut(values['out-b'], { ...meta, base: bases[1], summary: bSummary, runs: bRuns })
            const delta = ((aSummary.readyP75 - bSummary.readyP75) / aSummary.readyP75) * 100
            console.log(`\n配对对比：B 相对 A 的 p75 ${delta >= 0 ? '快' : '慢'} ${Math.abs(delta).toFixed(1)}%`)
        }
        cdp.close()
    } finally {
        // 按 PID 精确清理，禁止 pkill 模式匹配（项目纪律）
        chrome.kill('SIGTERM')
        rmSync(userDataDir, { recursive: true, force: true })
    }
}

function writeOut(file, data) {
    if (!file) return
    mkdirSync(path.dirname(file), { recursive: true })
    Bun.write(file, JSON.stringify(data, null, 1))
    console.log(`已写入 ${file}`)
}

await main()
