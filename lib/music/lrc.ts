/// LRC 歌词。
///
/// 网易云给的是一整块文本，每行前面挂着时间戳：`[00:12.34]词`。
/// 要能跟着播放高亮，就得把它拆成「秒 + 一行词」。
///
/// ⚠️ **有的歌根本没有时间戳**（纯文本歌词，或者只有翻译）。那不是坏了，
/// 是这首就这样——所以解析不出时间戳时要能退回「整块显示、不高亮」，
/// 而不是显示「没有歌词」。
export type Line = { t: number; text: string };

const STAMP = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(raw: string): Line[] {
  const out: Line[] = [];
  for (const line of raw.split(/\r?\n/)) {
    // ⚠️ 一行可能挂好几个时间戳（副歌复用同一句），每个都要算一条
    const stamps = [...line.matchAll(STAMP)];
    if (!stamps.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    // 纯时间戳的空行是间奏标记，留着会在歌词里插一堆空白
    if (!text) continue;
    for (const m of stamps) {
      const ms = m[3] ? Number(m[3].padEnd(3, "0")) : 0;
      out.push({ t: Number(m[1]) * 60 + Number(m[2]) + ms / 1000, text });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/// 当前唱到第几行。**取最后一个「已经开始」的**，不是最近的——
/// 最近的会在一句唱到一半时提前跳到下一句。
export function lineAt(lines: Line[], at: number): number {
  let i = -1;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].t <= at + 0.2) i = k;
    else break;
  }
  return i;
}

/// 没有时间戳时，把原文拆成能显示的几行。
export const plainLines = (raw: string) =>
  raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\[[^\]]*\]/g, "").trim())
    .filter(Boolean);
