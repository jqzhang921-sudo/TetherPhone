"use client";
import { useEffect, useRef, useState } from "react";

/// 液态玻璃可行性测试 · 第三轮：改用**普通 filter**。
///
/// 前两轮实测（iPad / Safari 605.1.15）：
///   - `backdrop-filter: blur()` 好用
///   - `backdrop-filter: url(#滤镜)` **完全不执行**，断在这一步。
///     所以不是 feImage 的锅，换程序生成位移图也救不回来
///   - ⚠️ `CSS.supports('backdrop-filter','url(#x)')` 报 **true** 而实际无效
///   - ⚠️ `url(#x) blur(2px)` 写一条里，url 不被认会把 **blur 一起丢掉**
///
/// 这一轮换思路：折射的本质是「把背后的像素挪位置」。既然动不了*背后*，
/// 就**把壁纸复制一份放进卡片里**，对副本用**普通 filter**——
/// 普通 filter 和 backdrop-filter 是两套实现。桌面上玻璃底下就是壁纸，替换成立。
///
/// ⚠️ 上一版这页自己有 bug：filter 写了 `primitiveUnits="objectBoundingBox"`，
/// Chrome 上就是一片空白。**feImage 必须配 `userSpaceOnUse` + 显式像素尺寸**，
/// 所以下面每个方块都是定死的大小——生产里就是按卡片尺寸生成几个滤镜。
///
/// ⚠️ 这条路有个边界：它只在「玻璃底下确实是壁纸」时成立。压在 app 内容上的
/// 那些玻璃（聊天输入条之类）没法复制背景，那儿只能继续用 backdrop-filter 的模糊。

const S = 118; // 探针方块边长
const CW = 300; // 演示卡片
const CH = 150;
const STRIPES = "repeating-linear-gradient(45deg,#000 0 8px,#fff 8px 16px)";

/// 位移图：R 管左右、G 管上下，128 = 不动。四边做斜坡 = 向内折。
function mapSvg(w: number, h: number, e: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs>
<linearGradient id="a" x1="0" x2="1"><stop offset="0" stop-color="rgb(255,128,0)"/><stop offset="1" stop-color="rgb(128,128,0)"/></linearGradient>
<linearGradient id="b" x1="0" x2="1"><stop offset="0" stop-color="rgb(128,128,0)"/><stop offset="1" stop-color="rgb(0,128,0)"/></linearGradient>
</defs>
<rect width="100%" height="100%" fill="rgb(128,128,0)"/>
<rect width="${e}" height="100%" fill="url(#a)"/>
<rect x="${w - e}" width="${e}" height="100%" fill="url(#b)"/>
</svg>`;
}

/// 同一张图画成 PNG。**两种都试**：feImage 里塞 SVG 数据 URI 是更花哨的那条，
/// 位图更老更笨，Safari 上更可能通。
///
/// ⚠️ 斜坡要**缓入缓出**，不能是直线。直线斜坡在起点终点各有一个折角，
/// 折射出来是两道硬边，看着像贴了条胶带，不像一块有厚度的玻璃。
function mapPng(w: number, h: number, e: number) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext("2d");
  if (!cx) return "";
  cx.fillStyle = "rgb(128,128,0)";
  cx.fillRect(0, 0, w, h);
  const ramp = (x0: number, x1: number, from: number, to: number) => {
    const g = cx.createLinearGradient(x0, 0, x1, 0);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const k = t * t * (3 - 2 * t); // smoothstep
      g.addColorStop(t, `rgb(${Math.round(from + (to - from) * k)},128,0)`);
    }
    cx.fillStyle = g;
    cx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), h);
  };
  ramp(0, e, 255, 128);
  ramp(w, w - e, 0, 128);
  return cv.toDataURL("image/png");
}

export default function GlassLab() {
  const [png, setPng] = useState({ probe: "", card: "" });
  const [info, setInfo] = useState<string[]>([]);
  const [perf, setPerf] = useState("");
  const [running, setRunning] = useState(false);
  const outer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // ⚠️ 边宽和位移都不能大。第一版 边42/位移46，300 宽的卡有近三成面积在动，
    // 出来是一片摩尔纹不是玻璃。24/20 才像一块有厚度的板。
    setPng({ probe: mapPng(S, S, 26), card: mapPng(CW, CH, 24) });
    setInfo([
      `UA  ${navigator.userAgent.slice(0, 96)}`,
      `屏幕  ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
      `supports filter:url()  ${CSS.supports("filter", "url(#x)")}`,
    ]);
  }, []);

  /// 卡片里那层副本要**和外面那片图案对齐**，卡片才像是透明的。
  ///
  /// ⚠️ 偏移要相对**画着那片图案的那个元素**，不是相对视口。
  /// 第一版拿视口坐标去算，结果里外接不上、还和斜条纹打出一片摩尔纹，
  /// 看着像滤镜坏了——其实滤镜是对的，错的是原点。
  /// （搬到 App 里时，这个原点就是 .device。）
  useEffect(() => {
    const align = () => {
      const c = card.current;
      const i = inner.current;
      const o = outer.current;
      if (!c || !i || !o) return;
      const r = c.getBoundingClientRect();
      const b = o.getBoundingClientRect();
      i.style.backgroundPosition = `${-(r.left - b.left)}px ${-(r.top - b.top)}px`;
    };
    align();
    const t = setInterval(align, 250);
    window.addEventListener("scroll", align, { passive: true });
    window.addEventListener("resize", align);
    return () => {
      clearInterval(t);
      window.removeEventListener("scroll", align);
      window.removeEventListener("resize", align);
    };
  }, [png.card]);

  const bench = async (mode: "lens" | "plain", n: number) => {
    const root = stage.current;
    if (!root) return 0;
    root.innerHTML = "";
    const cols = Math.ceil(Math.sqrt(n));
    const size = Math.floor(Math.min(root.clientWidth, root.clientHeight) / cols) - 6;
    for (let i = 0; i < n; i++) {
      const d = document.createElement("div");
      d.style.cssText =
        `position:absolute;left:${(i % cols) * (size + 6)}px;top:${Math.floor(i / cols) * (size + 6)}px;` +
        `width:${size}px;height:${size}px;border-radius:12px;overflow:hidden`;
      const bg = document.createElement("div");
      bg.style.cssText =
        `position:absolute;inset:0;background:${STRIPES};` +
        (mode === "lens" ? "filter:url(#f-png)" : "filter:blur(8px)");
      d.appendChild(bg);
      root.appendChild(d);
    }
    await new Promise((r) => setTimeout(r, 350));
    const times: number[] = [];
    let last = performance.now();
    await new Promise<void>((res) => {
      let k = 0;
      const step = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        root.style.backgroundPosition = `${k * 3}px 0`;
        if (++k < 60) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });
    root.innerHTML = "";
    const s = times.slice(8).sort((a, b) => a - b);
    return +s[Math.floor(s.length / 2)].toFixed(1);
  };

  const run = async () => {
    setRunning(true);
    setPerf("跑着…");
    const out: string[] = [];
    for (const n of [12, 24, 48]) {
      out.push(`${n} 块　透镜 ${await bench("lens", n)}ms　普通模糊 ${await bench("plain", n)}ms`);
    }
    setPerf(out.join("\n") + "\n16.7 = 满 60fps，越大越掉帧");
    setRunning(false);
  };

  const probes = [
    { id: "f-turb", name: "A 噪声位移", hint: "不引用任何图" },
    { id: "f-svg", name: "B 位移图(SVG)", hint: "feImage 塞 SVG" },
    { id: "f-png", name: "C 位移图(PNG)", hint: "feImage 塞位图" },
  ];

  return (
    <main style={{ minHeight: "100dvh", padding: 12, fontFamily: "system-ui, sans-serif", background: "#fff", color: "#111" }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <filter id="f-turb" x="0" y="0" width="1" height="1">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="5" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="26" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="f-svg" x="0" y="0" width="1" height="1" primitiveUnits="userSpaceOnUse">
          <feImage href={`data:image/svg+xml;utf8,${encodeURIComponent(mapSvg(S, S, 34))}`} x="0" y="0" width={S} height={S} result="m" />
          <feDisplacementMap in="SourceGraphic" in2="m" scale="40" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {png.probe && (
          <filter id="f-png" x="0" y="0" width="1" height="1" primitiveUnits="userSpaceOnUse">
            <feImage href={png.probe} x="0" y="0" width={S} height={S} result="m" />
            <feDisplacementMap in="SourceGraphic" in2="m" scale="40" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        )}
        {png.card && (
          <filter id="f-card" x="0" y="0" width="1" height="1" primitiveUnits="userSpaceOnUse">
            <feImage href={png.card} x="0" y="0" width={CW} height={CH} result="m" />
            <feDisplacementMap in="SourceGraphic" in2="m" scale="20" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        )}
      </svg>

      <h1 style={{ fontSize: 16, margin: "0 0 4px", fontWeight: 600 }}>第三轮 · 改用普通 filter</h1>
      <p style={{ fontSize: 12.5, lineHeight: 1.6, margin: "0 0 10px", color: "#555" }}>
        上一轮断在 <code>backdrop-filter: url()</code>。这轮不动「背后」，而是
        <b>把条纹复制一份放进方块里</b>，用<b>普通 filter</b> 去扭副本。
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
        <div>
          <div style={{ width: S, height: S, background: STRIPES, borderRadius: 10 }} />
          <div style={{ fontSize: 11, marginTop: 3, color: "#555" }}>对照（不扭）</div>
        </div>
        {probes.map((p) => (
          <div key={p.id}>
            <div style={{ width: S, height: S, background: STRIPES, borderRadius: 10, filter: `url(#${p.id})` }} />
            <div style={{ fontSize: 11, marginTop: 3, color: "#555" }}>{p.name}</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11.5, lineHeight: 1.6, color: "#777", margin: "0 0 14px" }}>
        和「对照」比：<b>条纹被推开/错位</b> = 这一环通。<b>和对照一模一样</b> = 不通。
        A 不引用图，B/C 引用图（一个 SVG 一个位图）。
      </p>

      {/* 真做出来的样子 */}
      <div ref={outer} style={{ position: "relative", background: STRIPES, borderRadius: 14, padding: 18, marginBottom: 4 }}>
        <div
          ref={card}
          style={{
            position: "relative",
            width: CW,
            height: CH,
            maxWidth: "100%",
            margin: "0 auto",
            borderRadius: 26,
            overflow: "hidden",
            boxShadow: "inset 0 1.5px 0 rgba(255,255,255,.9), inset 0 -1.5px 0 rgba(0,0,0,.18), 0 10px 28px rgba(0,0,0,.28)",
            border: "1px solid rgba(255,255,255,.6)",
          }}
        >
          <div ref={inner} style={{ position: "absolute", inset: 0, background: STRIPES, filter: "url(#f-card) blur(1.5px)" }} />
          <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.42)" }} />
          <span style={{ position: "absolute", left: 16, top: 14, fontSize: 15, color: "#111", fontWeight: 500 }}>
            D · 这行字要一直读得清
          </span>
        </div>
      </div>
      <p style={{ fontSize: 11.5, lineHeight: 1.6, color: "#777", margin: "0 0 14px" }}>
        D 里的条纹和外面<b>接得上、但四边被掰弯</b> = 成了。
        <b>整块对不齐、或者和外面完全一样</b> = 这条路也不行。
      </p>

      <div style={{ background: "#f4f4f6", borderRadius: 12, padding: 11, fontSize: 11, lineHeight: 1.8, wordBreak: "break-all", marginBottom: 12 }}>
        {info.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>

      <button
        onClick={() => void run()}
        disabled={running}
        style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "none", background: running ? "#bbb" : "#2b6cf5", color: "#fff", fontSize: 15 }}
      >
        {running ? "跑着…" : "测性能（上面通了才有意义）"}
      </button>
      {perf && <pre style={{ fontSize: 12, lineHeight: 1.7, margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{perf}</pre>}
      <div ref={stage} style={{ position: "relative", height: 200, marginTop: 10, borderRadius: 10, overflow: "hidden", background: "repeating-conic-gradient(#222 0 25%, #eee 0 50%) 0 0/18px 18px" }} />
    </main>
  );
}
