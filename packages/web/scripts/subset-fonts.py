#!/usr/bin/env python3
#
# Copyright Maner·Fan
#
# 阿里巴巴普惠体 3.0 子集化脚本（一次性 / 字体更新时重跑）。
#
# 背景：原 woff2 每字重 ~1.7MB（含全部 2 万+ CJK），首屏 preload 一个就这么大，
# 远端 Hub + 移动端首启极慢。mobi 实际用到的字符集有限：常用汉字 + 英文字母/数字 +
# 希腊字母 + 常用数学符号。子集化后每字重 ~150-250KB。
#
# 用法：python3 scripts/subset-fonts.py
# 依赖：fontTools（pip install fonttools brotli）。macOS 自带 python3 已装 fontTools 4.63。
#
# 子集字符集：
# - GB2312 汉字（6763 个常用汉字，用 Python gb2312 codec 过滤 BMP CJK 区得到）
# - ASCII 可见字符（字母、数字、基础标点）
# - Latin-1（× ÷ 等）
# - 希腊字母（数学公式用 α β γ π θ λ μ Σ Δ …）
# - 上下标、箭头、数学运算符、几何形、制表符等常用符号区
# - CJK 标点、全角/半角形式
# 子集外字符由浏览器回退到系统字体（font-display: swap 已保证不空显）。

import os
import sys
import tempfile

from fontTools import subset

WEB_PUBLIC_FONTS = os.path.join(os.path.dirname(__file__), '..', 'public', 'fonts')

WEIGHTS = [
    ('alibaba-puhuiti', 'AlibabaPuHuiTi-3-55-Regular.woff2'),
    ('alibaba-puhuiti', 'AlibabaPuHuiTi-3-65-Medium.woff2'),
    ('alibaba-puhuiti', 'AlibabaPuHuiTi-3-85-Bold.woff2'),
    # JetBrains Mono 已是 ~90KB，无需子集
]

# 额外要保留的 Unicode 区段（汉字单独用 gb2312 codec 过滤）
EXTRA_RANGES = [
    (0x0020, 0x007E),  # ASCII 可见字符
    (0x00A0, 0x00FF),  # Latin-1（× ÷ ° · 等）
    (0x0370, 0x03FF),  # 希腊字母
    (0x2000, 0x206F),  # 常用标点
    (0x2070, 0x209F),  # 上下标
    (0x20A0, 0x20CF),  # 货币符号
    (0x2100, 0x214F),  # 字母式符号（№ ™ 等）
    (0x2150, 0x218F),  # 数字形式（⅓ Ⅳ 等）
    (0x2190, 0x21FF),  # 箭头
    (0x2200, 0x22FF),  # 数学运算符
    (0x2300, 0x23FF),  # 杂项技术符号
    (0x2460, 0x24FF),  # 圈码 ① ②
    (0x2500, 0x257F),  # 制表符
    (0x25A0, 0x25FF),  # 几何形状
    (0x2600, 0x26FF),  # 杂项符号
    (0x3000, 0x303F),  # CJK 标点符号
    (0xFF00, 0xFFEF),  # 全角/半角形式
]


def build_glyph_text() -> str:
    codepoints = set()

    # GB2312 一级常用字（3755 字，区号 16-55）：日常中文几乎全覆盖。
    # 二级字（区号 56-87）为生僻字，回退系统字体即可，不进子集以减小体积。
    # GB2312 双字节编码：b1 = 0xA0 + 区号，b2 = 0xA0 + 位号；区号 16-55 即一级字。
    for cp in range(0x4E00, 0x9FA5 + 1):
        try:
            encoded = chr(cp).encode('gb2312')
        except UnicodeEncodeError:
            continue
        qu = encoded[0] - 0xA0
        if 16 <= qu <= 55:  # 仅保留一级常用字
            codepoints.add(cp)

    # GB2312 也含部分非汉字区（如 ③ ☆ ％），上面 EXTRA_RANGES 已覆盖
    for lo, hi in EXTRA_RANGES:
        for cp in range(lo, hi + 1):
            codepoints.add(cp)

    return ''.join(chr(cp) for cp in sorted(codepoints))


def subset_one(input_path: str, output_path: str, glyph_text: str) -> tuple[int, int]:
    before = os.path.getsize(input_path)
    with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf-8') as tf:
        tf.write(glyph_text)
        glyph_file = tf.name
    try:
        argv = [
            input_path,
            f'--text-file={glyph_file}',
            f'--output-file={output_path}',
            '--flavor=woff2',
            '--desubroutinize',  # 压缩 CFF，进一步缩小
            '--no-recalc-bounds',
            '--drop-tables+=DSIG',  # 去掉签名表
        ]
        subset.main(argv)
    finally:
        os.unlink(glyph_file)
    after = os.path.getsize(output_path)
    return before, after


def main() -> int:
    glyph_text = build_glyph_text()
    print(f'子集字符数：{len(glyph_text)}（含 GB2312 汉字 + ASCII + 希腊 + 数学/标点符号）\n')

    for sub, name in WEIGHTS:
        input_path = os.path.join(WEB_PUBLIC_FONTS, sub, name)
        if not os.path.exists(input_path):
            print(f'  跳过（不存在）：{input_path}')
            continue
        before, after = subset_one(input_path, input_path, glyph_text)
        print(f'  {sub}/{name}: {before/1024:.0f}KB → {after/1024:.0f}KB '
              f'(省 {(1 - after/before)*100:.1f}%)')

    print('\n完成。fonts.css 的 unicode-range 无需改动：子集外字符会回退系统字体。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
