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
 * 药丸宽度的自然宽测量契约（ConfirmMorph 内部 seam）。
 *
 * 此前这套契约散在组件里：Face 用 ResizeObserver 上报自身宽度、onFaceSize 记
 * target/flight 两个 ref、判断亚像素抖动、决定起飞前是否先钉住旧宽、按方向选
 * 弹簧、再用 token 作废旧飞行——组件正文因此混着六条隐含协议，只能靠人读。
 * 这里收成一个成员极小的 oracle，协议集中且可用假 animate 穷举：
 *
 * - **只有当前在场的那一面会上报**（离场面的 Face 停止观察）——oracle 不校验身份，
 *   报告即当前脸的自然宽；
 * - **亚像素抖动不改变目标**：差值 < 0.25px 直接忽略，避免弹簧被测量噪声反复拉飞；
 * - **首报与 reduced-motion 直接钉 auto**：无参考宽度可做起点，或用户不想要动画；
 * - **起飞前把宽度钉到旧目标**：当前是 auto 时，弹簧从「上一面的自然宽」起步而不是
 *   从当前实际值起步，否则会从半个宽度开始抖；
 * - **方向决定弹簧**：变宽用 grow（带回弹的活力），变窄用 shrink（不过冲）；
 * - **回落 auto 只认最后一次飞行**：每次起飞递增 token，旧飞行完成回调发现 token
 *   过期就不再写 auto（否则会把新飞行中途的宽度抹回自动宽）；
 * - **落地回 auto**：飞行结束时 jump("auto")，把宽度交还给内容自然宽，下次换面
 *   无接缝（测量值带小数，弹簧终点与自然宽完全一致）。
 */
import type { MotionValue, Transition } from "motion/react";

/** 亚像素抖动阈值：宽度测量带小数，小于它的差视为噪声 */
const JITTER_PX = 0.25;

/** 注入的动画执行器（生产传 motion 的 animate；测试传可控假体） */
export type FaceWidthAnimate = (
    value: MotionValue<number>,
    to: number,
    transition: Transition,
) => { then: (onFulfilled: () => void) => unknown };

export interface FaceWidthOracleDeps {
    /** 药丸宽度（px 或 auto） */
    width: MotionValue<number | "auto">;
    animate: FaceWidthAnimate;
    /** 变宽弹簧（带回弹） */
    grow: Transition;
    /** 变窄弹簧（不过冲） */
    shrink: Transition;
}

export interface FaceWidthOracle {
    /**
     * 照当前在场面的自然宽度上报。
     * @param width 自然宽度（getBoundingClientRect().width，带小数）
     * @param reduced 尊重 reduced-motion：直接钉 auto，不做弹簧
     */
    report: (width: number, reduced: boolean) => void;
}

export function createFaceWidthOracle({ width, animate, grow, shrink }: FaceWidthOracleDeps): FaceWidthOracle {
    let target = 0;
    let flight = 0;
    return {
        report(reported, reduced) {
            if (Math.abs(reported - target) < JITTER_PX) return;
            const from = target;
            target = reported;
            // 首报（无起点）或 reduced-motion：直接交给内容自然宽
            if (!from || reduced) {
                flight++;
                width.jump("auto");
                return;
            }
            const now = width.get();
            // auto 状态下起飞：先钉到上一面宽度，弹簧从那里起步
            if (now === "auto") width.jump(from);
            const token = ++flight;
            animate(width as MotionValue<number>, reported, reported > (typeof now === "number" ? now : from) ? grow : shrink)
                .then(() => {
                    if (token === flight) width.jump("auto");
                });
        },
    };
}
