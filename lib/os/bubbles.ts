import type React from "react";

/// 聊天气泡的几套样式。
///
/// **默认那套（跟随主题）不是"没选"的凑合，是有理由的**：它的底色来自联系人，
/// 换个人聊天气泡就换个颜色——谁在说话不用看左右，扫一眼颜色就知道。
/// 其余几套是"我就想要这个样子"时用的，所以刻意都不跟联系人走。
///
/// ⚠️ 每套都**必须自己立住底**，不能靠透出壁纸成立。玻璃是给容器用的，
/// 承载正文的面透出去，字就要在壁纸亮的地方消失——和玻璃那条下限是同一个坑。
export type BubbleStyle = {
  id: string;
  name: string;
  hint: string;
  /// 用户那侧。tint 是联系人的气泡色，只有「跟随主题」会用它。
  me: (tint: string) => React.CSSProperties;
  /// 它那侧。
  them: React.CSSProperties;
};

/// 承载文字的白/暗面。和 .glass 不同：这里 88% 不是为了好看，是为了压住背景。
const solid = (pct = 88): React.CSSProperties => ({
  background: `color-mix(in oklab, var(--glass-tint) ${pct}%, transparent)`,
  color: "var(--ink)",
  border: "1px solid var(--glass-edge)",
});

export const BUBBLES: BubbleStyle[] = [
  {
    id: "theme",
    name: "跟随主题",
    hint: "你这侧用联系人的颜色，换个人换个色",
    me: (tint) => ({ background: tint, color: "oklch(0.99 0 0)" }),
    them: solid(),
  },
  {
    id: "soft",
    name: "淡彩",
    hint: "两边都是浅色深字，安静一些",
    // ⚠️ **这套刻意不跟深浅走，也不跟联系人走。**
    // 跟着 --glass-tint 的话，深色壁纸下它会变成一对深气泡，
    // 和「跟随主题」几乎一样——那就等于没提供这个选项。
    // 挑「淡彩」的人要的就是浅底深字，不管壁纸是什么。
    me: () => ({ background: "oklch(0.89 0.055 300)", color: "oklch(0.27 0.04 300)" }),
    them: { background: "oklch(0.985 0.002 280)", color: "oklch(0.25 0.01 280)" },
  },
  {
    id: "glass",
    name: "都是玻璃",
    hint: "两边一样，只靠左右分谁说的",
    me: () => ({
      background: "color-mix(in oklab, var(--glass-tint) var(--glass-alpha-strong), transparent)",
      color: "var(--ink)",
      backdropFilter: "blur(var(--glass-blur)) saturate(1.9)",
      WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(1.9)",
      border: "1px solid var(--glass-edge)",
    }),
    them: {
      background: "color-mix(in oklab, var(--glass-tint) var(--glass-alpha-strong), transparent)",
      color: "var(--ink)",
      backdropFilter: "blur(var(--glass-blur)) saturate(1.9)",
      WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(1.9)",
      border: "1px solid var(--glass-edge)",
    },
  },
  {
    id: "ink",
    name: "描边",
    hint: "只有一圈线，最轻",
    me: (tint) => ({
      background: "color-mix(in oklab, var(--glass-tint) 82%, transparent)",
      color: "var(--ink)",
      border: `1.5px solid ${tint}`,
    }),
    them: {
      background: "color-mix(in oklab, var(--glass-tint) 82%, transparent)",
      color: "var(--ink)",
      border: "1.5px solid var(--ink-faint)",
    },
  },
];

export const bubbleById = (id: string) => BUBBLES.find((b) => b.id === id) ?? BUBBLES[0];
