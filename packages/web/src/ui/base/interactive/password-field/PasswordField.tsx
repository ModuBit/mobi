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

// uiarc password-field（registry 快照，自管件：深度本地化后脱离 registry，不登记 registry.json）。
// 本地修改：①label 改可选——可选时不渲染 label 节点（设置行左标签/FieldRow 自管 label
//   的行内场景，壳内 label 是多余的）②motionTokens 改引 @/ui/base/motion/motionTokens
// ③className 挂组件根（field）——布局尺寸从根上给，消费方无需包裹 div
// ④messages 默认文案改走 i18n（ui.passwordField.*；上游默认英文，仍可传 messages 覆写）
// ⑤补 error prop——与 input 同语言（aria-invalid 红边 + alert 红字；上游仅 description）
// ⑥消息动效链收拢 fieldMessageShared（与 input 同源，reduced-motion 首帧修复随之同步）
"use client";

import { forwardRef, useId, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/ui/base/motion/motionTokens";
import { useTranslation } from "react-i18next";
import { FieldMessage } from "@/ui/base/interactive/fieldMessageShared";
import styles from "./password-field.module.css";

export interface PasswordFieldMessages { showPassword: string; hidePassword: string }
export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  description?: string;
  error?: string;
  /** Translated or reworded toggle names（默认取 i18n）。 */
  messages?: Partial<PasswordFieldMessages>;
}

/** One eye that a slash draws across, cutting the outline beneath it, instead of swapping two icons. */
function EyeMorph({ slashed }: { slashed: boolean }) {
  const reduced = useReducedMotion(); const maskId = `eye-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const slash = { pathLength: slashed ? 1 : 0, opacity: slashed ? 1 : 0 };
  const transition = reduced ? { duration: 0 } : { pathLength: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.standard] }, opacity: { duration: motionTokens.duration.instant } };
  return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="white" stroke="none" /><motion.path d="M2 2l20 20" stroke="black" strokeWidth={5} initial={false} animate={slash} transition={transition} /></mask>
    <g mask={`url(#${maskId})`}><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></g>
    <motion.path d="M2 2l20 20" initial={false} animate={slash} transition={transition} />
  </svg>;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField({ label, description, error, messages: messagesProp, id, className, ...props }, ref) {
  const { t } = useTranslation();
  // 上游默认英文；这里默认值取 i18n，messages 仍可覆写
  const messages: PasswordFieldMessages = { showPassword: t("ui.passwordField.show"), hidePassword: t("ui.passwordField.hide"), ...messagesProp };
  const generated = useId(); const controlId = id ?? generated; const [visible, setVisible] = useState(false); const [toggled, setToggled] = useState(false);
  const hintId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;
  // data-reveal only appears after the first toggle, so the value resolves on each change but never on mount.
  return <div className={[styles.field, className].filter(Boolean).join(" ")}>
    {label && <label htmlFor={controlId}>{label}</label>}
    <div className={styles.shell}>
      <input {...props} ref={ref} id={controlId} type={visible ? "text" : "password"} data-reveal={toggled ? (visible ? "shown" : "hidden") : undefined} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={describedBy} className={styles.input} />
      <button type="button" onClick={() => { setVisible(current => !current); setToggled(true); }} aria-label={visible ? messages.hidePassword : messages.showPassword} aria-pressed={visible}><EyeMorph slashed={visible} /></button>
    </div>
    <FieldMessage id={hintId} text={description} className={styles.hint} />
    <FieldMessage id={errorId} text={error} className={styles.error} alert />
  </div>;
});

PasswordField.displayName = "PasswordField";
