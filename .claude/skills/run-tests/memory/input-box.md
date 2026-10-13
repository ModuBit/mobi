---
name: input-box
description: 自定义输入框通用操作规范（登录 token / 聊天框共用）
metadata:
  type: recipe
  last_verified: 2026-10-13
---

# 自定义输入框操作

mobi 的输入框（登录 token、聊天框）多为自定义组件，标准三步走：

## 标准步骤

1. `click` 目标输入框（聚焦）
2. `press_key Control+A`（全选清空已有内容）
3. `type_text` 输入新内容

## 坑

- **不用 `fill`** — 对自定义输入框常超时失败
- **不直接 `type_text` 不全选** — 会追加而非替换，内容重复
- **提交差异** — 聊天框可 `type_text` 带 `submitKey: Enter` 提交；登录框 Enter 无效，见 [[login]]
- **多行文本的 `\n` 会立即触发提交（2026-09-23）** — 聊天 composer 把文本中的换行当 Enter 语义：`type_text` 带 `\n` 的多行探针只有**第一行**被发出（DB 用户消息原文可证），后续行全部丢失，表现为「模型说消息被截断」。**探针必须写成单行**（分号连接步骤），长 prompt 也一样
- **Ctrl+A 对 combobox 型输入框可能不生效**（2026-08-24 踩过：项目 Modal 的 folder 路径 combobox，`press_key Control+A` 后 type 变追加）— 兜底：`evaluate_script` 找到该 input，`focus()` + `setSelectionRange(0, value.length)` 全选后再 `type_text`，即替换成功
- **旧 snapshot 的 uid 点击后 Enter 提交可能静默失效**（2026-10-10 踩过：turn 刚结束后用上一轮 snapshot 的 composer uid click + type_text 带 `submitKey: Enter`，typed 成功但提交未触发——消息没 POST、不落库、composer 已清空）— 兜底：发消息前 `evaluate_script` 里 `document.querySelector('textarea')?.focus()` 再 `type_text`，并**用 DB 落库或 POST 请求确认消息真的发出**，别只看 typed 回执
- **uid 易失时改走原生 setter（2026-10-13 实测最稳）** — 登录页 boot log 动画、会话页流式重渲染都会让 snapshot 的 uid 失效（点了报「no longer exists」，重新 type 又丢）。React 受控输入认 `input` 事件，不必真敲键盘；一次 `evaluate_script` 搞定：

  ```js
  () => {
    const ta = document.querySelector('textarea')            // 登录框是 input
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
      .set.call(ta, '要输入的内容')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    const send = document.querySelector('button[aria-label="发送"]')
    const disabled = send?.disabled                           // 仍是 disabled = 赋值没被 React 收到，别硬点
    if (!disabled) send.click()
    return { disabled }
  }
  ```
  提交按钮同理：登录页按文案找（`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '连接')`）。设完值**先看 `disabled` 再点**，比事后去 DB 找消息快。

