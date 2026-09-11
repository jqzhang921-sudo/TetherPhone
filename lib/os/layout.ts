/// 桌面的格子。
///
/// 真手机的桌面是**分页的定长网格**，不是一条能往下滚的长列表。
/// 差别不只是观感：能滚就意味着"东西多了就往下堆"，于是永远不需要
/// 决定什么该放第一屏——而那个决定正是桌面的全部意义。
///
/// ⚠️ **格子是正方的。** 列宽由屏幕定，行高跟着列宽走，不是反过来。
/// 这样 2×2 的组件才是正方形；行高要是由"剩下多少高度"决定，
/// 换个屏幕比例组件就被压扁或抻长。
export const COLS = 4;
export const ROWS = 6;

export type Size = { w: number; h: number };
export type Spot = { page: number; col: number; row: number };
export type Placed = { id: string } & Spot & Size;

/// 存成 `id:页,列,行` 用分号隔开。
///
/// **不存 JSON。** settings 是一张扁的字符串表，塞 JSON 进去读写两头都要
/// try/catch，而且一处写坏整张表都读不出来。这种格式坏一条就丢一条。
export function parseLayout(s: string): Map<string, Spot> {
  const out = new Map<string, Spot>();
  for (const chunk of s.split(";")) {
    // ⚠️ **按最后一个冒号切，不能 split(":")。**
    // id 自己就带冒号（组件是 `w:clock`，文件夹是 `f:xxx`），
    // `"w:clock:0,1,2".split(":")` 会拆成三段，id 变成 "w"、坐标变成 NaN，
    // **整条被丢掉**。症状极其误导：存进去是对的，读回来没了，
    // 于是组件每次重新渲染都被自动落位回原处——看起来就是「拖完又弹回去」。
    // 而图标 id 不带冒号，一直是好的，所以症状表现为「图标能拖、组件不能」。
    const cut = chunk.lastIndexOf(":");
    if (cut <= 0) continue;
    const id = chunk.slice(0, cut);
    const rest = chunk.slice(cut + 1);
    if (!id || !rest) continue;
    const [p, c, r] = rest.split(",").map(Number);
    if (![p, c, r].every(Number.isFinite)) continue;
    out.set(id.trim(), { page: p, col: c, row: r });
  }
  return out;
}

export const serializeLayout = (items: Placed[]) =>
  items.map((i) => `${i.id}:${i.page},${i.col},${i.row}`).join(";");

const keysOf = (s: Spot & Size) => {
  const out: string[] = [];
  for (let r = s.row; r < s.row + s.h; r++)
    for (let c = s.col; c < s.col + s.w; c++) out.push(`${s.page}:${c}:${r}`);
  return out;
};

const fits = (s: Spot & Size) =>
  s.col >= 0 && s.row >= 0 && s.col + s.w <= COLS && s.row + s.h <= ROWS;

export const free = (taken: Set<string>, s: Spot & Size) =>
  fits(s) && keysOf(s).every((k) => !taken.has(k));

/// 谁占着这块地方。用来判断"能不能换位"。
export function occupants(items: Placed[], s: Spot & Size): Placed[] {
  const want = new Set(keysOf(s));
  return items.filter((i) => keysOf(i).some((k) => want.has(k)));
}

/// 把一串东西摆上桌面。
///
/// 存过位置的按存的来；没存过的（新装的 app、刚加的组件）**往后找第一块空地**，
/// 不够就翻到下一页。⚠️ 新东西不能因为没有位置就消失——那种"少了一个图标
/// 但不报错"的毛病最难查。
export function place(items: ({ id: string } & Size)[], saved: Map<string, Spot>): Placed[] {
  const taken = new Set<string>();
  const out: Placed[] = [];
  const rest: ({ id: string } & Size)[] = [];

  // 先安置有记录的，它们的位置是用户亲手放的，优先级最高
  for (const it of items) {
    const s = saved.get(it.id);
    if (s && free(taken, { ...s, ...it })) {
      keysOf({ ...s, ...it }).forEach((k) => taken.add(k));
      out.push({ ...it, ...s });
    } else rest.push(it);
  }

  for (const it of rest) {
    let done = false;
    for (let page = 0; page < 12 && !done; page++) {
      for (let row = 0; row <= ROWS - it.h && !done; row++) {
        for (let col = 0; col <= COLS - it.w && !done; col++) {
          const spot = { page, col, row };
          if (!free(taken, { ...spot, ...it })) continue;
          keysOf({ ...spot, ...it }).forEach((k) => taken.add(k));
          out.push({ ...it, ...spot });
          done = true;
        }
      }
    }
  }
  return out;
}

export const pageCount = (items: Placed[]) =>
  Math.max(1, items.reduce((n, i) => Math.max(n, i.page + 1), 0));
