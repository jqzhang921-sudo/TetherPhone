"use client";
import { useEffect, useRef, useState } from "react";

/// 液态玻璃 · 第五轮：**不用滤镜，用合成**。
///
/// 前四轮在 iPad 上测完了，结论写在 docs/ROADMAP.md：SVG 滤镜做真折射这条路作废
/// （Safari 三条位移来源倒了两条半，而且就算能用也跑不动——12 块就 19ms）。
///
/// 这一版换思路：液态玻璃边缘的观感，本质是
/// **「靠近边的地方，背后的东西被压扁了」**。
/// 那就在边缘叠一层**缩小过的背景副本**——缩小 = 把更外面的内容挤进边上那条带，
/// 正是折射把外面的东西拉进来的效果——再用四条边的渐变遮罩把它收在边上。
/// 没有逐像素运算，只是多合成一层，代价接近零，而且哪个浏览器都能跑。
///
/// ⚠️ 是缩小不是放大。放大是把中间的东西摊开，看着像凸透镜底下压了张纸；
/// 缩小才是「边上能看到外面本来看不到的东西」，那才是玻璃厚度给的错觉。

const STRIPES = "repeating-linear-gradient(45deg,#000 0 13px,#fff 13px 26px)";

/// 一块玻璃。三层：底是真背景（直接透出去）、边是缩小的副本（只在四边露出来）、
/// 面是一层薄白把字托住。
function Glass({
  outer,
  w,
  h,
  edge,
  squeeze,
  label,
}: {
  /// 画着背景图案的那个元素——副本要和它对齐
  outer: React.RefObject<HTMLDivElement | null>;
  w: number;
  h: number;
  /// 边上那条带多宽
  edge: number;
  /// 副本缩到多少。越小，边上「挤进来」的东西越多
  squeeze: number;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);

  /// ⚠️ 副本的偏移相对**画着图案的那个元素**，不是相对视口。
  /// （搬进 App 就是 `.device`。）算错原点的症状是里外接不上，
  /// 还会和图案打出摩尔纹，看着像哪儿坏了。
  useEffect(() => {
    const align = () => {
      const b = box.current;
      const g = bg.current;
      const o = outer.current;
      if (!b || !g || !o) return;
      const r = b.getBoundingClientRect();
      const p = o.getBoundingClientRect();
      g.style.backgroundPosition = `${-(r.left - p.left)}px ${-(r.top - p.top)}px`;
    };
    align();
    const t = setInterval(align, 300);
    window.addEventListener("resize", align);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", align);
    };
  }, [outer]);

  const ringMask = [
    `linear-gradient(to right, #000 0, transparent ${edge}px)`,
    `linear-gradient(to left,  #000 0, transparent ${edge}px)`,
    `linear-gradient(to bottom,#000 0, transparent ${edge}px)`,
    `linear-gradient(to top,   #000 0, transparent ${edge}px)`,
  ].join(",");

  return (
    <div
      ref={box}
      style={{
        position: "relative",
        width: w,
        height: h,
        maxWidth: "100%",
        borderRadius: 26,
        overflow: "hidden",
        // ⚠️ 底下这层真模糊不能省。只有边缘那层的话，卡片本身是**不透明**的，
        // 边上再怎么挤也看不出是玻璃——边缘的戏得有个「透」的底才唱得起来。
        backdropFilter: "blur(7px) saturate(1.6)",
        WebkitBackdropFilter: "blur(7px) saturate(1.6)",
        background: "rgba(255,255,255,.26)",
        boxShadow:
          "inset 0 1.5px 0 rgba(255,255,255,.9), inset 0 -1.5px 0 rgba(0,0,0,.18), 0 10px 28px rgba(0,0,0,.28)",
        border: "1px solid rgba(255,255,255,.6)",
      }}
    >
      {/* 边：缩小的副本，四条渐变收在边上。
          多层遮罩默认相加，四角自然更重——和真玻璃一样，角上折射最狠。 */}
      {edge > 0 && (
        <div
          ref={bg}
          style={{
            position: "absolute",
            inset: 0,
            background: STRIPES,
            transform: `scale(${squeeze})`,
            transformOrigin: "center",
            maskImage: ringMask,
            WebkitMaskImage: ringMask,
            filter: "blur(0.6px)",
          }}
        />
      )}
      <span style={{ position: "absolute", left: 16, top: 13, fontSize: 14, color: "#111", fontWeight: 500 }}>
        {label}
      </span>
    </div>
  );
}

export default function GlassLab() {
  const outer = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState(30);
  const [squeeze, setSqueeze] = useState(0.86);
  const [info, setInfo] = useState<string[]>([]);
  const [perf, setPerf] = useState("");
  const [running, setRunning] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInfo([
      `UA  ${navigator.userAgent.slice(0, 96)}`,
      `屏幕  ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    ]);
  }, []);

  const bench = async (mode: "css" | "plain", n: number) => {
    const root = stage.current;
    if (!root) return 0;
    root.innerHTML = "";
    const cols = Math.ceil(Math.sqrt(n));
    const size = Math.floor(Math.min(root.clientWidth, root.clientHeight) / cols) - 6;
    const mask = [
      "linear-gradient(to right,#000 0,transparent 18px)",
      "linear-gradient(to left,#000 0,transparent 18px)",
      "linear-gradient(to bottom,#000 0,transparent 18px)",
      "linear-gradient(to top,#000 0,transparent 18px)",
    ].join(",");
    for (let i = 0; i < n; i++) {
      const d = document.createElement("div");
      d.style.cssText = `position:absolute;left:${(i % cols) * (size + 6)}px;top:${Math.floor(i / cols) * (size + 6)}px;width:${size}px;height:${size}px;border-radius:12px;overflow:hidden`;
      const inner = document.createElement("div");
      inner.style.cssText =
        `position:absolute;inset:0;background:${STRIPES};` +
        (mode === "css"
          ? `transform:scale(.86);-webkit-mask-image:${mask};mask-image:${mask};`
          : "filter:blur(8px);");
      d.appendChild(inner);
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
      out.push(`${n} 块　这套 ${await bench("css", n)}ms　普通模糊 ${await bench("plain", n)}ms`);
    }
    setPerf(out.join("\n") + "\n16.7 = 满 60fps。上一版滤镜在 iPad 上是 19 / 26 / 26。");
    setRunning(false);
  };

  return (
    <main style={{ minHeight: "100dvh", padding: 12, fontFamily: "system-ui, sans-serif", background: "#fff", color: "#111" }}>
      <h1 style={{ fontSize: 16, margin: "0 0 4px", fontWeight: 600 }}>第五轮 · 不用滤镜，用合成</h1>
      <p style={{ fontSize: 12.5, lineHeight: 1.6, margin: "0 0 12px", color: "#555" }}>
        滤镜那条路作废了。这版在边缘叠一层<b>缩小过的背景副本</b>——缩小 =
        把更外面的东西挤进边上那条带，正是玻璃厚度给的错觉。纯 CSS，无逐像素运算。
        <br />
        ① 和 ② 比：<b>边上那圈条纹变密、相位错开</b>，中间照旧。这就是全部效果。
      </p>

      <div ref={outer} style={{ position: "relative", background: STRIPES, borderRadius: 14, padding: 16, marginBottom: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
          <Glass outer={outer} w={300} h={120} edge={edge} squeeze={squeeze} label="① 这一版" />
          <Glass outer={outer} w={300} h={120} edge={0} squeeze={1} label="② 对照：只有模糊" />
        </div>
      </div>

      <div style={{ background: "#f4f4f6", borderRadius: 12, padding: 12, marginBottom: 10, fontSize: 12 }}>
        <label style={{ display: "block", marginBottom: 10 }}>
          边宽 {edge}px
          <input type="range" min={0} max={60} value={edge} onChange={(e) => setEdge(+e.target.value)} style={{ width: "100%", accentColor: "#2b6cf5" }} />
        </label>
        <label style={{ display: "block" }}>
          挤压 {squeeze.toFixed(2)}（越小，边上挤进来的越多）
          <input type="range" min={70} max={100} value={Math.round(squeeze * 100)} onChange={(e) => setSqueeze(+e.target.value / 100)} style={{ width: "100%", accentColor: "#2b6cf5" }} />
        </label>
        <p style={{ margin: "10px 0 0", color: "#777", lineHeight: 1.6 }}>
          两条都拉一拉，看哪一组顺眼——这就是以后主题里那两个数。
        </p>
      </div>

      <div style={{ background: "#f4f4f6", borderRadius: 12, padding: 11, fontSize: 11, lineHeight: 1.8, wordBreak: "break-all", marginBottom: 10 }}>
        {info.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>

      <button
        onClick={() => void run()}
        disabled={running}
        style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "none", background: running ? "#bbb" : "#2b6cf5", color: "#fff", fontSize: 15 }}
      >
        {running ? "跑着…" : "测性能"}
      </button>
      {perf && <pre style={{ fontSize: 12, lineHeight: 1.7, margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{perf}</pre>}
      <div ref={stage} style={{ position: "relative", height: 200, marginTop: 10, borderRadius: 10, overflow: "hidden", background: "repeating-conic-gradient(#222 0 25%, #eee 0 50%) 0 0/18px 18px" }} />
    </main>
  );
}
