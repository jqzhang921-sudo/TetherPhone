"use client";

/// 从封面取色，给播放页定调。
///
/// ⚠️ **投票权重必须是 OKLab 的「彩度 × 明度」，两个因子缺一不可。**
/// 这条是从 phone-ai-assistant 搬来的，那边咬过两次：
/// - HSV 的饱和度 `s = (max−min)/max`，在接近黑的像素上分母趋近 0、剧烈抖动。
///   `RGB(10,8,12)` 肉眼是纯黑，饱和度却有 0.33、色相 270°（蓝紫）。
///   一张黑底封面里八成面积的黑会把票全投给蓝紫，真正的主色一票投不上。
/// - 只用彩度也不行：一整片系统性偏冷的黑仍然攒得够票。乘上明度才稳。
///
/// 另一条：**同一个饱和度数值在不同色相上不是同一种「花」**。
/// 所以最后调色也在 OKLCH 里做，保住彩度而不是保住 HSL 饱和度。
export type Tone = {
  /// 主色相，度
  hue: number;
  /// 主色彩度 0~0.4 左右
  chroma: number;
  /// 整体明度 0~1
  light: number;
  /// 背景该按深色还是浅色处理
  dark: boolean;
};

const f = (t: number) => Math.cbrt(t);

/// sRGB(0~255) → OKLab
function oklab(r: number, g: number, b: number) {
  // 先脱伽马
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = f(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = f(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = f(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/// 相对亮度（WCAG）。
/// ⚠️ **和 OKLab 的 L 不是一回事**，别拿 L 判可读性。
/// 门槛用 0.179——白字黑字对比度相等的那一点；用 0.5 的话，中灰 #828282
/// 的相对亮度只有 0.215，会被判成深色，整页翻成深底浅字。
const relLum = (r: number, g: number, b: number) => {
  const c = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};

export function toneOf(pixels: Uint8ClampedArray): Tone {
  const BINS = 36; // 每 10° 一格
  const weight = new Float64Array(BINS);
  const chroma = new Float64Array(BINS);
  let lumSum = 0;
  let n = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 128) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    lumSum += relLum(r, g, b);
    n++;

    const { L, a: A, b: B } = oklab(r, g, b);
    const c = Math.hypot(A, B);
    // ⚠️ 就是这一行：彩度 × 明度。少了明度，黑色噪点会赢
    const w = c * L;
    if (w <= 0) continue;
    let h = (Math.atan2(B, A) * 180) / Math.PI;
    if (h < 0) h += 360;
    const bin = Math.floor(h / (360 / BINS)) % BINS;
    weight[bin] += w;
    chroma[bin] += c * w;
  }

  let top = 0;
  for (let i = 1; i < BINS; i++) if (weight[i] > weight[top]) top = i;
  const light = n ? lumSum / n : 0.5;

  return {
    hue: top * (360 / BINS) + 360 / BINS / 2,
    chroma: weight[top] > 0 ? Math.min(0.16, chroma[top] / weight[top]) : 0.02,
    light,
    dark: light < 0.179,
  };
}

/// 把封面画到小画布上取色。
///
/// ⚠️ 图必须是**同源**的才读得到像素——跨域图画进 canvas 会把它污染，
/// `getImageData` 直接抛 SecurityError。封面走本站中转就是为了这个。
export function toneFromImage(url: string): Promise<Tone | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        // 32×32 够了：每个采样点等于原图一整块的平均值，
        // 尺度大约相当于一张卡片压住的面积
        const c = document.createElement("canvas");
        c.width = c.height = 32;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 32, 32);
        resolve(toneOf(ctx.getImageData(0, 0, 32, 32).data));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/// 播放页的背景。按主色相铺一层，深浅跟着封面走。
export function skyOf(t: Tone | null): string {
  if (!t) {
    return "linear-gradient(180deg, oklch(0.26 0.02 260) 0%, oklch(0.16 0.015 255) 100%)";
  }
  const c = Math.max(0.03, t.chroma * 0.9);
  return t.dark
    ? `radial-gradient(120% 70% at 50% 12%, oklch(0.34 ${c.toFixed(3)} ${t.hue.toFixed(0)}) 0%, transparent 62%), linear-gradient(180deg, oklch(0.22 ${(c * 0.7).toFixed(3)} ${t.hue.toFixed(0)}) 0%, oklch(0.13 ${(c * 0.4).toFixed(3)} ${t.hue.toFixed(0)}) 100%)`
    : `radial-gradient(120% 70% at 50% 12%, oklch(0.92 ${c.toFixed(3)} ${t.hue.toFixed(0)}) 0%, transparent 62%), linear-gradient(180deg, oklch(0.88 ${(c * 0.7).toFixed(3)} ${t.hue.toFixed(0)}) 0%, oklch(0.95 ${(c * 0.3).toFixed(3)} ${t.hue.toFixed(0)}) 100%)`;
}
