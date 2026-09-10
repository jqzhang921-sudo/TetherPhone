/// 音乐账号登录。
///
/// 为什么要做进 App 里，而不是只留 `tools/music-login.mjs`：
/// 那个脚本要在**跑服务器的那台机器上**执行，等于只有站长能登录，
/// 而且整台服务器共用一个账号——既是共享账号，也容易让号因为多地在线被风控。
///
/// ⚠️ **登录态存 httpOnly cookie，不存 localStorage。**
/// 存前端的话它会跟着「导出备份」跑进那个 JSON 文件；httpOnly 则页面脚本读不到，
/// 也不会进备份。代价是它每次请求都会发到本站——本来就要发给服务端用，无所谓。
///
/// ⚠️ **一句必须说在前面的话**：谁在这个站上登录，就是把自己的网易云登录态
/// 交给这台服务器。自己用没问题；发出去给别人用，那是要别人信任你。
/// 更干净的做法是每个人自己部署一份。
import { readSession, setSession, slimCookie } from "@/lib/music/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PINNED = process.env.MUSIC_API_BASE?.trim();
const PRIVATE =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;
const ALLOW_PRIVATE =
  process.env.NODE_ENV !== "production" || process.env.MUSIC_ALLOW_PRIVATE === "1";

function resolveBase(raw: string | null): string | null {
  if (PINNED) return PINNED.replace(/\/+$/, "");
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!ALLOW_PRIVATE && PRIVATE.test(u.hostname)) return null;
    return v.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

const grab = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
};

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const op = p.get("op");

  if (op === "status") {
    const mine = readSession(req);
    const base = resolveBase(p.get("base"));
    if (!mine || !base) {
      return Response.json({ loggedIn: false, viaEnv: !!process.env.MUSIC_COOKIE?.trim() });
    }
    try {
      const r = await fetch(`${base}/user/account?timestamp=${Date.now()}`, {
        headers: { Cookie: mine },
        cache: "no-store",
      });
      const j = await r.json();
      return Response.json({
        loggedIn: !!j?.profile,
        name: j?.profile?.nickname ?? "",
        // vipType 0 = 没会员。**说实话**，不然人会以为登录了就该能听全
        vip: (j?.account?.vipType ?? 0) > 0,
      });
    } catch {
      return Response.json({ loggedIn: false });
    }
  }

  if (op === "logout") return setSession({ ok: true }, null);

  const base = resolveBase(p.get("base"));
  if (!base) return Response.json({ error: "音源地址不合法" }, { status: 400 });

  try {
    if (op === "qr-start") {
      const k = await grab(`${base}/login/qr/key?timestamp=${Date.now()}`);
      const key = k?.data?.unikey;
      if (!key) return Response.json({ error: "拿不到二维码" }, { status: 502 });
      const c = await grab(
        `${base}/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true&timestamp=${Date.now()}`,
      );
      return Response.json({ key, img: c?.data?.qrimg ?? "" });
    }

    if (op === "qr-check") {
      const key = p.get("key");
      if (!key) return Response.json({ error: "没给 key" }, { status: 400 });
      const s = await grab(`${base}/login/qr/check?key=${encodeURIComponent(key)}&timestamp=${Date.now()}`);
      // 800=过期 801=等扫 802=待确认 803=成功
      if (s?.code === 803 && s?.cookie) return setSession({ code: 803 }, slimCookie(s.cookie));
      return Response.json({ code: s?.code ?? 0 });
    }

    if (op === "sms-send") {
      const phone = p.get("phone")?.trim();
      if (!phone) return Response.json({ error: "没给手机号" }, { status: 400 });
      const s = await grab(`${base}/captcha/sent?phone=${encodeURIComponent(phone)}&timestamp=${Date.now()}`);
      return Response.json({ ok: s?.code === 200, msg: s?.message ?? "" });
    }

    if (op === "sms-login") {
      const phone = p.get("phone")?.trim();
      const code = p.get("captcha")?.trim();
      if (!phone || !code) return Response.json({ error: "手机号和验证码都要" }, { status: 400 });
      const s = await grab(
        `${base}/login/cellphone?phone=${encodeURIComponent(phone)}&captcha=${encodeURIComponent(code)}&timestamp=${Date.now()}`,
      );
      if (s?.code === 200 && s?.cookie) return setSession({ ok: true }, slimCookie(s.cookie));
      // 把上游的原话带回去。「登录失败」四个字等于让人对着猜。
      return Response.json({ error: s?.message ?? `登录失败（${s?.code}）` }, { status: 400 });
    }

    return Response.json({ error: "不认识的操作" }, { status: 400 });
  } catch (e) {
    return Response.json(
      { error: `连不上音源：${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}
