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
 * viz 档运行时脚本（票 02）：tooltip / tabs 键盘导航 / variant carousel / lucide 图标。
 *
 * 随组装内联在 fragment 之后执行——运行时全部走**事件委托**（document 级监听），
 * 不要求 fragment 的脚本先于/后于本脚本，动态增删元素零再接线。
 *
 * 外部依赖（MIT，走 PREVIEW_CSP 已允许的 https CDN）：
 * - floating-ui（tooltip 定位 flip/shift）；未加载时降级为固定上方定位
 * - lucide（`<i data-lucide>` 占位替换）；未加载时占位保持原样
 *
 * License 合规：交互模式借鉴 codex visualize 的行为约定（hover 延迟/触摸 pin/
 * 键盘导航语义），实现全部自研。
 */

/** floating-ui UMD 脚本标签（core + dom，版本钉死；PREVIEW_CSP script-src https: 放行） */
export const VIZ_FLOATING_UI_SCRIPTS = [
    '<script src="https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js" defer></script>',
    '<script src="https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js" defer></script>',
].join('\n')

/** lucide UMD（async：首渲染不等图标库；版本与 web 生态实测可用的 UMD 产物对齐） */
export const VIZ_LUCIDE_SCRIPT = '<script async src="https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js"></script>'

export const VIZ_RUNTIME_JS = `
(() => {
  const TOOLTIP_DELAY_MS = 500;

  // ── tooltip：委托监听 [data-tooltip] ─────────────────────────────────────
  // 行为约定：hover 延迟开（连续移动到相邻触发器免延迟）、focus-visible 立即开、
  // 触摸点击 pin 住（再点空白/别的触发器关）、Escape 关。定位优先 floating-ui
  // （flip+shift），库不可用时降级为「上方 + 视口水平钳制」。
  (() => {
    const findTrigger = (event) => {
      for (const node of event.composedPath()) {
        if (node?.nodeType === 1 && typeof node.closest === 'function') {
          const trigger = node.closest('[data-tooltip]');
          if (trigger) return trigger;
        }
      }
      return null;
    };
    let tooltip = null;
    let activeTrigger = null;
    let pinned = false;
    let openTimer = null;
    let cleanupPosition = null;
    const ensureTooltip = () => {
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.id = 'mobi-viz-tooltip';
      }
      return tooltip;
    };
    const position = (trigger) => {
      const floating = ensureTooltip();
      const fui = window.FloatingUIDOM;
      if (fui?.computePosition && fui?.autoUpdate) {
        cleanupPosition?.();
        cleanupPosition = fui.autoUpdate(trigger, floating, () => {
          fui.computePosition(trigger, floating, {
            placement: trigger.getAttribute('data-tooltip-placement') || 'top',
            middleware: [fui.offset(5), fui.flip({ padding: 5 }), fui.shift({ padding: 5 })],
            strategy: 'fixed',
          }).then(({ x, y }) => {
            floating.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
          }).catch(() => {});
        });
      } else {
        const rect = trigger.getBoundingClientRect();
        const width = floating.offsetWidth;
        floating.style.transform =
          'translate(' + Math.max(6, Math.min(window.innerWidth - width - 6, rect.left + rect.width / 2 - width / 2)) + 'px,' +
          Math.max(6, rect.top - floating.offsetHeight - 6) + 'px)';
      }
    };
    const open = (trigger) => {
      const content = (trigger.getAttribute('data-tooltip') || '').trim();
      if (!content || trigger === activeTrigger) return;
      close();
      const floating = ensureTooltip();
      floating.textContent = content;
      document.body.appendChild(floating);
      activeTrigger = trigger;
      trigger.setAttribute('aria-describedby', 'mobi-viz-tooltip');
      position(trigger);
    };
    const close = () => {
      window.clearTimeout(openTimer);
      openTimer = null;
      cleanupPosition?.();
      cleanupPosition = null;
      if (!activeTrigger) return;
      activeTrigger.removeAttribute('aria-describedby');
      activeTrigger = null;
      pinned = false;
      tooltip?.remove();
    };
    document.addEventListener('pointerover', (event) => {
      if (event.pointerType === 'touch') return;
      const trigger = findTrigger(event);
      if (!trigger || trigger === activeTrigger) return;
      window.clearTimeout(openTimer);
      openTimer = window.setTimeout(() => open(trigger), activeTrigger ? 0 : TOOLTIP_DELAY_MS);
    });
    document.addEventListener('pointerout', (event) => {
      if (pinned || event.pointerType === 'touch') return;
      const trigger = findTrigger(event);
      if (trigger && (trigger === activeTrigger)) close();
    });
    document.addEventListener('click', (event) => {
      const trigger = findTrigger(event);
      if (trigger) {
        if (pinned && trigger === activeTrigger) { close(); return; }
        open(trigger);
        pinned = true;
      } else if (pinned) {
        close();
      }
    });
    document.addEventListener('focusin', (event) => {
      const trigger = event.target?.closest?.('[data-tooltip]');
      if (trigger?.matches(':focus-visible')) open(trigger);
    });
    document.addEventListener('focusout', () => { if (!pinned) close(); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && activeTrigger) close();
    });
    window.addEventListener('pagehide', close, { once: true });
  })();

  // ── tabs：.nav[role="tablist"] 的键盘导航 + aria 同步 ──────────────────
  // 约定：fragment 写好 aria-controls/aria-selected/hidden，行为由这里接管——
  // 模型不写 tabs JS。
  (() => {
    const TAB = '.nav[role="tablist"] [role="tab"]';
    const select = (selected) => {
      const panelId = selected.getAttribute('aria-controls');
      for (const tab of selected.closest('[role="tablist"]').querySelectorAll('[role="tab"]')) {
        const active = tab === selected;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
        const panel = tab.getAttribute('aria-controls') ? document.getElementById(tab.getAttribute('aria-controls')) : null;
        if (panel) panel.hidden = tab.getAttribute('aria-controls') !== panelId;
      }
    };
    for (const list of document.querySelectorAll('.nav[role="tablist"]')) {
      const initial = list.querySelector('[role="tab"][aria-selected="true"]') || list.querySelector('[role="tab"].active') || list.querySelector('[role="tab"]');
      if (initial) select(initial);
    }
    document.addEventListener('click', (event) => {
      const tab = event.target?.closest?.(TAB);
      if (tab && !tab.disabled && tab.getAttribute('aria-disabled') !== 'true') select(tab);
    });
    document.addEventListener('keydown', (event) => {
      const tab = event.target?.closest?.(TAB);
      if (!tab) return;
      const tabs = Array.from(tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]'))
        .filter((t) => !t.disabled && t.getAttribute('aria-disabled') !== 'true');
      const index = tabs.indexOf(tab);
      let next = -1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next < 0) return;
      event.preventDefault();
      tabs[next].focus();
      select(tabs[next]);
    });
  })();

  // ── variant carousel：.viz-carousel > [data-variant] ────────────────────
  // 约定：fragment 写 variant 分节（首个可见其余 hidden、各带 data-variant 名），
  // 导航控件由这里注入。切换只翻 hidden，不替换 DOM——各 variant 内部状态与
  // 脚本引用在切换后存活。
  (() => {
    for (const root of document.querySelectorAll('.viz-carousel')) {
      const panels = Array.from(root.querySelectorAll(':scope > [data-variant]'));
      if (panels.length < 2) continue;
      root.setAttribute('role', 'group');
      const controls = document.createElement('div');
      controls.className = 'viz-carousel-controls';
      controls.innerHTML =
        '<button type="button" class="viz-carousel-prev" aria-label="' + (root.dataset.previousLabel || 'Previous variant') + '">&#x2039;</button>' +
        '<span class="viz-carousel-count tabular-nums"></span>' +
        '<button type="button" class="viz-carousel-next" aria-label="' + (root.dataset.nextLabel || 'Next variant') + '">&#x203A;</button>';
      const picker = document.createElement('details');
      picker.className = 'viz-carousel-picker';
      picker.innerHTML = '<summary style="display:flex;align-items:center;cursor:pointer"><span class="viz-carousel-name"></span></summary>';
      const options = document.createElement('div');
      options.className = 'viz-carousel-options';
      picker.appendChild(options);
      controls.insertBefore(picker, controls.querySelector('.viz-carousel-next'));
      const count = controls.querySelector('.viz-carousel-count');
      const name = controls.querySelector('.viz-carousel-name');
      const status = document.createElement('span');
      status.className = 'sr-only';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      let active = 0;
      const choices = panels.map((panel, index) => {
        panel.setAttribute('aria-label', panel.getAttribute('aria-label') || panel.dataset.variant);
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.textContent = panel.dataset.variant;
        choice.addEventListener('click', () => { select(index); picker.open = false; });
        options.appendChild(choice);
        return choice;
      });
      const select = (index) => {
        active = index;
        panels.forEach((panel, position) => { panel.hidden = position !== index; });
        choices.forEach((choice, position) => choice.setAttribute('aria-current', String(position === index)));
        root.dataset.activeVariant = panels[index].dataset.variant;
        count.textContent = (index + 1) + ' / ' + panels.length;
        name.textContent = panels[index].dataset.variant;
        status.textContent = count.textContent + ': ' + name.textContent;
      };
      controls.querySelector('.viz-carousel-prev').addEventListener('click', () => select((active + panels.length - 1) % panels.length));
      controls.querySelector('.viz-carousel-next').addEventListener('click', () => select((active + 1) % panels.length));
      document.addEventListener('click', (event) => {
        if (!picker.contains(event.target)) picker.open = false;
      });
      root.append(controls, status);
      select(0);
    }
  })();

  // ── lucide：<i data-lucide="name"> 占位替换（16px currentColor） ────────
  const initIcons = () => window.lucide?.createIcons?.({ attrs: { width: 16, height: 16 } });
  if (window.lucide) initIcons();
  else document.querySelector('script[src*="lucide"]')?.addEventListener('load', initIcons, { once: true });
})();
`
