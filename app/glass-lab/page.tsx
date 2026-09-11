"use client";
import { useEffect, useRef, useState } from "react";

/// 液态玻璃的可行性测试页。**不是产品的一部分**，是给真机看的一张白纸。
///
/// 要回答的只有一个问题：Safari 认不认 `backdrop-filter: url(#SVG滤镜)`。
/// Chrome 认（本机实测过），Safari 一直是未知数——而这个 App 的目标里有 iPhone。
///
/// ⚠️ **不能靠 `CSS.supports` 下结论。** 浏览器可以「认得这个写法」但静默不执行，
/// 那时 supports 返回 true、屏幕上什么都没发生。所以判据必须是**看得见的**：
/// 下面那块透镜**不带任何背景色**——滤镜生效就会看到条纹被掰弯，
/// 不生效就是一块完全看不见的透明方块，条纹笔直穿过去。二选一，不会看错。
const W = 200;
const H = 150;
const EDGE = 34;

const MAP = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
 <defs>
  <linearGradient id="l" x1="0" x2="1"><stop offset="0" stop-color="rgb(255,128,0)"/><stop offset="1" stop-color="rgb(128,128,0)"/></linearGradient>
  <linearGradient id="r" x1="0" x2="1"><stop offset="0" stop-color="rgb(128,128,0)"/><stop offset="1" stop-color="rgb(0,128,0)"/></linearGradient>
 </defs>
 <rect width="100%" height="100%" fill="rgb(128,128,0)"/>
 <rect width="${EDGE}" height="100%" fill="url(#l)"/>
 <rect x="${W - EDGE}" width="${EDGE}" height="100%" fill="url(#r)"/>
</svg>`;

const LENS = `url(#lens)`;
const PLAIN = `blur(20px) saturate(1.9)`;

export default function GlassLab() {
  const [info, setInfo] = useState<Record<string, string>>({});
  const [perf, setPerf] = useState<string>("");
  const [running, setRunning] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supports = (v: string) =>
      CSS.supports("backdrop-filter", v) || CSS.supports("-webkit-backdrop-filter", v);
    const probe = document.createElement("div");
    probe.style.backdropFilter = LENS;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).backdropFilter;
    probe.remove();
    setInfo({
      浏览器: navigator.userAgent.slice(0, 110),
      屏幕: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
      "supports blur()": String(supports("blur(4px)")),
      "supports url()": String(supports("url(#lens)")),
      "计算值": computed || "(空)",
    });
  }, []);

  /// 每帧强制重绘背景，逼合成器重算 backdrop。测的是中位帧时间。
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
        `width:${size}px;height:${size}px;border-radius:14px;background:rgba(255,255,255,.28);` +
        `backdrop-filter:${mode === "lens" ? LENS : PLAIN};-webkit-backdrop-filter:${mode === "lens" ? LENS : PLAIN}`;
      root.appendChild(d);
    }
    await new Promise((r) => setTimeout(r, 400));
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
      const lens = await bench("lens", n);
      const plain = await bench("plain", n);
      out.push(`${n} 块：透镜 ${lens}ms · 现有 ${plain}ms`);
    }
    setPerf(out.join("\n") + "\n（16.7 = 满 60fps，越大越掉帧）");
    setRunning(false);
  };

  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: 16,
        fontFamily: "system-ui, sans-serif",
        background: "repeating-linear-gradient(45deg,#111 0 11px,#fafafa 11px 22px)",
        color: "#111",
      }}
    >
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <filter id="lens" x="0" y="0" width="100%" height="100%" primitiveUnits="objectBoundingBox">
          <feImage
            href={`data:image/svg+xml;utf8,${encodeURIComponent(MAP)}`}
            preserveAspectRatio="none"
            x="0"
            y="0"
            width="1"
            height="1"
            result="m"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="m"
            scale="42"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>

      <div style={{ background: "#fff", borderRadius: 14, padding: 14, marginBottom: 16 }}>
        <h1 style={{ fontSize: 17, margin: "0 0 6px", fontWeight: 600 }}>液态玻璃 · 真机测试</h1>
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, color: "#444" }}>
          看下面 <b>A</b> 那一块：条纹被<b>掰弯</b>了就是支持；条纹<b>笔直穿过去</b>、
          方块像不存在一样，就是不支持。A 刻意没有背景色，所以不会有第三种可能。
        </p>
      </div>

      {/* A：只有位移滤镜，没有任何背景色 */}
      <div style={{ position: "relative", height: 170, marginBottom: 10 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 26,
            backdropFilter: LENS,
            WebkitBackdropFilter: LENS,
          }}
        />
        <span style={tag}>A · 透镜（无底色）</span>
      </div>

      {/* B：我们现在这套，做对照 */}
      <div style={{ position: "relative", height: 170, marginBottom: 16 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 26,
            background: "rgba(255,255,255,.5)",
            backdropFilter: PLAIN,
            WebkitBackdropFilter: PLAIN,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.75)",
            border: "1px solid rgba(255,255,255,.6)",
          }}
        />
        <span style={tag}>B · 现在这套（对照）</span>
      </div>

      {/* C：两样都上，真要做的话长这样 */}
      <div style={{ position: "relative", height: 170, marginBottom: 16 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 26,
            background: "rgba(255,255,255,.22)",
            backdropFilter: `${LENS} blur(2px)`,
            WebkitBackdropFilter: `${LENS} blur(2px)`,
            boxShadow:
              "inset 0 1.5px 0 rgba(255,255,255,.85), inset 0 -1.5px 0 rgba(0,0,0,.16), 0 10px 28px rgba(0,0,0,.2)",
            border: "1px solid rgba(255,255,255,.55)",
          }}
        />
        <span style={tag}>C · 折射 + 高光（成品大概这样）</span>
      </div>

      <div style={{ background: "#fff", borderRadius: 14, padding: 14, marginBottom: 16 }}>
        <button
          onClick={() => void run()}
          disabled={running}
          style={{
            width: "100%",
            padding: "11px 0",
            borderRadius: 10,
            border: "none",
            background: running ? "#bbb" : "#2b6cf5",
            color: "#fff",
            fontSize: 15,
          }}
        >
          {running ? "跑着…" : "测一下这台机器扛不扛得住"}
        </button>
        {perf && (
          <pre style={{ fontSize: 12, lineHeight: 1.7, margin: "12px 0 0", whiteSpace: "pre-wrap" }}>
            {perf}
          </pre>
        )}
        <div ref={stage} style={{ position: "relative", height: 300, marginTop: 12, borderRadius: 10, overflow: "hidden", background: "repeating-conic-gradient(#222 0 25%, #eee 0 50%) 0 0/20px 20px" }} />
      </div>

      <div style={{ background: "#fff", borderRadius: 14, padding: 14, fontSize: 12, lineHeight: 1.8 }}>
        {Object.entries(info).map(([k, v]) => (
          <div key={k} style={{ wordBreak: "break-all" }}>
            <b>{k}：</b>
            {v}
          </div>
        ))}
      </div>
    </main>
  );
}

const tag: React.CSSProperties = {
  position: "absolute",
  left: 10,
  bottom: 8,
  fontSize: 12,
  padding: "3px 8px",
  borderRadius: 8,
  background: "rgba(0,0,0,.72)",
  color: "#fff",
};
