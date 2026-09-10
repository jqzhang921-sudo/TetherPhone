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

/// 承载文字的白/暗面。和 .glass 不同：这里的百分比不是为了好看，是为了压住背景。
///
/// ⚠️ **半透明的气泡也要吃 `--glass-floor`。** 聊天页可以铺自己的背景图，
/// 那时压在气泡底下的就不是壁纸了——设备那一层按壁纸算出来的下限管不到这儿。
/// 聊天页会把按背景图算出的下限设在自己身上，靠这个 max() 顶上去。
const solid = (pct = 88): React.CSSProperties => ({
  background: `color-mix(in oklab, var(--glass-tint) max(${pct}%, var(--glass-floor, 0%)), transparent)`,
  color: "var(--ink)",
  border: "1px solid var(--glass-edge)",
});

/// 玻璃那套两侧一样，抽出来省得写两遍、也省得改一处漏一处
const glassFace: React.CSSProperties = {
  background:
    "color-mix(in oklab, var(--glass-tint) max(var(--glass-alpha-strong), var(--glass-floor-strong, 0%)), transparent)",
  color: "var(--ink)",
  backdropFilter: "blur(var(--glass-blur)) saturate(1.9)",
  WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(1.9)",
  border: "1px solid var(--glass-edge)",
};

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
    me: () => glassFace,
    them: glassFace,
  },
  {
    id: "ink",
    name: "描边",
    hint: "只有一圈线，最轻",
    // ⚠️ 线要压得比字轻。1.5px 的实色描边比正文还抢眼，一眼先看见框、
    // 再看见话——这套的名字叫「最轻」，就不该是屏幕上最重的东西。
    // 收到 1px，颜色兑掉一半透明度。
    me: (tint) => ({ ...solid(82), border: `1px solid color-mix(in oklab, ${tint} 42%, transparent)` }),
    them: { ...solid(82), border: "1px solid color-mix(in oklab, var(--ink) 13%, transparent)" },
  },
];

export const bubbleById = (id: string) => BUBBLES.find((b) => b.id === id) ?? BUBBLES[0];
