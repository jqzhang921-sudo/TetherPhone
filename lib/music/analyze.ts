"use client";

/// 从声波里量几个数出来。
///
/// 为什么不做曲谱：网易云的接口不给曲谱；而且曲谱描述的是**作曲**，
/// 不是此刻在放的这个录音——同一首歌的现场版和录音室版差得很远。
/// 量声波至少量的是真在响的那段。
///
/// ⚠️ **这不等于「听到」。** 拿到的是几个数，不是听觉体验。提示词里必须
/// 如实说清楚是什么，否则它会顺着「你能感受音乐」演下去——那正是要避免的。
///
/// ⚠️ 能做成这件事，是因为音频改成经本站转发之后变成了**同源**。
/// 跨域读音频数据要 CORS，而音乐 CDN 不给——所以直连 CDN 的话这条路是死的。
export type Features = {
  /// 每分钟多少拍。估的，不是精确值。
  bpm: number | null;
  /// 整体响度 0~1
  loud: number;
  /// 起伏：最响的一段比平均响多少倍
  swing: number;
  /// 明暗：过零率，高 = 亮/噪，低 = 暗/厚
  bright: number;
  /// 分成几段的响度，用来说「哪儿起来了」
  curve: number[];
};

/// 只取前面一段。
/// 分析整首要下整首，太贵；前 60 秒够看出快慢和基本气质了。
const SLICE = 1_200_000; // 128kbps 下大约 75 秒

export async function analyze(url: string): Promise<Features | null> {
  try {
    const r = await fetch(url, { headers: { Range: `bytes=0-${SLICE}` } });
    if (!r.ok && r.status !== 206) return null;
    const raw = await r.arrayBuffer();

    // ⚠️ 用 OfflineAudioContext 解码，**不要碰正在播放的那个 audio 元素**。
    // `createMediaElementSource` 一个元素只能调一次，而且调完整条播放链路
    // 就走 Web Audio 了——忘了接到 destination 就整个没声音。
    const Ctx =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx(1, 1, 44100);
    // 截断的 mp3 通常还能解出前面的帧；解不出就算了
    const buf = await ctx.decodeAudioData(raw).catch(() => null);
    if (!buf) return null;

    const pcm = buf.getChannelData(0);
    const rate = buf.sampleRate;
    if (pcm.length < rate * 3) return null;

    // ── 分帧算能量 ────────────────────────────────────────────
    const HOP = 1024;
    const frames = Math.floor(pcm.length / HOP);
    const energy = new Float32Array(frames);
    let zero = 0;
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      const at = f * HOP;
      for (let i = 0; i < HOP; i++) {
        const v = pcm[at + i];
        sum += v * v;
        // 过零：波形穿过零点的次数，越多越"亮"（高频多）
        if (i > 0 && (v >= 0) !== (pcm[at + i - 1] >= 0)) zero++;
      }
      energy[f] = Math.sqrt(sum / HOP);
    }

    const mean = energy.reduce((a, b) => a + b, 0) / frames;
    const peak = Math.max(...energy);

    // ── 起拍强度 → 自相关估 BPM ───────────────────────────────
    // 只留「比上一帧响」的那部分，鼓点会在这条曲线上冒出来
    const onset = new Float32Array(frames);
    for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);

    const fps = rate / HOP; // 每秒多少帧
    const lo = Math.floor(fps * 60 / 180); // 180 BPM
    const hi = Math.ceil(fps * 60 / 60); //  60 BPM
    let best = 0;
    let bestLag = 0;
    for (let lag = lo; lag <= hi && lag < frames / 2; lag++) {
      let acc = 0;
      for (let f = 0; f + lag < frames; f++) acc += onset[f] * onset[f + lag];
      if (acc > best) {
        best = acc;
        bestLag = lag;
      }
    }
    // 相关性太弱说明没有稳定节拍（纯人声、氛围乐），**就别硬报一个数**
    const bpm = bestLag && best > 0 ? Math.round((fps * 60) / bestLag) : null;

    // ── 响度曲线，切成 6 段 ───────────────────────────────────
    //
    // ⚠️ **不能拿单帧最大值做归一化。** 一个瞬间的尖峰（一下鼓、一声齿音）
    // 就能把其余五段全压扁，然后看着像「中间突然变响」——那是瞬态不是结构。
    // 按**段平均值里的最大值**归一，形状才是段落的形状。
    const N = 6;
    const seg: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = Math.floor((frames * i) / N);
      const b = Math.floor((frames * (i + 1)) / N);
      let s = 0;
      for (let f = a; f < b; f++) s += energy[f];
      seg.push(s / Math.max(1, b - a));
    }
    const top = Math.max(...seg) || 1;
    const curve = seg.map((v) => Number((v / top).toFixed(2)));

    return {
      bpm: bpm && bpm >= 55 && bpm <= 190 ? bpm : null,
      loud: Number(Math.min(1, mean * 4).toFixed(2)),
      swing: Number((peak / (mean || 1e-6)).toFixed(1)),
      bright: Number((zero / (frames * HOP)).toFixed(3)),
      curve,
    };
  } catch {
    return null;
  }
}

/// 把那几个数说成人话，喂给模型。
///
/// **只描述量到的东西，不替它下结论。** 写成「这首很悲伤」就是替它感受了，
/// 而那正是它没有的部分。
export function describe(f: Features): string {
  const bits: string[] = [];
  if (f.bpm) {
    const how = f.bpm < 80 ? "慢" : f.bpm < 110 ? "不快不慢" : f.bpm < 140 ? "偏快" : "很快";
    bits.push(`每分钟约 ${f.bpm} 拍（${how}）`);
  } else {
    bits.push("没量到稳定的节拍（可能是纯人声或者很散的编排）");
  }
  bits.push(f.loud > 0.6 ? "整体挺响" : f.loud > 0.3 ? "响度中等" : "整体很轻");
  bits.push(f.bright > 0.06 ? "高频多，听感偏亮" : f.bright > 0.03 ? "明暗居中" : "低频重，听感偏暗厚");
  if (f.swing > 3) bits.push("起伏很大，有明显的强弱段落");
  else if (f.swing < 1.6) bits.push("从头到尾比较平");

  // 说走向，不说某个点。
  // ⚠️ 「第 N 秒变响了」这种话很容易是瞬态造成的假象——比前后两半更稳。
  const c = f.curve;
  const head = (c[0] + c[1]) / 2;
  const tail = (c[c.length - 2] + c[c.length - 1]) / 2;
  const mid = (c[2] + c[3]) / 2;
  if (tail - head > 0.18) bits.push("越往后越满");
  else if (head - tail > 0.18) bits.push("开头最满，后面收下去");
  else if (mid - Math.max(head, tail) > 0.18) bits.push("中间那段最满");

  return bits.join("；");
}
