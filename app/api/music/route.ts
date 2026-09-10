/// 音源中转。
///
/// 为什么要中转：音源实例大多不给浏览器发跨域头，前端直连会被 CORS 挡下。
/// 和 /api/chat 同一个理由。
///
/// ⚠️ **base 由客户端传，这是个 SSRF 面。** 有人可以让这台服务器去请求任意地址，
/// 包括内网和云厂商的元数据端点——自己用没事，**一旦把站部署出去给别人用就不是没事**。
/// 所以：
/// - 设了 `MUSIC_API_BASE` 环境变量就**只用它**，完全忽略客户端传的（部署时该这么配）
/// - 没设时才收客户端的，并且只放行 http/https、挡掉一眼可见的内网地址
///   （这挡不住 DNS 重绑定，只是把误伤和顺手一试挡在外面）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PINNED = process.env.MUSIC_API_BASE?.trim();

const PRIVATE =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

/// ⚠️ **本机地址不能一律挡掉。** 自己用的时候音源就跑在 `127.0.0.1` 上——
/// 一刀切会把最主要的用法堵死（设置页的占位符写的就是它）。
/// 所以按场景分：本地跑着开发/自用时放开，真部署出去（production）才锁。
/// 部署时更该做的是设 `MUSIC_API_BASE` 把地址钉死，那样根本不收前端传的。
const ALLOW_PRIVATE =
  process.env.NODE_ENV !== "production" || process.env.MUSIC_ALLOW_PRIVATE === "1";

function resolveBase(raw: string | null): string | null {
  if (PINNED) return PINNED.replace(/\/+$/, "");
  const v = (raw ?? "").trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!ALLOW_PRIVATE && PRIVATE.test(u.hostname)) return null;
  return v.replace(/\/+$/, "");
}

type Song = {
  id: number;
  name: string;
  fee?: number;
  ar?: { name: string }[];
  artists?: { name: string }[];
  al?: { picUrl?: string };
  album?: { picUrl?: string };
};

const grab = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`音源返回 ${r.status}`);
  return r.json();
};

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const op = p.get("op");
  const base = resolveBase(p.get("base"));
  if (!base) {
    return Response.json(
      { error: PINNED ? "音源没配好" : "音源地址不合法，或者指向了内网" },
      { status: 400 },
    );
  }

  try {
    if (op === "search") {
      const q = p.get("q")?.trim();
      if (!q) return Response.json({ songs: [] });
      const j = await grab(`${base}/cloudsearch?keywords=${encodeURIComponent(q)}&limit=25`);
      const list: Song[] = j?.result?.songs ?? [];
      return Response.json({
        songs: list.map((s) => ({
          songId: String(s.id),
          title: s.name,
          artist: (s.ar ?? s.artists ?? []).map((a) => a.name).join(" / "),
          cover: s.al?.picUrl ?? s.album?.picUrl,
          // fee=1 是 VIP 专享，fee=4 是付费专辑。**先标出来**，
          // 免得点下去才发现没声音。
          vip: s.fee === 1 || s.fee === 4,
        })),
      });
    }

    if (op === "url") {
      const id = p.get("id");
      if (!id) return Response.json({ error: "没给 id" }, { status: 400 });
      const j = await grab(`${base}/song/url/v1?id=${encodeURIComponent(id)}&level=standard`);
      const d = j?.data?.[0];
      if (!d?.url) {
        // 拿不到就说清楚**为什么**拿不到。返回一句「失败」等于让人对着猜。
        return Response.json({ error: "这首拿不到音源" }, { status: 404 });
      }
      // ⚠️ **试听片段也是有 url 的。** 只判断「有没有 url」会把 30 秒的试听
      // 当成整首返回——播到一半突然没了，人完全不知道为什么。实测 16 首里
      // 有 7 首是这种（fee=1 的 VIP 专享，不登录一律只给试听）。
      // 所以要把这件事**带出去**，让界面说人话。
      return Response.json({ url: d.url, br: d.br, trial: !!d.freeTrialInfo });
    }

    if (op === "lyric") {
      const id = p.get("id");
      if (!id) return Response.json({ error: "没给 id" }, { status: 400 });
      const j = await grab(`${base}/lyric?id=${encodeURIComponent(id)}`);
      return Response.json({ lyric: j?.lrc?.lyric ?? "" });
    }

    return Response.json({ error: "不认识的操作" }, { status: 400 });
  } catch (e) {
    return Response.json(
      { error: `连不上音源：${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}
