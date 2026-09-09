"use client";

/// 纸。日记和信共用——它们是同一种材质上的两件东西，
/// 分开写两套的话，加一种纸色要改两处，迟早分叉。

export type PaperRule = "blank" | "line" | "grid";

export const PAPER_RULES: { id: PaperRule; name: string }[] = [
  { id: "blank", name: "空白" },
  { id: "line", name: "横线" },
  { id: "grid", name: "方格" },
];

export const PAPER_TINTS = [
  { id: "cream", name: "米白", css: "oklch(0.965 0.014 85)" },
  { id: "sand", name: "淡黄", css: "oklch(0.945 0.035 90)" },
  { id: "sky", name: "淡蓝", css: "oklch(0.945 0.028 230)" },
  { id: "blush", name: "淡粉", css: "oklch(0.945 0.028 15)" },
];

export const tintCss = (id: string) =>
  PAPER_TINTS.find((t) => t.id === id)?.css ?? PAPER_TINTS[0].css;

/// 纸的纹理。纯 CSS，没有图片——横线和方格就是重复渐变，
/// 换纸色时线的颜色跟着底色走，不会出现「白纸的线画在黄纸上」。
///
/// `lineGap` 必须和正文的 line-height 相等，否则字会浮在线上面或压进线里。
export function paperStyle(tint: string, rule: PaperRule, lineGap = 30): React.CSSProperties {
  const bg = tintCss(tint);
  const ink = "oklch(0.55 0.03 250 / 0.22)";
  if (rule === "line") {
    return {
      background: `repeating-linear-gradient(to bottom, transparent 0, transparent ${lineGap - 1}px, ${ink} ${lineGap - 1}px, ${ink} ${lineGap}px), ${bg}`,
    };
  }
  if (rule === "grid") {
    return {
      background:
        `repeating-linear-gradient(to bottom, transparent 0, transparent ${lineGap - 1}px, ${ink} ${lineGap - 1}px, ${ink} ${lineGap}px), ` +
        `repeating-linear-gradient(to right, transparent 0, transparent ${lineGap - 1}px, ${ink} ${lineGap - 1}px, ${ink} ${lineGap}px), ` +
        bg,
    };
  }
  return { background: bg };
}

/// 手写体正文的统一样式。字色刻意不用 --ink：纸永远是浅的，
/// 前景不该跟着壁纸的深浅走——那样黑壁纸下会变成白字写在白纸上。
export const handInk: React.CSSProperties = {
  fontFamily: "var(--font-hand)",
  color: "oklch(0.28 0.02 250)",
  lineHeight: "30px",
};

export const dayLabel = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};
