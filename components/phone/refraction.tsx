"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";

/// 玻璃边上那一点折射。
///
/// 五轮真机测试的产物（过程记在 docs/ROADMAP.md）。结论是：**真折射做不出来**
/// ——Safari 上 `backdrop-filter: url()` 整个不执行，`feImage` 不渲染，
/// `feConvolveMatrix` 输出恒为零；就算能用，那套滤镜在 iPad 上 12 块就 19ms。
///
/// 这里用的是合成：在边缘叠一层**缩小过的壁纸副本**。缩小 = 把更外面的内容
/// 挤进边上那条带，正是玻璃有厚度时你会看到的东西；再用四条边的渐变遮罩收在边上。
/// iPad 实测 12/24/48 块都是 17ms，和普通模糊一样——**不要钱**。
///
/// ⚠️ 是缩小不是放大。放大是把中间的东西摊开，像凸透镜底下压了张纸；
/// 缩小才是「边上能看到外面本来看不到的东西」。
///
/// ⚠️ 只在「玻璃底下确实是壁纸」时才对。压在 app 内容上的玻璃（聊天输入条之类）
/// 复制不到背景，那儿不用这个——桌面才是它的场子。

type Skin = {
  /// 壁纸。照片走 url，内置的走 css
  url?: string;
  css?: string;
  /// 机身元素。副本要相对它对齐，也要按它的尺寸铺
  device: HTMLElement | null;
  /// 边上那条带多宽，0 = 关掉
  edge: number;
};

const Ctx = createContext<Skin>({ device: null, edge: 0 });

export const RefractionProvider = Ctx.Provider;
export type { Skin as RefractionSkin };

/// 塞进任何一块玻璃里当第一个孩子。它自己量位置，自己对齐。
export function Edge({ radius = "inherit" }: { radius?: string | number }) {
  const skin = useContext(Ctx);
  const box = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const dev = skin.device;
    if (!dev || !skin.edge) return;
    const measure = () => {
      const b = box.current;
      if (!b) return;
      const r = b.getBoundingClientRect();
      const d = dev.getBoundingClientRect();
      // ⚠️ 偏移相对**机身**，不是相对视口——算错原点的症状是里外接不上，
      // 还会和壁纸的纹理打出摩尔纹，看着像哪儿坏了。
      const next = { x: r.left - d.left, y: r.top - d.top, w: d.width, h: d.height };
      // ⚠️ **没变就别 setState。** 六个实例每 400ms 各写一次同样的值，
      // 等于每 400ms 整屏重渲染六遍——手感上就是「有点顿」，
      // 而且查不出来，因为画面看着是对的。
      setGeo((p) =>
        p && p.x === next.x && p.y === next.y && p.w === next.w && p.h === next.h ? p : next,
      );
    };
    measure();
    // 桌面会翻页、组件会被拖走，位置不是一次算完就完事的
    const t = setInterval(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", measure);
    };
  }, [skin.device, skin.edge]);

  if (!skin.edge || !geo || (!skin.url && !skin.css)) return <div ref={box} className="hidden" />;

  const e = skin.edge;
  const ring = [
    `linear-gradient(to right, #000 0, transparent ${e}px)`,
    `linear-gradient(to left,  #000 0, transparent ${e}px)`,
    `linear-gradient(to bottom,#000 0, transparent ${e}px)`,
    `linear-gradient(to top,   #000 0, transparent ${e}px)`,
  ].join(",");

  return (
    <>
      <div ref={box} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          pointerEvents: "none",
          // 和机身那张壁纸一模一样地铺，再反向偏移到自己的位置上，
          // 这样副本和底下真的壁纸是严丝合缝的
          ...(skin.url
            ? { backgroundImage: `url(${skin.url})` }
            : { background: skin.css }),
          backgroundSize: `${geo.w}px ${geo.h}px`,
          backgroundPosition: `${-geo.x}px ${-geo.y}px`,
          backgroundRepeat: "no-repeat",
          // 缩小：把更外面的内容挤进边上那条带
          transform: "scale(0.86)",
          transformOrigin: "center",
          maskImage: ring,
          WebkitMaskImage: ring,
          // 半像素的糊，压掉缩放留下的锯齿
          filter: "blur(0.6px)",
        }}
      />
    </>
  );
}
