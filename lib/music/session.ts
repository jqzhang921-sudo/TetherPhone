/// 音乐登录态的读写。**只在服务端用。**
///
/// 存 httpOnly cookie 而不是 localStorage：页面脚本读不到，也不会跟着
/// 「导出备份」跑进那个 JSON 文件。
export const MUSIC_COOKIE = "tp_music";
const MAX_AGE = 30 * 24 * 3600;

export function readSession(req: Request): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== MUSIC_COOKIE) continue;
    const v = part.slice(i + 1);
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return undefined;
}

export function setSession(body: unknown, value: string | null): Response {
  const h = new Headers({ "Content-Type": "application/json" });
  const bits = [
    `${MUSIC_COOKIE}=${value ? encodeURIComponent(value) : ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${value ? MAX_AGE : 0}`,
  ];
  // 只有 https 才加 Secure——本地是 http，加了浏览器直接不存
  if (process.env.NODE_ENV === "production") bits.push("Secure");
  h.append("Set-Cookie", bits.join("; "));
  return new Response(JSON.stringify(body), { headers: h });
}

/// 只留音源接口真正要的那几个键。网易云返回的一大串，
/// 整串塞进浏览器 cookie 容易撞 4KB 上限。
export function slimCookie(raw: string): string {
  const want = ["MUSIC_U", "__csrf", "NMTID"];
  const out: string[] = [];
  for (const part of raw.split(/;\s*/)) {
    const k = part.split("=")[0]?.trim();
    if (k && want.includes(k)) out.push(part.trim().replace(/;$/, ""));
  }
  return out.join("; ");
}
