/// 壁纸。第一版全是 CSS 渐变，不依赖任何图片文件——
/// 换成上传的照片是后面的事，那时 `tone` 要改成从图里算（走 OKLab 的
/// 彩度×明度加权，不是 HSL 饱和度）。现在先手标。
export type Wallpaper = {
  id: string;
  name: string;
  /// 深浅决定整套前景色和玻璃的黑白。
  tone: "light" | "dark";
  css: string;
};

export const WALLPAPERS: Wallpaper[] = [
  {
    id: "dusk",
    name: "黄昏",
    tone: "dark",
    css: "radial-gradient(120% 80% at 20% 0%, oklch(0.45 0.14 25) 0%, transparent 55%), radial-gradient(100% 90% at 90% 20%, oklch(0.38 0.12 320) 0%, transparent 60%), linear-gradient(180deg, oklch(0.24 0.06 280) 0%, oklch(0.14 0.03 265) 100%)",
  },
  {
    id: "mist",
    name: "晨雾",
    tone: "light",
    css: "radial-gradient(110% 70% at 15% 10%, oklch(0.94 0.05 210) 0%, transparent 60%), radial-gradient(90% 80% at 85% 30%, oklch(0.93 0.06 340) 0%, transparent 55%), linear-gradient(180deg, oklch(0.97 0.02 240) 0%, oklch(0.90 0.03 260) 100%)",
  },
  {
    id: "moss",
    name: "苔绿",
    tone: "dark",
    css: "radial-gradient(120% 90% at 70% 10%, oklch(0.42 0.09 150) 0%, transparent 60%), linear-gradient(180deg, oklch(0.26 0.05 160) 0%, oklch(0.15 0.03 170) 100%)",
  },
  {
    id: "ice",
    name: "冰蓝",
    tone: "dark",
    css: "radial-gradient(120% 80% at 30% 0%, oklch(0.48 0.11 230) 0%, transparent 58%), radial-gradient(90% 70% at 85% 60%, oklch(0.40 0.08 200) 0%, transparent 55%), linear-gradient(180deg, oklch(0.24 0.05 240) 0%, oklch(0.13 0.02 235) 100%)",
  },
  {
    id: "paper",
    name: "纸",
    tone: "light",
    css: "radial-gradient(100% 70% at 25% 5%, oklch(0.96 0.03 75) 0%, transparent 60%), linear-gradient(180deg, oklch(0.95 0.02 70) 0%, oklch(0.88 0.03 60) 100%)",
  },
];

export const wallpaperById = (id: string) =>
  WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
