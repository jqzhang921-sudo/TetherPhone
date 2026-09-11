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

/// 这张图上，玻璃最薄能到多薄还保证字读得了。
///
/// 整条搬自 phone-ai-assistant 那次的教训，有两个反直觉的点：
///
/// ⚠️ **「图有多花」和「图能有多亮」是两件事。** 亮度标准差（busyness）量的是花不花，
/// 不能拿来定可读性：一张黑底骷髅壁纸绝大多数像素是黑的、标准差只有 0.05，
/// 可它有一块接近纯白的高光——一小块高光推不高标准差，却足以让一整行字消失。
/// 所以要单独看**亮端和暗端**。
///
/// ⚠️ **峰值取「第三亮」而不是 p95。** 每个采样点已经是原图一整块的平均值，
/// 那个尺度约等于一张卡片压住的面积；p95（32×32 时是 1024 个里第 51 亮）完全够不着，
/// 实测算出来的 alpha 和"不管亮端"一模一样。
/// 网格有多大由调用方按模糊半径定，所以「第三亮」在粗网格上自然就松——
/// 这正是想要的：玻璃底下本来就是被糊平的那一版。
///
/// 注意这是**保守**估计：backdrop 的模糊会把高光和周围拉平，实际比这更容易读。
function grayOf(lum: number) {
  // 相对亮度反解成灰度 sRGB。逐通道不可逆，但灰度是标量问题，这样够用。
  const inv = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  return Math.max(0, Math.min(255, inv(Math.max(0, Math.min(1, lum))) * 255));
}
const lumOfGray = (g: number) => {
  const x = g / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export function minGlassAlpha(pixels: Uint8ClampedArray, dark: boolean): number {
  const lums: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const c = (v: number) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    lums.push(0.2126 * c(pixels[i]) + 0.7152 * c(pixels[i + 1]) + 0.0722 * c(pixels[i + 2]));
  }
  if (lums.length < 8) return dark ? 0.46 : 0.5;
  lums.sort((a, b) => a - b);
  const trough = lums[2];
  const peak = lums[lums.length - 3];

  // 玻璃本体和字的颜色（和 globals.css 里那两套对齐）
  const tint = dark ? lumOfGray(74) : 1;
  const ink = dark ? 0.9 : 0.042;

  const ok = (a: number) =>
    [peak, trough].every((bg) => {
      const out = lumOfGray(grayOf(tint) * a + grayOf(bg) * (1 - a));
      return ratio(ink, out) >= 4.5;
    });

  // 二分求「还能读」的最小 alpha。够不着 4.5 就退回一个保守值，
  // **不要为了通透牺牲能不能读**。
  let lo = 0.2;
  let hi = 0.95;
  if (!ok(hi)) return hi;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return Math.round(hi * 100) / 100;
}

/// 一次跑完：取色 + 算玻璃下限。
///
/// ⚠️ **必须按 `background-size: cover` 的裁法取样，不能整张图缩进方画布。**
/// 屏幕是竖的、图常常是横的，cover 会把左右两边切掉。整张图取样的话，
/// 一块被切掉、永远不出现在屏幕上的高光照样会把玻璃顶厚——玻璃为一块
/// 谁也看不见的白斑变闷，还找不出原因。
///
/// ⚠️ **取样的精细度要跟着模糊走。**
/// 玻璃底下不是原图，是被 `backdrop-filter` 糊过的版本。模糊开到七八十像素时，
/// 原图的亮暗差早被抹平了，还按 32×32 去算峰谷，算出来的下限会**高得离谱**
/// ——那会把「晕染」那种低浓度玻璃直接顶死。
/// 网格边长按「一格约等于一个模糊半径」来定，低于 3 就没意义了。
export function readImage(
  url: string,
  aspect = 9 / 19.5,
  /// 模糊半径（px）和机身宽度，用来决定取样多细。不给就按老样子 32×32。
  blur = 0,
  deviceW = 390,
): Promise<{ tone: Tone; minAlpha: number } | null> {
  const n = blur > 0 ? Math.max(3, Math.min(32, Math.round(deviceW / Math.max(8, blur * 1.4)))) : 32;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = n;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);

        // cover：按屏幕的宽高比从原图中间切一块出来，再缩成 32×32。
        // 方画布会把这块拉变形，无所谓——我们只统计亮度，不看形状。
        const iw = img.naturalWidth || 1;
        const ih = img.naturalHeight || 1;
        let sw = iw;
        let sh = iw / aspect;
        if (sh > ih) {
          sh = ih;
          sw = ih * aspect;
        }
        ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, n, n);

        const px = ctx.getImageData(0, 0, n, n).data;
        const tone = toneOf(px);
        resolve({ tone, minAlpha: minGlassAlpha(px, tone.dark) });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/// 内置壁纸（CSS 渐变）的玻璃下限。
///
/// canvas 画不了 CSS 渐变，所以不能像照片那样采样。但**渐变的极值被它的色标夹住**：
/// 每一层都是凸混合，合成结果的每个通道都落在参与色标的最小值和最大值之间。
/// 所以取所有色标的**逐通道** min / max 当谷值和峰值，是一个严格的、偏保守的界。
///
/// oklch → sRGB 这一步交给浏览器：`ctx.fillStyle = "oklch(...)"` 之后画一个像素读回来，
/// 比自己写一遍逆变换可靠。
function rgbOf(css: string): [number, number, number] | null {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // ⚠️ 认不出来的颜色，fillStyle 会**保持原样**而不是报错。
  // 先塞一个哨兵，赋值后没变就说明这个浏览器不认识它。
  ctx.fillStyle = "#010203";
  ctx.fillStyle = css;
  if (ctx.fillStyle === "#010203") return null;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

export function floorOfCss(css: string, dark: boolean): number {
  const stops = css.match(/oklch\([^)]*\)/g) ?? [];
  const lo: [number, number, number] = [255, 255, 255];
  const hi: [number, number, number] = [0, 0, 0];
  let n = 0;
  for (const s of stops) {
    const rgb = rgbOf(s);
    if (!rgb) continue;
    n++;
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], rgb[i]);
      hi[i] = Math.max(hi[i], rgb[i]);
    }
  }
  // 一个色标都解析不出来（老浏览器不认 oklch）：退回一个保守值，
  // **别让滑杆在算不出下限的时候变得没人管**。
  if (n === 0) return dark ? 0.46 : 0.5;

  // 拼一小片"只有两种颜色"的像素喂给同一套算法：各 8 个，
  // 这样"第三亮/第三暗"取到的正好就是这两端。
  const px = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < 16; i++) {
    const c = i < 8 ? lo : hi;
    px[i * 4] = c[0];
    px[i * 4 + 1] = c[1];
    px[i * 4 + 2] = c[2];
    px[i * 4 + 3] = 255;
  }
  return minGlassAlpha(px, dark);
}
