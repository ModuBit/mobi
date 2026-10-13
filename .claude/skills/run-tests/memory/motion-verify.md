---
name: motion-verify
description: CDP 逐帧采样验证动效 + prefers-reduced-motion 门控验证——rAF 探针记录 computed style 时间序列，暴露 jsdom 测不出的 CSS transition 问题
metadata:
  type: recipe
  last_verified: 2026-10-13
---

# CDP 逐帧采样验证动效

jsdom 不执行 CSS transition / 合成动画——「组件逻辑对但 CSS 未生效」类问题
（如选择器层级错配导致规则从未命中）单测全绿也照样翻车，须真实浏览器采样。

## 步骤（chrome-devtools MCP）

1. `emulate` 移动 viewport（`375x812x2,mobile,touch`）
2. `evaluate_script` 开 drawer 等动画落定（sleep ~700ms）
3. 注入 rAF 探针：每帧 push `{t, 关键元素 computed style}`，采 2s；
   同一脚本里 `setTimeout(() => mask.click(), 500)` 触发关闭
4. 再 `evaluate_script`（sleep > 采样时长）读 `window.__samples`，
   只返回「状态变化帧」（相邻帧 key 去重）防输出爆炸
5. 断言：不该动的元素（如被 CSS 锁的 wrapper）transform/opacity 全程恒定；
   该同步的两条曲线（mask opacity vs sheet translateY）逐帧对齐

## 采过的坑

- antd v6 rootClassName 挂在 `.ant-drawer` 元素本身（wrapper 是直接子元素，
  两层）——按「root > .ant-drawer > wrapper」三层写的 CSS 锁从未命中，
  `.matches(选择器)` 一发命中真相；leave 期间 wrapper opacity 渐变到 0.7
  = 半透明残影
- 采样输出必须去重/抽样，151 帧全量返回会撑爆结果
- 切主题验证：直接写 `localStorage['mobi-ui']` 的 state.theme 后 reload，
  比 UI 点主题切换项可靠
- **antd v6 panel 挂载/可测时序晚于调用方 useLayoutEffect**（fdbd9983 踩坑）：
  首开时 panel 尚未挂载（children 的 ref 为 null），重开时 panel 处于 leave 后
  hidden 态（display:none 子树，offsetHeight 恒 0）——任何「commit 时刻测 panel
  高度」的 effect 两条路径都拿到 0。动画起点这类需求用 `window.innerHeight`
  等视口常量解耦，不要读 offsetHeight。诊断法：临时在 effect 里
  `console.warn({open, mounted, hasRef, h})`，evaluate 里 hook console.warn
  收集（CDP 的 list_console_messages 有时序坑），配合 React 组件栈定位实例
  （`querySelector('[data-testid]')` 在多 drawer 实例时会抓错元素！）
- **布局收缩链验证**：往内容区塞 `style.height='2000px'` 的探针 div 再量各层
  offsetH/clientH/scrollH，断言「该钳的钳住、该滚的 scrollH > clientH」——
  jsdom 不做真实布局（offsetHeight 恒 0），此类问题只能真机/CDP 采样

## prefers-reduced-motion 门控验证（2026-10-13）

`@media (prefers-reduced-motion: reduce) { transition: none }` 这类门控，单测只能证「不抛错」，
真机要证「过渡真的被关掉」而且**只在 reduce 档被关掉**。两条路，都用独立 Chrome：

**A. 进程级 flag（等价于系统「减弱动态效果」，证据最硬）**

```bash
# chrome-devtools MCP 的 Chrome 走 --remote-debugging-pipe，没有 TCP 口，发不了自定义 CDP 命令
# → 自己起一个带调试端口的实例（headless 也行）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9411 --user-data-dir=/tmp/e2everify/chrome-rm \
  --force-prefers-reduced-motion --no-first-run --no-default-browser-check about:blank &
# 端口就绪要几秒（早查会 connection refused，别误判启动失败）；用 /json/list 挑 type=page 的 target
```

**B. CDP 模拟（DevTools 的 Emulate CSS media feature，同一条 Blink 评估路径）**

```
Emulation.setEmulatedMedia { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }
Emulation.setEmulatedMedia { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }
```

**驱动方式**：bun 自带 WebSocket，四十行就能发 CDP（`Runtime.evaluate` + `awaitPromise` +
`returnByValue`），比拉 puppeteer 轻。注意 `Runtime.evaluate` 的 `expression` 要传**表达式**：
把 `async () => {…}` 整段包在 `(…)()` 里时，**函数体末尾别留 `;`**（`(fn;)()` 直接 SyntaxError）。
页面准备用一个自循环的 probe 收敛（找登录框/找「打开文件」按钮/等 `[role="tab"]`），
比固定 sleep 稳。

**断言（两档对照才叫验证）**：
- reduce 档：`matchMedia('(prefers-reduced-motion: reduce)').matches === true`，
  元素 `getComputedStyle(el).transitionProperty === 'none'`、`transitionDuration === '0s'`
- no-preference 档（同一页面切档，其它条件不变）：过渡**回来**（如 `background-color, color 0.1s, 0.1s`）
- 只测 reduce 档「没抛错/看着不动」不算验证——必须证明差异来自这个媒体特性

不推荐改 macOS 系统「减弱动态效果」（`defaults write com.apple.universalaccess reduceMotion`）：
改的是用户机器的真实设置，噪声大且要还原，A/B 两档都做还得多改一次。

