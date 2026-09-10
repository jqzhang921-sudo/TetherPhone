"use client";

/// 一个话题 = 一棵树。细节 = 叶子，记得越多越茂。
///
/// **形状由话题 id 决定**，所以同一个话题每次看都是同一棵树——
/// 每次渲染都换个样子的话，它就只是装饰，不是那件事本身。
/// 和日记贴图按 id 取旋转角是同一个道理。
///
/// 选森林不是因为好看：**它有生长感，而且删除等于落叶，不刺眼。**
/// 星图更适合展示关联，但话题之间目前没有关联数据，连线会是假的。

/// 从字符串长出一串稳定的伪随机数（FNV-1a + xorshift）。
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

type Seg = { x1: number; y1: number; x2: number; y2: number; w: number };

function grow(seed: string, len: number) {
  const rnd = seeded(seed);
  const segs: Seg[] = [];
  const tips: { x: number; y: number }[] = [];

  const step = (x: number, y: number, angle: number, l: number, depth: number, w: number) => {
    const x2 = x + Math.cos(angle) * l;
    const y2 = y + Math.sin(angle) * l;
    segs.push({ x1: x, y1: y, x2, y2, w });
    if (depth === 0) {
      tips.push({ x: x2, y: y2 });
      return;
    }
    // 两叉，角度和长度都带点随机——完全对称的树一眼是画的
    const spread = 0.42 + rnd() * 0.34;
    const shrink = 0.66 + rnd() * 0.14;
    step(x2, y2, angle - spread, l * shrink, depth - 1, w * 0.68);
    step(x2, y2, angle + spread * (0.7 + rnd() * 0.6), l * shrink * (0.85 + rnd() * 0.3), depth - 1, w * 0.68);
  };

  step(0, 0, -Math.PI / 2, len, 3, Math.max(1.6, len * 0.09));
  return { segs, tips };
}

export function Tree({
  id,
  leaves,
  tint,
  size = 1,
  dim = false,
}: {
  id: string;
  /// 叶子数 = 细节条数。**0 就是光秃秃的**——有话题没细节，
  /// 那棵树就该看着单薄，不该假装茂盛。
  leaves: number;
  tint: string;
  size?: number;
  dim?: boolean;
}) {
  const len = 26 * size;
  const { segs, tips } = grow(id, len);
  const rnd = seeded(id + "leaf");

  // ⚠️ 枝头**不能按 tips 的原顺序取**。递归是先左后右，前几个枝头全在同一侧
  // ——三片叶子会齐刷刷挂在左上角，看着像树病了。先按 id 洗一遍牌再取。
  const order = tips.map((t, i) => ({ t, k: seeded(id + i)() }));
  order.sort((a, b) => a.k - b.k);

  const dots: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < leaves; i++) {
    const t = order[i % order.length].t;
    // 同一个枝头挂第二片时偏得远一点，不然两片叠在一起看着像一片
    const spread = (i >= order.length ? 1.8 : 1) * 10 * size;
    dots.push({
      x: t.x + (rnd() - 0.5) * spread,
      y: t.y + (rnd() - 0.5) * spread,
      r: (2.8 + rnd() * 1.9) * size,
    });
  }

  // 画布刚好裹住树，外面留一点余量给叶子
  const pad = 14 * size;
  const xs = [...segs.map((s) => s.x2), ...dots.map((d) => d.x), 0];
  const ys = [...segs.map((s) => s.y2), ...dots.map((d) => d.y), 0];
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;

  return (
    <svg
      viewBox={`${minX} ${minY} ${maxX - minX} ${-minY + 4}`}
      width={maxX - minX}
      height={-minY + 4}
      style={{ opacity: dim ? 0.45 : 1, transition: "opacity 240ms" }}
    >
      {segs.map((s, i) => (
        <line
          key={i}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke="var(--ink-dim)"
          strokeWidth={s.w}
          strokeLinecap="round"
        />
      ))}
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={tint} opacity={0.62 + (i % 3) * 0.12} />
      ))}
    </svg>
  );
}
