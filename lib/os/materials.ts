import type { Settings } from "./settings";

/// 玻璃的两种材质。
///
/// 它不是新功能，是**几根滑杆的组合**——每一档写的都是下面那几个已有的数。
/// 这么做是因为「晕染」这种观感不是任何单一参数能给的：模糊得开到很大、
/// 饱和要提、浓度要压低，三个一起动才成立，单独动一个只会变难看。
/// 挑完还能接着拉滑杆，滑杆仍然是唯一的真相。
///
/// ⚠️ **「清透」写的是一串 0，不是一串具体的数。** 0 在 settings 里表示
/// 「没设过，用 CSS 的默认」，而深浅两套主题的默认值本来就不一样。
/// 要是这里写死 50%，浅色底下就再也回不到它原本调好的那个值了。
export type Material = {
  id: string;
  name: string;
  hint: string;
  /// 这一档要写进设置的值
  set: Pick<Settings, "glassBlur" | "glassAlpha" | "iconAlpha" | "glassSat" | "glassEdge">;
};

export const MATERIALS: Material[] = [
  {
    id: "clear",
    name: "清透",
    hint: "看得见壁纸的纹路",
    set: { glassBlur: 0, glassAlpha: 0, iconAlpha: 0, glassSat: 0, glassEdge: 16 },
  },
  {
    id: "bloom",
    name: "晕染",
    hint: "纹路化开，只剩颜色",
    set: {
      // 关键就是这个数。20px 上你还认得出壁纸上是什么；
      // 到七八十，纹理整个化掉，底下剩的只有一团一团的颜色——那就是「晕染」。
      glassBlur: 72,
      // 化开之后颜色会散，不压浓度就成了一块白板，什么都透不出来
      glassAlpha: 30,
      // ⚠️ **饱和度是这一档的命。** 模糊本身是在做平均，平均会把互补色抵消掉，
      // 不把饱和提回来，剩下的就是一片脏灰。
      glassSat: 240,
      // 图标不跟着压。它们只有 58px 见方，在 30% 上会直接消失在壁纸里
      iconAlpha: 0,
      // ⚠️ 边缘折射在这一档要关掉。那一圈画的是**清晰的壁纸副本**，
      // 中间已经糊成色块了，边上却还带着纹路，接缝会非常明显。
      glassEdge: 0,
    },
  },
];

/// 当前设置落在哪一档上；自己拉过滑杆就哪一档都不是。
export const materialOf = (s: Settings) =>
  MATERIALS.find((m) =>
    (Object.keys(m.set) as (keyof Material["set"])[]).every((k) => s[k] === m.set[k]),
  )?.id ?? "";
