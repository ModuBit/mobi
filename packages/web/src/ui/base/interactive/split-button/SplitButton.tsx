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

// uiarc split-button（registry 快照，自管件：深度本地化后脱离 registry，不登记 registry.json）。
// 本地修改：①motionTokens 改引 @/ui/base/motion/motionTokens（上游 ../lib/motion-tokens 不存在）
// ②arc foundation 变量消费 cssVars.ts :root 单源（UIARC_ALIAS_VARS），组件 css 无本地映射块
// ③箭头钮 aria-label 硬编码英文改走 i18n（uiarc.splitButton.moreActionsAriaLabel，{{label}} 插值）
// 其余与上游一致。
"use client";

import { useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motionTokens } from "@/ui/base/motion/motionTokens";
// morph 基建（宽度 spring / glyph diff / 进出场常量）与 Button/ActionButton/ButtonGroup 共享单源
import { fadeIn, fadeOut, iconEnter, iconIn, iconOut, iconKey, MorphGlyphs, rest, useMorphWidth } from "../morphShared";
import styles from "./split-button.module.css";

export interface SplitButtonAction { label: string; onSelect?: () => void; disabled?: boolean; destructive?: boolean; icon?: ReactNode; }
export interface SplitButtonProps { label: string; actions: SplitButtonAction[]; onClick?: () => void; disabled?: boolean; icon?: ReactNode; variant?: "primary" | "secondary"; }

/** The main action morphs its icon and label in place while its width follows on a spring; the menu half never scales, so the menu opens from a still anchor. */
export function SplitButton({ label, actions, onClick, disabled, icon, variant = "primary" }: SplitButtonProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion() ?? false;
  const contentRef = useRef<HTMLSpanElement>(null);
  const glyph = iconKey(icon);
  const width = useMorphWidth(contentRef, `${glyph}|${label}`, reduced);
  return <DropdownPrimitive.Root>
    <div className={[styles.group, variant === "secondary" ? styles.secondary : ""].filter(Boolean).join(" ")}>
      <button className={styles.primary} type="button" onClick={onClick} disabled={disabled}>
        <motion.span className={styles.primarySlot} style={{ width }} aria-hidden="true">
          <span ref={contentRef} className={styles.primaryContent}>
            {icon ? <span className={styles.mainIcon}><AnimatePresence initial={false}><motion.span key={glyph} className={styles.iconPhase} initial={reduced ? fadeIn : iconIn} animate={rest} exit={reduced ? fadeOut : iconOut} transition={reduced ? { duration: motionTokens.duration.instant } : iconEnter}>{icon}</motion.span></AnimatePresence></span> : null}
            <MorphGlyphs text={label} reduced={reduced} rowClassName={styles.glyphs} glyphClassName={styles.glyph} />
          </span>
        </motion.span>
        <span className={styles.srOnly} aria-live="polite">{label}</span>
      </button>
      <DropdownPrimitive.Trigger className={styles.trigger} type="button" aria-label={t("uiarc.splitButton.moreActionsAriaLabel", { label })} disabled={disabled}><ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden="true" /></DropdownPrimitive.Trigger>
    </div>
    <DropdownPrimitive.Portal><DropdownPrimitive.Content className={styles.menu} sideOffset={4} align="end" collisionPadding={12} loop>
      {actions.map((action, index) => <DropdownPrimitive.Item key={action.label} className={[styles.item, action.destructive ? styles.destructive : ""].filter(Boolean).join(" ")} style={{ "--i": index } as CSSProperties} disabled={action.disabled} onSelect={action.onSelect}>{action.icon ? <span className={styles.icon} aria-hidden="true">{action.icon}</span> : null}{action.label}</DropdownPrimitive.Item>)}
    </DropdownPrimitive.Content></DropdownPrimitive.Portal>
  </DropdownPrimitive.Root>;
}

export default SplitButton;
