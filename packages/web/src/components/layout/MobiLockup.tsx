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
 * Mobi 品牌 lockup 组件 — 内联描边 M + MOBI + 标语（透明底），颜色跟随 app 主题。
 * 尺寸由父元素通过 width/height 控制。
 */

import type { CSSProperties } from 'react'
import { useUiStore } from '@/core/data/stores/uiStore'
import { MOBI_WORDMARK_PATHS } from './brandPaths'

interface MobiLockupProps {
    /** 自定义类名 */
    className?: string
    /** 内联样式 */
    style?: CSSProperties
}

/** 标语 "YOUR READING COMPANION" 各字符路径（transform 定位） */
const SLOGAN_PATHS: { t: string; d: string }[] = [
    { t: 'translate(110.14,365) scale(0.01465,-0.01465)', d: 'M42 1469H274L696 763L1118 1469H1351L796 592V0H597V592ZM699 1469Z' },
    { t: 'translate(137.15,365) scale(0.01465,-0.01465)', d: 'M1366 1259Q1512 1064 1512 760Q1512 431 1345 213Q1149 -43 786 -43Q447 -43 253 181Q80 397 80 727Q80 1025 228 1237Q418 1509 790 1509Q1179 1509 1366 1259ZM1308 757Q1308 1016 1172.5 1174.0Q1037 1332 802 1332Q574 1332 430.0 1175.5Q286 1019 286 714Q286 470 409.5 302.5Q533 135 810 135Q1073 135 1190.5 323.5Q1308 512 1308 757ZM796 1509Z' },
    { t: 'translate(167.49,365) scale(0.01465,-0.01465)', d: 'M372 1469V561Q372 401 432 295Q521 135 732 135Q985 135 1076 308Q1125 402 1125 561V1469H1327V644Q1327 373 1254 227Q1120 -39 748 -39Q376 -39 243 227Q170 373 170 644V1469ZM749 1469Z' },
    { t: 'translate(196.15,365) scale(0.01465,-0.01465)', d: 'M839 796Q979 796 1060.5 852.0Q1142 908 1142 1054Q1142 1211 1028 1268Q967 1298 865 1298H379V796ZM180 1469H860Q1028 1469 1137 1420Q1344 1326 1344 1073Q1344 941 1289.5 857.0Q1235 773 1137 722Q1223 687 1266.5 630.0Q1310 573 1315 445L1322 248Q1325 164 1336 123Q1354 53 1400 33V0H1156Q1146 19 1140.0 49.0Q1134 79 1130 165L1118 410Q1111 554 1011 603Q954 630 832 630H379V0H180Z' },
    { t: 'translate(240.15,365) scale(0.01465,-0.01465)', d: 'M910 602 687 1251 450 602ZM583 1469H808L1341 0H1123L974 440H393L234 0H30Z' },
    { t: 'translate(267.16,365) scale(0.01465,-0.01465)', d: 'M201 1469H402V0H201Z' },
    { t: 'translate(282.50,365) scale(0.01465,-0.01465)', d: 'M175 218H384V0H175Z' },
    { t: 'translate(313.17,365) scale(0.01465,-0.01465)', d: 'M910 602 687 1251 450 602ZM583 1469H808L1341 0H1123L974 440H393L234 0H30Z' },
    { t: 'translate(340.17,365) scale(0.01465,-0.01465)', d: 'M156 1469H355V175H1099V0H156Z' },
    { t: 'translate(363.86,365) scale(0.01465,-0.01465)', d: 'M253 1469 530 274 862 1469H1078L1410 274L1687 1469H1905L1519 0H1310L971 1218L630 0H421L37 1469Z' },
    { t: 'translate(399.17,365) scale(0.01465,-0.01465)', d: 'M910 602 687 1251 450 602ZM583 1469H808L1341 0H1123L974 440H393L234 0H30Z' },
    { t: 'translate(426.18,365) scale(0.01465,-0.01465)', d: 'M42 1469H274L696 763L1118 1469H1351L796 592V0H597V592ZM699 1469Z' },
    { t: 'translate(453.19,365) scale(0.01465,-0.01465)', d: 'M286 474Q293 349 345 271Q444 125 694 125Q806 125 898 157Q1076 219 1076 379Q1076 499 1001 550Q925 600 763 637L564 682Q369 726 288 779Q148 871 148 1054Q148 1252 285.0 1379.0Q422 1506 673 1506Q904 1506 1065.5 1394.5Q1227 1283 1227 1038H1040Q1025 1156 976 1219Q885 1334 667 1334Q491 1334 414.0 1260.0Q337 1186 337 1088Q337 980 427 930Q486 898 694 850L900 803Q1049 769 1130 710Q1270 607 1270 411Q1270 167 1092.5 62.0Q915 -43 680 -43Q406 -43 251 97Q96 236 99 474ZM688 1509Z' },
    { t: 'translate(495.54,365) scale(0.01465,-0.01465)', d: 'M253 1469 530 274 862 1469H1078L1410 274L1687 1469H1905L1519 0H1310L971 1218L630 0H421L37 1469Z' },
    { t: 'translate(530.85,365) scale(0.01465,-0.01465)', d: 'M201 1469H402V0H201Z' },
    { t: 'translate(546.19,365) scale(0.01465,-0.01465)', d: 'M1225 1469V1294H730V0H528V1294H33V1469Z' },
    { t: 'translate(571.51,365) scale(0.01465,-0.01465)', d: 'M161 1469H362V862H1126V1469H1327V0H1126V687H362V0H161Z' },
    { t: 'translate(615.51,365) scale(0.01465,-0.01465)', d: 'M42 1469H274L696 763L1118 1469H1351L796 592V0H597V592ZM699 1469Z' },
    { t: 'translate(642.52,365) scale(0.01465,-0.01465)', d: 'M1366 1259Q1512 1064 1512 760Q1512 431 1345 213Q1149 -43 786 -43Q447 -43 253 181Q80 397 80 727Q80 1025 228 1237Q418 1509 790 1509Q1179 1509 1366 1259ZM1308 757Q1308 1016 1172.5 1174.0Q1037 1332 802 1332Q574 1332 430.0 1175.5Q286 1019 286 714Q286 470 409.5 302.5Q533 135 810 135Q1073 135 1190.5 323.5Q1308 512 1308 757ZM796 1509Z' },
    { t: 'translate(672.86,365) scale(0.01465,-0.01465)', d: 'M372 1469V561Q372 401 432 295Q521 135 732 135Q985 135 1076 308Q1125 402 1125 561V1469H1327V644Q1327 373 1254 227Q1120 -39 748 -39Q376 -39 243 227Q170 373 170 644V1469ZM749 1469Z' },
    { t: 'translate(701.52,365) scale(0.01465,-0.01465)', d: 'M175 218H384V0H175Z' },
]

export function MobiLockup({ className, style }: MobiLockupProps) {
    const isDark = useUiStore((s) => s.theme === 'dark')
    const stroke = isDark ? '#faf9f5' : '#141413'
    const sloganFill = isDark ? '#8f8f8f' : '#87867f'

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 820 430"
            role="img"
            aria-label="Mobi"
            className={className}
            style={style}
        >
            {/* M + MOBI 描边字标 */}
            <g
                transform="translate(48.62,-58.62) scale(4.1538)"
                fill="none"
                stroke={stroke}
                strokeWidth={2}
                strokeLinejoin="round"
            >
                {MOBI_WORDMARK_PATHS.map((d, i) => (
                    <path key={i} d={d} />
                ))}
            </g>

            {/* 标语 "YOUR READING COMPANION" */}
            <g fill={sloganFill}>
                {SLOGAN_PATHS.map((p, i) => (
                    <path key={i} transform={p.t} d={p.d} />
                ))}
            </g>
        </svg>
    )
}
