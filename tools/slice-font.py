#!/usr/bin/env python3
"""把一个中文字体切成 unicode-range 分片，生成自托管的 @font-face CSS。

为什么要切：中文字库一个 3–5MB，整包塞进网页等于让人对着空白等几秒。
切开之后浏览器只下载「这一页真的用到的字」所在的那几片——一页日记通常
两三百个不同的字，落到五六片上，几百 KB 就够。这是 Google Fonts 对中文
字体的做法，只是我们自己托管，不依赖 fonts.googleapis.com（国内不通）。

用法：
    python tools/slice-font.py tools/fonts/ZhiMangXing.ttf ZhiMangXing

产物：
    public/fonts/<name>/<name>-<i>.woff2
    public/fonts/<name>/<name>.css     ← 在 globals.css 里 @import 它
"""
from __future__ import annotations

import sys
from pathlib import Path

from fontTools.subset import Subsetter, Options
from fontTools.ttLib import TTFont

# 分三层，每层再切几片。
#
# ⚠️ **不要按码位顺序均分**——试过，那是错的：常用汉字散落在整个
# U+4E00–U+9FA5 区间，一页日记两三百个不同的字会打到二三十片上，
# 等于把整包下下来，白切。
#
# 按「常用度」分层才有意义。GB2312 的编码结构自带这个信息：
#   区位 1–9   = 符号和拉丁      → 极小，总是要
#   区位 16–55 = 一级汉字 3755 个 = 常用字，中文正文 99% 落在这儿
#   区位 56–87 = 二级汉字 3008 个 = 次常用，多数人一辈子下不到
# 于是常用那层下完就够用，生僻那一层（约 1MB）根本不发请求。
TIERS = [("base", 1), ("common", 6), ("rare", 6)]

ROOT = Path(__file__).resolve().parent.parent


def codepoints(path: Path) -> list[int]:
    font = TTFont(path, lazy=True)
    cps = set()
    for table in font["cmap"].tables:
        cps.update(table.cmap.keys())
    font.close()
    return sorted(cps)


def ranges(cps: list[int]) -> str:
    """把一串码位压成 CSS unicode-range 写法（连续的合并成 U+4E00-4E20）。"""
    out, start, prev = [], cps[0], cps[0]
    for cp in cps[1:]:
        if cp == prev + 1:
            prev = cp
            continue
        out.append(f"U+{start:X}" if start == prev else f"U+{start:X}-{prev:X}")
        start = prev = cp
    out.append(f"U+{start:X}" if start == prev else f"U+{start:X}-{prev:X}")
    return ", ".join(out)


def tier_of(cp: int) -> str:
    """按 GB2312 的区位判断常用度。编不进 GB2312 的一律算生僻。"""
    try:
        raw = chr(cp).encode("gb2312")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return "rare"
    if len(raw) == 1:
        return "base"
    zone = raw[0] - 0xA0
    if zone <= 9:
        return "base"
    return "common" if 16 <= zone <= 55 else "rare"


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 1

    src = Path(sys.argv[1])
    name = sys.argv[2]
    out_dir = ROOT / "public" / "fonts" / name.lower()
    out_dir.mkdir(parents=True, exist_ok=True)

    cps = codepoints(src)
    buckets: dict[str, list[int]] = {"base": [], "common": [], "rare": []}
    for cp in cps:
        buckets[tier_of(cp)].append(cp)
    print(
        f"{src.name}: {len(cps)} 个码位 → "
        + " / ".join(f"{k} {len(v)}" for k, v in buckets.items())
    )

    # 每层内部再均分成几片，让浏览器能并行下载。
    chunks: list[tuple[str, list[int]]] = []
    for tier, parts in TIERS:
        pool = buckets[tier]
        if not pool:
            continue
        per = -(-len(pool) // parts)
        for i in range(parts):
            piece = pool[i * per : (i + 1) * per]
            if piece:
                chunks.append((f"{tier}-{i}", piece))

    faces = []

    for tag, chunk in chunks:
        opts = Options()
        opts.flavor = "woff2"
        opts.desubroutinize = True
        # 保留字距和排版表；中文用不上大部分，但去掉 layout 会影响标点压缩
        opts.layout_features = ["*"]
        opts.drop_tables += ["FFTM"]
        opts.notdef_outline = True

        font = TTFont(src)
        sub = Subsetter(options=opts)
        sub.populate(unicodes=chunk)
        sub.subset(font)

        target = out_dir / f"{name}-{tag}.woff2"
        font.flavor = "woff2"
        font.save(target)
        font.close()

        faces.append((target.name, ranges(chunk), target.stat().st_size))
        print(f"  {tag:>10}  {target.stat().st_size/1024:6.1f} KB  {len(chunk)} 字")

    css = [
        f"/* {name} —— 由 tools/slice-font.py 生成，别手改 */",
        "/* 浏览器只会下载这一页真的用到的字所在的那几片。 */",
        "",
    ]
    for file, rng, _ in faces:
        css.append("@font-face {")
        css.append(f"  font-family: '{name}';")
        css.append("  font-style: normal;")
        css.append("  font-weight: 400;")
        # swap：字体还没到时先用兜底字体显示，别把文字藏起来。
        css.append("  font-display: swap;")
        css.append(f"  src: url('/fonts/{name.lower()}/{file}') format('woff2');")
        css.append(f"  unicode-range: {rng};")
        css.append("}")
        css.append("")

    (out_dir / f"{name}.css").write_text("\n".join(css), encoding="utf-8")

    total = sum(s for _, _, s in faces)
    print(f"\n合计 {total/1024/1024:.2f} MB / {len(faces)} 片（原文件 {src.stat().st_size/1024/1024:.2f} MB）")
    print(f"CSS → public/fonts/{name.lower()}/{name}.css")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
