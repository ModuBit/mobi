---
name: tool-chip-align-verify
description: 工具行 FileChip 图标与文件名垂直对齐探针——seed Read 帧、cap 中心计算、DPR 2/3 像素断言与 DB BLOB 坑
metadata:
  type: recipe
  last_verified: 2026-11-17
---

# 工具行 FileChip 图标对齐验证

## 根因基线（2026-11-17 已修）

- `.file-type-icon`（14×14 inline-flex）内 SVG 固定 12px，未设 `align-items/justify-content` 时贴左上，图标墨迹整体比盒中心高 1px
- `.tool-chip-path` 原 `align-items: baseline`：徽章无文字基线（inline-flex 合成基线=底边），视觉比文字 cap 中心再高 0.6px
- 修复后：图标中心 = chip 内容盒中心，与 cap 中心差 **0.38px（阈值 ≤0.5）**；纯 CSS 改动（`base.css`），css 无法 jsdom 断言，必须真机几何探针
- 同修复也覆盖 markdown 文件链接（14px 正文）：旧 -0.92px → 新 +0.08px，file tree / diff tree / inspector tab 同源受益

## seed 一条真实 Read 工具帧（本会话无工具行时）

```bash
python3 -I - <<'PY' > /tmp/msg.json   # 结构照抄已有 assistant output 帧
# {"role":"agent","content":{"type":"output","data":{...assistant message content:[{type:tool_use,name:Read,input:{file_path,offset,limit}}]}}}
PY
SEQ=$(sqlite3 ~/.mobi-e2e/mobi.db "SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE session_id='<sid>';"); NOW=$(...ms)
sqlite3 ... "INSERT INTO messages (id, session_id, content, created_at, seq, local_id, metadata, is_sidechain, category, position_at) VALUES (..., readfile('/tmp/msg.json'), $NOW, $SEQ, NULL, NULL, 0, 'persistent', $NOW);"
```

- **坑：`readfile()` 写入的是 BLOB**，API 读出后 `content: null`（页面不渲染）——必须 `UPDATE messages SET content = CAST(content AS TEXT) ...` 再 reload
- messages 表必须显式给 `position_at`；`seq = max+1`

## 几何断言（真机 evaluate_script）

1. 取 `document.querySelectorAll('.tool-chip-path')` 最后一个，读 `.file-type-icon` 与内部 `svg` rect
2. cap 中心用 canvas 测：`c.font = computed(fontWeight/fontSize/fontFamily)`，`baseline = lineTop + (lineHeight − (fontBoundingBoxAscent+fontBoundingBoxDescent))/2 + fontBoundingBoxAscent`，`capCenter = baseline − measureText('W').actualBoundingBoxAscent/2`
3. 断言 `svg中心 − capCenter` ∈ [−0.5, 0.5]；`svg中心 − chip中心` = 0
4. **DPR 必须两档验**：`emulate({viewport:'1200x1223x2'})` 与移动 `390x844x3,mobile,touch`——DPR 只影响栅格化，不动几何
5. 像素复核：截图后按 chip rect 裁剪，蓝色图标墨迹行中心 vs `W` 首字母亮像素行中心（深色主题文字是亮色，阈值 `(r+g+b)/3>120`；别把 chip 背景算进文字），实测差 0.25px
6. 其它消费方（markdown 链接）无现成实例时，可向页面注入 `.x-markdown` replica（真 CSS/字体环境，about:blank 无效），对比 `align-items:flex-start` 模拟旧版

## 走查

PC + mobile 各截图目检 chip 图标中线与文件名中线；顺带看该行 verb `Read L151–300` 不因 align-items 变化移位。
