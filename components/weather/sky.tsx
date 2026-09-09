"use client";
import { useEffect, useRef } from "react";
import type { Scene } from "@/lib/weather/wmo";

/// 天气画面。
///
/// 分工是固定的：**天空那层是 CSS 渐变**（大面积色块交给合成器，
/// 比每帧重画便宜得多），**canvas 只画会动的东西**。
///
/// 两块 canvas 不是随便分的：
/// - `fx` 每帧清空——星星、云、雪、雨丝都属于这层
/// - `glass` **从不清空**，只被慢慢重新蒙上雾。雨天那层"打湿的屏幕"靠它：
///   水珠用 destination-out 把雾擦掉、露出后面的天空，划过的地方留下痕迹。
///   每帧清空就没有痕迹了，也就没有"湿"这回事。
export function Sky({
  scene,
  day,
  wind,
}: {
  scene: Scene;
  day: boolean;
  /// km/h。云飘多快跟着它走——「微风就是天上的云吹动」。
  wind: number;
}) {
  const fxRef = useRef<HTMLCanvasElement>(null);
  const glassRef = useRef<HTMLCanvasElement>(null);
  const wet = scene === "rain" || scene === "thunder";

  useEffect(() => {
    const fx = fxRef.current;
    if (!fx) return;
    const host = fx.parentElement;
    if (!host) return;

    const ctx = fx.getContext("2d");
    const gctx = glassRef.current?.getContext("2d") ?? null;
    if (!ctx) return;

    // 手机上 DPR 常常是 3，按 3 倍开画布等于三倍的填充率。
    // 封到 2：肉眼看不出差别，掉帧看得出。
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── 各场景的粒子 ──────────────────────────────────────────
    type Star = { x: number; y: number; r: number; p: number; s: number };
    type Cloud = { x: number; y: number; w: number; h: number; a: number; v: number };
    type Flake = { x: number; y: number; r: number; vy: number; sway: number; p: number };
    type Streak = { x: number; y: number; len: number; vy: number; a: number };
    type Drop = { x: number; y: number; r: number; vy: number; wob: number; ws: number; stall: number };
    type Mote = { x: number; y: number; r: number; vx: number; vy: number; a: number };

    let stars: Star[] = [];
    let clouds: Cloud[] = [];
    let flakes: Flake[] = [];
    let streaks: Streak[] = [];
    let runners: Drop[] = [];
    let motes: Mote[] = [];

    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    // 雾的颜色：白天偏冷白，夜里偏蓝灰。纯白压在夜空上会像一层塑料。
    // ⚠️ 白天这层别太厚：它会把整块天空提亮，压在上面的字跟着遭殃。
    // 0.42 试过，太白了，天空的颜色全被吃掉。
    const frost = day ? "rgba(206, 220, 234, 0.30)" : "rgba(150, 168, 190, 0.34)";
    const frostThin = day ? "rgba(214, 226, 236, 0.020)" : "rgba(150, 168, 190, 0.018)";

    function seed() {
      const area = (W * H) / (390 * 700); // 以一台手机的屏幕为一份

      stars = Array.from({ length: Math.round(130 * area) }, () => ({
        x: Math.random() * W,
        y: Math.random() * H * 0.8,
        r: rand(0.4, 1.5),
        p: Math.random() * Math.PI * 2,
        s: rand(0.6, 2.2),
      }));

      clouds = Array.from({ length: Math.round(7 * area) + 3 }, (_, i) => ({
        x: Math.random() * W,
        // 越靠上的云画得越小越淡，做出远近
        y: rand(H * 0.04, H * 0.52),
        w: rand(W * 0.35, W * 0.85),
        h: rand(28, 68),
        a: rand(0.1, 0.34),
        v: rand(0.12, 0.5) * (1 + i * 0.05),
      }));

      flakes = Array.from({ length: Math.round(120 * area) }, () => {
        const r = rand(0.9, 3.4);
        return {
          x: Math.random() * W,
          y: Math.random() * H,
          r,
          // 大的近、掉得快；小的远、飘得慢。分层才有纵深
          vy: r * rand(9, 16),
          sway: rand(8, 26),
          p: Math.random() * Math.PI * 2,
        };
      });

      streaks = Array.from({ length: Math.round(90 * area) }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        len: rand(10, 26),
        vy: rand(520, 900),
        a: rand(0.06, 0.2),
      }));

      runners = Array.from({ length: Math.round(14 * area) + 4 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: rand(4.5, 10),
        vy: rand(14, 46),
        wob: Math.random() * Math.PI * 2,
        // 每颗自己的摆动频率。统一频率的话所有水珠会同步扭，一眼假
        ws: rand(1.4, 3.6),
        stall: 0,
      }));

      motes = Array.from({ length: Math.round(46 * area) }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: rand(0.6, 1.9),
        vx: rand(-6, 10),
        vy: rand(-9, -2),
        a: rand(0.12, 0.4),
      }));
    }

    /// 玻璃层重来一遍：整片蒙上雾，再随机擦几十个小水点当底子。
    function primeGlass() {
      if (!gctx) return;
      gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gctx.globalCompositeOperation = "source-over";
      gctx.clearRect(0, 0, W, H);
      gctx.fillStyle = frost;
      gctx.fillRect(0, 0, W, H);
      gctx.globalCompositeOperation = "destination-out";
      const n = Math.round((W * H) / 2400);
      for (let i = 0; i < n; i++) {
        gctx.beginPath();
        gctx.arc(Math.random() * W, Math.random() * H, rand(0.7, 2.6), 0, Math.PI * 2);
        gctx.fill();
      }
      gctx.globalCompositeOperation = "source-over";
    }

    function resize() {
      // ⚠️ **必须用 offsetWidth，不能用 getBoundingClientRect()。**
      // rect 返回的是**变换后**的尺寸，而 app 打开动画起手就是 scale(0.16)
      // ——挂载那一刻量到的是真实尺寸的 16%，画布就按那个建了。
      // 更坑的是 ResizeObserver 只盯布局盒子、不管 transform，动画结束后
      // 它不会再触发，画布就一直是糊的（放大 6 倍显示，像素块清晰可见）。
      W = Math.max(1, host!.offsetWidth);
      H = Math.max(1, host!.offsetHeight);
      for (const c of [fx, glassRef.current]) {
        if (!c) continue;
        c.width = W * dpr;
        c.height = H * dpr;
        c.style.width = `${W}px`;
        c.style.height = `${H}px`;
      }
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      primeGlass();
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // ── 画 ────────────────────────────────────────────────────

    /// 一团边缘化开的软色块。云、雾、月亮的光都是它堆出来的。
    ///
    /// ⚠️ **渐变必须在 translate/scale 之后建。** canvas 的渐变坐标是在
    /// 填充那一刻的用户空间里算的——先按 (x,y) 建好渐变、再 translate(x,y)，
    /// 渐变中心就跑到 (2x,2y) 去了，圆里填的全是渐变的透明外圈，
    /// 画面**整片是空的**。这个 bug 不报错、不掉帧，只是什么都看不见。
    function softBlob(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a: number, tint: string) {
      c.save();
      c.translate(x, y);
      c.scale(1, h / w);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, w / 2);
      g.addColorStop(0, tint.replace("$A", String(a)));
      g.addColorStop(0.55, tint.replace("$A", String(a * 0.55)));
      g.addColorStop(1, tint.replace("$A", "0"));
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, w / 2, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    let flash = 0;
    let nextFlash = 3 + Math.random() * 7;
    let shootAt = 6 + Math.random() * 14;
    let shoot: { x: number; y: number; t: number } | null = null;

    function frame(dt: number, t: number) {
      const c = ctx!;
      c.clearRect(0, 0, W, H);

      // ── 晴：白天是光，夜里是星 ──────────────────────────────
      if (scene === "clear" && day) {
        // 光晕缓慢呼吸。太阳不画成一个圆——圆是贴纸，光晕才是光
        const cx = W * 0.78;
        const cy = H * 0.14;
        const pulse = 1 + Math.sin(t * 0.4) * 0.05;
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, W * 0.62 * pulse);
        g.addColorStop(0, "rgba(255, 246, 214, 0.72)");
        g.addColorStop(0.28, "rgba(255, 238, 190, 0.24)");
        g.addColorStop(1, "rgba(255, 236, 190, 0)");
        c.fillStyle = g;
        c.fillRect(0, 0, W, H);

        // 光线：几道极慢旋转的楔形，叠加模式，像穿过空气的那种
        c.save();
        c.globalCompositeOperation = "lighter";
        c.translate(cx, cy);
        c.rotate(t * 0.012);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const w = 0.08 + ((i % 3) * 0.03);
          c.beginPath();
          c.moveTo(0, 0);
          c.arc(0, 0, W * 1.2, a - w, a + w);
          c.closePath();
          c.fillStyle = `rgba(255, 244, 208, ${0.028 + (i % 2) * 0.012})`;
          c.fill();
        }
        c.restore();

        // 光里的浮尘。有它，光才像有厚度的东西
        c.globalCompositeOperation = "lighter";
        for (const m of motes) {
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          if (m.y < -6) { m.y = H + 6; m.x = Math.random() * W; }
          if (m.x > W + 6) m.x = -6;
          if (m.x < -6) m.x = W + 6;
          c.beginPath();
          c.arc(m.x, m.y, m.r, 0, Math.PI * 2);
          c.fillStyle = `rgba(255, 250, 226, ${m.a * (0.6 + 0.4 * Math.sin(t * 2 + m.x))})`;
          c.fill();
        }
        c.globalCompositeOperation = "source-over";
      }

      if (scene === "clear" && !day) {
        for (const s of stars) {
          const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * s.s * 0.6 + s.p));
          c.beginPath();
          c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          c.fillStyle = `rgba(226, 236, 255, ${tw})`;
          c.fill();
        }
        // 月亮的光，不画月亮本身
        softBlob(c, W * 0.74, H * 0.13, W * 0.7, W * 0.7, 0.18, "rgba(214, 228, 255, $A)");

        // 偶尔一颗流星。够稀才像真的碰上
        shootAt -= dt;
        if (shootAt <= 0 && !shoot) {
          shoot = { x: rand(W * 0.15, W * 0.9), y: rand(H * 0.05, H * 0.4), t: 0 };
          shootAt = 14 + Math.random() * 26;
        }
        if (shoot) {
          shoot.t += dt;
          const k = shoot.t / 0.7;
          if (k >= 1) shoot = null;
          else {
            const x = shoot.x - k * 190;
            const y = shoot.y + k * 120;
            const g = c.createLinearGradient(x, y, x + 90, y - 58);
            g.addColorStop(0, "rgba(255,255,255,0)");
            g.addColorStop(1, `rgba(255,255,255,${0.85 * (1 - k)})`);
            c.strokeStyle = g;
            c.lineWidth = 1.6;
            c.beginPath();
            c.moveTo(x, y);
            c.lineTo(x + 90, y - 58);
            c.stroke();
          }
        }
      }

      // ── 云：多云 / 阴 / 雾 / 雨 都要有 ───────────────────────
      if (scene !== "clear" || !day) {
        const windK = 0.5 + Math.min(wind, 40) / 22;
        const heavy = scene === "overcast" || scene === "rain" || scene === "thunder";
        const tint = day
          ? heavy
            ? "rgba(88, 96, 112, $A)"
            : "rgba(255, 255, 255, $A)"
          : "rgba(120, 132, 156, $A)";
        for (const cl of clouds) {
          cl.x += cl.v * windK * dt * 14;
          if (cl.x - cl.w > W) cl.x = -cl.w;
          // 一朵云 = 三团叠在一起，单个椭圆太像药丸
          softBlob(c, cl.x, cl.y, cl.w, cl.h, cl.a, tint);
          softBlob(c, cl.x + cl.w * 0.24, cl.y + cl.h * 0.22, cl.w * 0.62, cl.h * 0.8, cl.a * 0.8, tint);
          softBlob(c, cl.x - cl.w * 0.26, cl.y + cl.h * 0.3, cl.w * 0.5, cl.h * 0.7, cl.a * 0.7, tint);
        }
      }

      // ── 雾 ────────────────────────────────────────────────
      if (scene === "fog") {
        for (let i = 0; i < 4; i++) {
          const y = H * (0.25 + i * 0.18);
          const x = ((t * (7 + i * 4)) % (W + 600)) - 300;
          softBlob(c, x, y, W * 1.3, 120, 0.16, "rgba(236, 240, 246, $A)");
        }
      }

      // ── 雪 ────────────────────────────────────────────────
      if (scene === "snow") {
        for (const f of flakes) {
          f.y += f.vy * dt;
          f.p += dt * 0.8;
          const x = f.x + Math.sin(f.p) * f.sway;
          if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; }
          c.beginPath();
          c.arc(x, f.y, f.r, 0, Math.PI * 2);
          // 近处的更实，远处的更淡——和大小一起做纵深
          c.fillStyle = `rgba(255,255,255,${0.28 + f.r * 0.16})`;
          c.fill();
        }
      }

      // ── 雨：玻璃上的水 + 玻璃外的雨丝 ──────────────────────
      if (wet && gctx) {
        // 1) 慢慢重新蒙雾，旧痕迹自己淡回去
        gctx.globalCompositeOperation = "source-over";
        gctx.fillStyle = frostThin;
        gctx.fillRect(0, 0, W, H);

        // 2) 水珠把雾擦掉，露出后面的天空。划过的地方留下一道
        gctx.globalCompositeOperation = "destination-out";
        for (const d of runners) {
          const y0 = d.y;

          // 真的水珠不是匀速滑下来的：挂住 → 攒够了 → 猛地窜一段 → 再挂住。
          // 少了这个，一屏平行匀速的竖线看着像百叶窗不像雨。
          if (d.stall > 0) {
            d.stall -= dt;
            d.vy = 0;
          } else {
            d.vy += 26 * dt; // 越滑越快，像真的水
            if (Math.random() < 0.006) d.stall = rand(0.25, 1.4);
          }

          d.y += d.vy * dt;
          d.wob += dt * d.ws;
          // 摆幅跟着珠子大小走——大的重，走得直；小的更容易被路径带偏
          const x = d.x + Math.sin(d.wob) * (14 / d.r);

          const steps = Math.max(1, Math.ceil((d.y - y0) / 2.5));
          for (let i = 0; i <= steps; i++) {
            const yy = y0 + ((d.y - y0) * i) / steps;
            // 尾迹比珠子细，不然拖成一条粗带子
            const rr = d.r * (0.3 + 0.7 * (i / steps));
            gctx.beginPath();
            gctx.arc(x, yy, rr, 0, Math.PI * 2);
            gctx.fill();
          }

          if (d.y - d.r > H) {
            d.y = -rand(10, 90);
            d.x = Math.random() * W;
            d.r = rand(4.5, 10);
            d.vy = rand(14, 46);
            d.ws = rand(1.4, 3.6);
            d.stall = 0;
          }
        }

        // 3) 偶尔冒一颗新的小水点，让整片玻璃一直在"接雨"
        if (Math.random() < 0.55) {
          for (let i = 0; i < 3; i++) {
            gctx.beginPath();
            gctx.arc(Math.random() * W, Math.random() * H, rand(0.7, 2.4), 0, Math.PI * 2);
            gctx.fill();
          }
        }

        // 4) 水珠边上一点高光，才不像"抠掉的洞"
        gctx.globalCompositeOperation = "source-over";
        for (const d of runners) {
          const x = d.x + Math.sin(d.wob) * (14 / d.r);
          gctx.beginPath();
          gctx.arc(x - d.r * 0.28, d.y - d.r * 0.3, d.r * 0.42, 0, Math.PI * 2);
          gctx.fillStyle = "rgba(255,255,255,0.16)";
          gctx.fill();
        }

        // 玻璃外面的雨丝，画在 fx 层
        c.strokeStyle = "rgba(226, 236, 246, 0.5)";
        c.lineWidth = 1;
        for (const s of streaks) {
          s.y += s.vy * dt;
          if (s.y > H + s.len) { s.y = -s.len; s.x = Math.random() * W; }
          c.globalAlpha = s.a;
          c.beginPath();
          c.moveTo(s.x, s.y);
          c.lineTo(s.x - 2, s.y + s.len);
          c.stroke();
        }
        c.globalAlpha = 1;
      }

      // ── 雷：整屏闪一下 ─────────────────────────────────────
      if (scene === "thunder") {
        nextFlash -= dt;
        if (nextFlash <= 0) {
          flash = 1;
          nextFlash = 4 + Math.random() * 9;
        }
        if (flash > 0) {
          flash = Math.max(0, flash - dt * 3.2);
          // 两段式衰减：先亮一下，再余一小段。一次线性淡出像开关灯
          const a = flash > 0.75 ? 0.5 : flash * 0.34;
          c.fillStyle = `rgba(240, 246, 255, ${a})`;
          c.fillRect(0, 0, W, H);
        }
      }
    }

    let raf = 0;
    let last = performance.now();
    let t = 0;

    function loop(now: number) {
      // 切走再回来会攒出一个巨大的 dt，粒子会瞬移。封在 50ms
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;
      frame(dt, t);
      raf = requestAnimationFrame(loop);
    }

    if (still) {
      // 用户在系统里关了动效：给一帧静的，不转
      frame(0, 0);
    } else {
      raf = requestAnimationFrame(loop);
    }

    // 页面藏起来时别空转
    const onVis = () => {
      if (still) return;
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [scene, day, wind, wet]);

  // ⚠️ 顺序 = 远近。天空和云最远、雨丝在中间、带水珠的玻璃贴在眼前，
  // 所以 glass 必须画在 fx **之后**（DOM 里靠后 = 层叠在上）。
  // 反过来的话云会浮在雨窗外面，看着像贴在玻璃上的一张纸。
  return (
    <>
      <canvas ref={fxRef} className="absolute inset-0 pointer-events-none" />
      {wet && <canvas ref={glassRef} className="absolute inset-0 pointer-events-none" />}
    </>
  );
}
