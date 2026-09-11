"use client";
import { useEffect, useRef, useState } from "react";

/// 液态玻璃可行性测试 · 第四轮：**不引用任何外部图的透镜**。
///
/// 三轮真机实测（iPad / Safari 605.1.15）：
///   1. `backdrop-filter: blur()` 好用
///   2. `backdrop-filter: url(#滤镜)` **完全不执行**
///      ⚠️ 而 `CSS.supports` 对它报 true——判据必须是眼睛看得见的东西
///      ⚠️ `url(#x) blur(2px)` 写一条里，url 不被认会把 **blur 一起丢掉**
///   3. 换成普通 `filter`：`feDisplacementMap` **能用**（噪声位移那块乱了），
///      但 **`feImage` 不能用**——SVG 数据 URI 整块不渲染，PNG 数据 URI 被忽略
///
/// 所以位移这条路通，倒下的只是「从外部图里读位移数据」。
/// 这一轮：**让滤镜自己算出位移图**——把元素自身形状糊开、取梯度（Sobel），
/// 得到的正是「边缘有正负、中间为零」的法线，那就是折射要的东西。
///
/// ⚠️ 梯度**必须用 `feConvolveMatrix preserveAlpha="true"`**，不能用
/// `feComposite operator="arithmetic"` 做差分：arithmetic **把 alpha 一起算**，
/// A 变成 0.5，预乘之后 RGB 被顶到 1，整张位移图饱和成亮黄。踩过。
///
/// ⚠️ 这条路的边界：只在「玻璃底下确实是壁纸」时成立——要把壁纸复制一份放进
/// 卡片里才有东西可扭。压在 app 内容上的玻璃（聊天输入条之类）复制不了背景，
/// 那儿只能继续用 backdrop-filter 的模糊。

const STRIPES = "repeating-linear-gradient(45deg,#000 0 10px,#fff 10px 20px)";

function Lens({ id, blur, amp, scale }: { id: string; blur: number; amp: number; scale: number }) {
  return (
    <filter id={id} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
      {/* 元素自己的形状 → 能做算术的灰度图（alpha 钉死 1） */}
      <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 0 1" result="s" />
      <feGaussianBlur in="s" stdDeviation={blur} result="b" />
      {/* 梯度。preserveAlpha 是关键：只动 RGB，不碰 alpha */}
      <feConvolveMatrix in="b" order="3" kernelMatrix="-1 0 1 -2 0 2 -1 0 1" divisor="1" bias="0.5" preserveAlpha="true" result="gx" />
      <feConvolveMatrix in="b" order="3" kernelMatrix="-1 -2 -1 0 0 0 1 2 1" divisor="1" bias="0.5" preserveAlpha="true" result="gy" />
      {/* 梯度很弱，围着 0.5 放大 */}
      <feComponentTransfer in="gx" result="ax">
        <feFuncR type="linear" slope={amp} intercept={0.5 - amp * 0.5} />
      </feComponentTransfer>
      <feComponentTransfer in="gy" result="ay">
        <feFuncG type="linear" slope={amp} intercept={0.5 - amp * 0.5} />
      </feComponentTransfer>
      {/* x 的放 R、y 的放 G，合成一张位移图 */}
      <feColorMatrix in="ax" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result="rx" />
      <feColorMatrix in="ay" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1" result="gg" />
      <feBlend in="rx" in2="gg" mode="screen" result="map" />
      <feDisplacementMap in="SourceGraphic" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" />
    </filter>
  );
}

export default function GlassLab() {
  const [info, setInfo] = useState<string[]>([]);
  const [perf, setPerf] = useState("");
  const [running, setRunning] = useState(false);
  const outer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInfo([
      `UA  ${navigator.userAgent.slice(0, 96)}`,
      `屏幕  ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    ]);
  }, []);

  /// 卡片里那层副本要**和外面那片图案对齐**，卡片才像是透明的。
  /// ⚠️ 偏移相对「画着图案的那个元素」，不是相对视口——上一版拿视口坐标算，
  /// 里外接不上还打出一片摩尔纹，看着像滤镜坏了，其实错的是原点。
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
    const t = setInterval(align, 300);
    window.addEventListener("resize", align);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", align);
    };
  }, []);

  const bench = async (mode: "lens" | "plain", n: number) => {
    const root = stage.current;
    if (!root) return 0;
    root.innerHTML = "";
    const cols = Math.ceil(Math.sqrt(n));
    const size = Math.floor(Math.min(root.clientWidth, root.clientHeight) / cols) - 6;
    for (let i = 0; i < n; i++) {
      const d = document.createElement("div");
      d.style.cssText = `position:absolute;left:${(i % cols) * (size + 6)}px;top:${Math.floor(i / cols) * (size + 6)}px;width:${size}px;height:${size}px;border-radius:12px;overflow:hidden`;
      const bg = document.createElement("div");
      bg.style.cssText =
        `position:absolute;inset:0;background:${STRIPES};` +
        (mode === "lens" ? "filter:url(#lens-card)" : "filter:blur(8px)");
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

  return (
    <main style={{ minHeight: "100dvh", padding: 12, fontFamily: "system-ui, sans-serif", background: "#fff", color: "#111" }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        {/* ⚠️ scale 不能大过 blur 撑出来的那圈软边：大了位移会从元素**外面**
            吸进空白，边上留一道硬线。blur 12 / scale 14 是试出来的一组。 */}
        <Lens id="lens-probe" blur={12} amp={4} scale={16} />
        <Lens id="lens-card" blur={16} amp={4} scale={10} />
        {/* 位移图本身长什么样，方便看是哪一步坏的 */}
        <filter id="map-only" x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 0 1" result="s" />
          <feGaussianBlur in="s" stdDeviation="8" result="b" />
          <feConvolveMatrix in="b" order="3" kernelMatrix="-1 0 1 -2 0 2 -1 0 1" divisor="1" bias="0.5" preserveAlpha="true" result="gx" />
          <feConvolveMatrix in="b" order="3" kernelMatrix="-1 -2 -1 0 0 0 1 2 1" divisor="1" bias="0.5" preserveAlpha="true" result="gy" />
          <feComponentTransfer in="gx" result="ax"><feFuncR type="linear" slope="4" intercept="-1.5" /></feComponentTransfer>
          <feComponentTransfer in="gy" result="ay"><feFuncG type="linear" slope="4" intercept="-1.5" /></feComponentTransfer>
          <feColorMatrix in="ax" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result="rx" />
          <feColorMatrix in="ay" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1" result="gg" />
          <feBlend in="rx" in2="gg" mode="screen" />
        </filter>
      </svg>

      <h1 style={{ fontSize: 16, margin: "0 0 4px", fontWeight: 600 }}>第四轮 · 滤镜自己算位移图</h1>
      <p style={{ fontSize: 12.5, lineHeight: 1.6, margin: "0 0 12px", color: "#555" }}>
        上一轮确认了：位移<b>能用</b>，倒下的是 <code>feImage</code>（读外部图）。
        这轮<b>不读任何图</b>——让滤镜取元素自己形状的梯度当位移图。
      </p>

      <div style={{ display: "flex", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
        <div>
          <div style={{ width: 150, height: 130, background: STRIPES, borderRadius: 10 }} />
          <div style={{ fontSize: 11, marginTop: 3, color: "#555" }}>对照（不扭）</div>
        </div>
        <div>
          {/* ⚠️ 滤镜区域比元素大 25%，不关进 overflow:hidden 的话会盖住旁边那块 */}
          <div style={{ width: 150, height: 130, overflow: "hidden", borderRadius: 10 }}>
            <div style={{ width: 150, height: 130, background: STRIPES, filter: "url(#lens-probe)" }} />
          </div>
          <div style={{ fontSize: 11, marginTop: 3, color: "#555" }}>① 透镜</div>
        </div>
        <div>
          <div style={{ width: 150, height: 130, overflow: "hidden", borderRadius: 10 }}>
            <div style={{ width: 150, height: 130, background: STRIPES, filter: "url(#map-only)" }} />
          </div>
          <div style={{ fontSize: 11, marginTop: 3, color: "#555" }}>② 它算的位移图</div>
        </div>
      </div>
      <p style={{ fontSize: 11.5, lineHeight: 1.7, color: "#777", margin: "0 0 16px" }}>
        ① <b>中间和对照一样、四边被向内压弯</b> = 成了。和对照一模一样 = 不通。
        <br />② 该是<b>中间橄榄色、只有四边有红绿</b>。整片亮黄或整片灰 = 算位移图这步就坏了。
      </p>

      <div ref={outer} style={{ position: "relative", background: STRIPES, borderRadius: 14, padding: 18, marginBottom: 6 }}>
        <div
          ref={card}
          style={{
            position: "relative",
            width: 300,
            height: 150,
            maxWidth: "100%",
            margin: "0 auto",
            borderRadius: 26,
            overflow: "hidden",
            boxShadow: "inset 0 1.5px 0 rgba(255,255,255,.9), inset 0 -1.5px 0 rgba(0,0,0,.18), 0 10px 28px rgba(0,0,0,.28)",
            border: "1px solid rgba(255,255,255,.6)",
          }}
        >
          <div ref={inner} style={{ position: "absolute", inset: 0, background: STRIPES, filter: "url(#lens-card)" }} />
          <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.42)" }} />
          <span style={{ position: "absolute", left: 16, top: 14, fontSize: 15, color: "#111", fontWeight: 500 }}>
            ③ 这行字要一直读得清
          </span>
        </div>
      </div>
      <p style={{ fontSize: 11.5, lineHeight: 1.6, color: "#777", margin: "0 0 16px" }}>
        ③ 只是个预览，<b>边上那道线我还没调掉</b>（位移在边缘吸到了元素外面）。
        这轮不看它——看 ① 和 ② 就够了。
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
        {running ? "跑着…" : "测性能（这次是真滤镜，数字算数）"}
      </button>
      {perf && <pre style={{ fontSize: 12, lineHeight: 1.7, margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{perf}</pre>}
      <div ref={stage} style={{ position: "relative", height: 200, marginTop: 10, borderRadius: 10, overflow: "hidden", background: "repeating-conic-gradient(#222 0 25%, #eee 0 50%) 0 0/18px 18px" }} />
    </main>
  );
}
