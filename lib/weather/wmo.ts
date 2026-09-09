/// WMO 天气码 → 我们自己的「场景」。
///
/// 场景不是天气现象的一一对应，是**画面**：雷雨和暴雨在屏幕上是同一套雨，
/// 只是雷雨多一层闪。分得比现象粗，是因为多一个场景就多一套要调的动画，
/// 而人分不出「小雨」和「中雨」的粒子数差别。
export type Scene =
  | "clear"
  | "cloudy"
  | "overcast"
  | "fog"
  | "rain"
  | "thunder"
  | "snow";

export function sceneOf(code: number): Scene {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "thunder";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 51) return "rain";
  return "cloudy";
}

const TEXT: Record<number, string> = {
  0: "晴",
  1: "晴间多云",
  2: "多云",
  3: "阴",
  45: "雾",
  48: "雾凇",
  51: "毛毛雨",
  53: "小雨",
  55: "细雨",
  56: "冻毛毛雨",
  57: "冻雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "强冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "米雪",
  80: "阵雨",
  81: "强阵雨",
  82: "暴雨",
  85: "阵雪",
  86: "强阵雪",
  95: "雷阵雨",
  96: "雷雨伴冰雹",
  99: "强雷雨伴冰雹",
};

export const textOf = (code: number) => TEXT[code] ?? "说不好";

/// 每个场景的天空。**天空是 CSS 渐变，粒子才是 canvas**——
/// 大面积的渐变交给合成器，比每帧重画一遍便宜得多。
export function skyCss(scene: Scene, day: boolean): string {
  if (!day) {
    if (scene === "clear")
      return "linear-gradient(180deg, oklch(0.20 0.055 265) 0%, oklch(0.13 0.035 265) 55%, oklch(0.10 0.02 260) 100%)";
    if (scene === "rain" || scene === "thunder")
      return "linear-gradient(180deg, oklch(0.22 0.025 250) 0%, oklch(0.15 0.018 250) 100%)";
    if (scene === "snow")
      return "linear-gradient(180deg, oklch(0.26 0.02 260) 0%, oklch(0.17 0.015 255) 100%)";
    return "linear-gradient(180deg, oklch(0.24 0.02 258) 0%, oklch(0.15 0.014 255) 100%)";
  }
  switch (scene) {
    case "clear":
      return "linear-gradient(180deg, oklch(0.72 0.13 235) 0%, oklch(0.84 0.08 225) 58%, oklch(0.93 0.05 90) 100%)";
    case "cloudy":
      return "linear-gradient(180deg, oklch(0.74 0.09 235) 0%, oklch(0.87 0.04 230) 100%)";
    case "overcast":
      return "linear-gradient(180deg, oklch(0.72 0.02 250) 0%, oklch(0.82 0.012 250) 100%)";
    case "fog":
      return "linear-gradient(180deg, oklch(0.80 0.012 250) 0%, oklch(0.88 0.008 250) 100%)";
    case "rain":
      return "linear-gradient(180deg, oklch(0.55 0.03 250) 0%, oklch(0.70 0.02 245) 100%)";
    case "thunder":
      return "linear-gradient(180deg, oklch(0.42 0.035 265) 0%, oklch(0.58 0.025 255) 100%)";
    case "snow":
      return "linear-gradient(180deg, oklch(0.76 0.018 255) 0%, oklch(0.90 0.008 250) 100%)";
  }
}

/// 天空是深的还是浅的——决定压在上面的字和玻璃走哪一套。
///
/// ⚠️ **只看白天黑夜，不要看天气。** 一开始写成「雨天也算暗」，真机上白字
/// 直接糊在淡紫色里看不见——因为雨天多了一层雾面玻璃，那层把整个画面**提亮**了，
/// 天空本身多暗都不算数。
/// 这就是那条老规矩的又一次现形：承载文字的表面必须自己保证对比度，
/// 不能靠"底下应该是暗的"这种假设成立。
export const skyIsDark = (_scene: Scene, day: boolean) => !day;
