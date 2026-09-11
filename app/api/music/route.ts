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
import { readSession } from "@/lib/music/session";

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

type Playlist = {
  id: number;
  name: string;
  coverImgUrl?: string;
  trackCount?: number;
  /// 5 = 「我喜欢的音乐」
  specialType?: number;
  userId?: number;
};

type Song = {
  id: number;
  name: string;
  fee?: number;
  ar?: { name: string }[];
  artists?: { name: string }[];
  al?: { picUrl?: string };
  album?: { picUrl?: string };
};

/// 登录态有两个来源，**优先用每个人自己的**：
/// 1. 请求带的 httpOnly cookie —— 这个人在这台站上登录过（见 /api/music/login）
/// 2. `MUSIC_COOKIE` 环境变量 —— 站长自己配的，整站共用
///
/// ⚠️ 环境变量那条只适合**自己一个人用**。发出去给别人用还共用一个账号，
/// 那是共享账号，也容易让号因为多地同时在线被风控。
/// 所以是「每个人自己的」优先，环境变量只当兜底。
///
/// 两条都**不从前端参数里取**：cookie 放 URL 会落进请求日志。
const ENV_COOKIE = process.env.MUSIC_COOKIE?.trim();
const sessionOf = (req: Request) => readSession(req) || ENV_COOKIE;

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const op = p.get("op");
  const COOKIE = sessionOf(req);
  const grab = async (url: string) => {
    const r = await fetch(url, {
      cache: "no-store",
      headers: COOKIE ? { Cookie: COOKIE } : {},
    });
    if (!r.ok) throw new Error(`音源返回 ${r.status}`);
    return r.json();
  };
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

    if (op === "mine") {
      // ⚠️ **uid 要现问，不能让前端传。** 前端传就等于「谁的歌单都能拉」，
      // 而这台服务器手里握着的是**这个人自己的** cookie——
      // 拿别人的 uid 来问，问出来的是那个人的公开歌单，看着还挺正常，
      // 于是这个接口悄悄变成了「用我的号去扒任何人」。
      const acc = await grab(`${base}/user/account?timestamp=${Date.now()}`);
      const uid = acc?.profile?.userId ?? acc?.account?.id;
      if (!uid) return Response.json({ error: "还没登录" }, { status: 401 });
      const j = await grab(`${base}/user/playlist?uid=${uid}&limit=60&timestamp=${Date.now()}`);
      const list: Playlist[] = j?.playlist ?? [];
      return Response.json({
        uid: String(uid),
        lists: list.map((l) => ({
          id: String(l.id),
          name: l.name,
          cover: l.coverImgUrl,
          count: l.trackCount ?? 0,
          // specialType 5 = 「我喜欢的音乐」。它是系统建的，名字跟着昵称走
          //（「某某喜欢的音乐」），所以**靠名字认不出来**，只能看这个字段。
          liked: l.specialType === 5,
          // 收藏别人的歌单也在这个列表里，用创建者区分
          mine: String(l.userId ?? "") === String(uid),
        })),
      });
    }

    if (op === "list") {
      const id = p.get("id");
      if (!id) return Response.json({ error: "没给 id" }, { status: 400 });
      // 歌单可以很长（几千首）。一次拉 500，界面上也够翻了。
      const j = await grab(
        `${base}/playlist/track/all?id=${encodeURIComponent(id)}&limit=500&timestamp=${Date.now()}`,
      );
      const list: Song[] = j?.songs ?? [];
      return Response.json({
        songs: list.map((s) => ({
          songId: String(s.id),
          title: s.name,
          artist: (s.ar ?? s.artists ?? []).map((a) => a.name).join(" / "),
          cover: s.al?.picUrl ?? s.album?.picUrl,
          vip: s.fee === 1 || s.fee === 4,
        })),
      });
    }

    if (op === "url") {
      const id = p.get("id");
      if (!id) return Response.json({ error: "没给 id" }, { status: 400 });
      const level = COOKIE ? "exhigh" : "standard";
      const j = await grab(`${base}/song/url/v1?id=${encodeURIComponent(id)}&level=${level}`);
      const d = j?.data?.[0];
      if (!d?.url) {
        // 拿不到就说清楚**为什么**拿不到。返回一句「失败」等于让人对着猜。
        return Response.json({ error: "这首拿不到音源" }, { status: 404 });
      }
      // ⚠️ **试听片段也是有 url 的。** 只判断「有没有 url」会把 30 秒的试听
      // 当成整首返回——播到一半突然没了，人完全不知道为什么。实测 16 首里
      // 有 7 首是这种（fee=1 的 VIP 专享，不登录一律只给试听）。
      // 所以要把这件事**带出去**，让界面说人话。
      return Response.json({
        url: d.url,
        br: d.br,
        trial: !!d.freeTrialInfo,
        // 前端要用它决定说「要登录有会员的账号」还是「你的账号没这首的会员」
        loggedIn: !!COOKIE,
      });
    }

    if (op === "stream") {
      // 音频本身也经服务端转发。
      //
      // 本来只想转发「取地址」这一步，让浏览器直接连 CDN 拿音频——省流量。
      // 但真机上实测不行：`MEDIA_ELEMENT_ERROR` code 4「no supported sources」，
      // 而同一个地址服务端 fetch 是 206 audio/mpeg、换 https 也一样、
      // 换 Referer / UA 都一样、浏览器 mp3 解码也正常。浏览器就是拿不到。
      //
      // 转发之后这些全绕开了：同源、不涉及 CORS、不涉及混合内容、
      // 地址每次现取所以也不会过期。**代价是音频流量走这台服务器。**
      const id = p.get("id");
      if (!id) return new Response("没给 id", { status: 400 });
      // 登录了就要无损/极高，没登录要了也白要
      const level = COOKIE ? "exhigh" : "standard";
      const j = await grab(`${base}/song/url/v1?id=${encodeURIComponent(id)}&level=${level}`);
      const src = j?.data?.[0]?.url;
      if (!src) return new Response("这首拿不到音源", { status: 404 });

      // ⚠️ Range 必须原样带上去，否则播放器**拖不动进度条**
      // ——没有 206 就没法 seek，长音频还会整首等下完。
      const range = req.headers.get("range");
      // ⚠️ 取音频字节时**不要**带 cookie：这是 CDN 的地址，不是 API 的，
      // 签名已经在 url 里了。往 CDN 发账号 cookie 是白送凭据。
      const up = await fetch(src, {
        headers: range ? { Range: range } : {},
        cache: "no-store",
      });
      if (!up.ok && up.status !== 206) {
        return new Response(`音源返回 ${up.status}`, { status: 502 });
      }
      const head = new Headers({
        "Content-Type": up.headers.get("content-type") ?? "audio/mpeg",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      });
      for (const k of ["content-length", "content-range"]) {
        const v = up.headers.get(k);
        if (v) head.set(k, v);
      }
      return new Response(up.body, { status: up.status, headers: head });
    }

    if (op === "cover") {
      // 封面也要经本站转发。
      // ⚠️ 不是为了 CORS 头——是为了**能读像素**：跨域图画进 canvas 会污染画布，
      // getImageData 直接抛 SecurityError，取色就无从谈起。
      const u = p.get("u");
      if (!u) return new Response("没给地址", { status: 400 });
      let cdn: URL;
      try {
        cdn = new URL(u);
      } catch {
        return new Response("地址不合法", { status: 400 });
      }
      // 只放行音乐平台的图床，别把这里变成通用图片代理
      if (!/(^|\.)(music\.126\.net|126\.net|qpic\.cn|kgimg\.com|kuwo\.cn)$/i.test(cdn.hostname)) {
        return new Response("这个域名不在允许之列", { status: 400 });
      }
      // 原图能到 1MB 以上，而这儿只要一张播放页的封面 + 32×32 的取色采样。
      // 网易云的图床支持 `param=WxH`，让它那边缩好再传。
      if (/126\.net$/i.test(cdn.hostname) && !cdn.searchParams.has("param")) {
        cdn.searchParams.set("param", "500y500");
      }
      const up = await fetch(cdn.toString(), { cache: "no-store" });
      if (!up.ok) return new Response(`封面返回 ${up.status}`, { status: 502 });
      return new Response(up.body, {
        headers: {
          "Content-Type": up.headers.get("content-type") ?? "image/jpeg",
          // 封面不会变，可以让浏览器留着
          "Cache-Control": "public, max-age=86400",
        },
      });
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
