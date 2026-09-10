import { NextResponse } from "next/server";

/// 联网搜索。给模型用的，不是给人用的——所以返回的是几条「标题 + 一句话」，
/// 不是一页链接。
///
/// **默认不需要任何 key**：走必应（cn.bing.com）的 HTML 结果页，服务端去抓、解析前几条。
/// ⚠️ **源必须是国内直连能通的。** 第一版写的是 DuckDuckGo，实测在她这台机器上
/// 直接超时（12s 无响应），Baidu 也连不上，只有 cn.bing.com 是 200。
/// 这台 App 是要发给别人在自己设备上跑的，不能默认所有人都挂着代理。
/// ⚠️ 解析 HTML 是脆的：对方改版式这里就空手而归。所以
/// ① 解析失败要**明说搜不到**，不能返回空数组假装"没有结果"——
///    那会让模型以为它查过了、世界上没有这件事，然后一本正经地说错话；
/// ② 留了 `SEARCH_API_BASE`：填一个 SearXNG 实例（`/search?format=json`）就走它，
///    比抓 HTML 稳，和音源那条是同一个路子（自己跑一个，地址钉在环境变量里）。
///
/// ⚠️ 只有环境变量能决定去请求谁。**不接受前端传 base**——那等于让任何人
/// 指使这台服务器去访问任意地址，包括内网。音源那条当初就是这么收的口。

export const runtime = "nodejs";

type Hit = { title: string; snippet: string; url: string };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/// HTML → 纯文本。
/// ⚠️ 实体要**通用地**解，不能只列几个常见的：必应的摘要里带 `&ensp;`、`&#0183;`
/// 这类东西，漏掉就原样喂给模型了。数字实体统一走 fromCodePoint。
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  hellip: "…", middot: "·", mdash: "—", ndash: "–",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
};

const strip = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();

async function viaBing(q: string): Promise<Hit[]> {
  const u = new URL("https://cn.bing.com/search");
  u.searchParams.set("q", q);
  // 别把结果整成英文版；她问的多半是中文的事
  u.searchParams.set("ensearch", "0");
  const res = await fetch(u, {
    headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`搜索源返回 ${res.status}`);
  const html = await res.text();

  // 实际结构（抓下来看过的，不是照记忆写的）：
  //   <h2 ...><a ... href="真地址">标题</a></h2>
  //   <div class="b_caption"><p class="b_lineclamp2">摘要</p></div>
  // 标题里还夹着 <strong> 高亮，strip 会去掉。
  const re =
    /<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>([\s\S]{0,900}?)<\/li>/g;
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < 5) {
    const title = strip(m[2]);
    if (!title) continue;
    const snip = /class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(m[3]);
    hits.push({ title, url: m[1], snippet: snip ? strip(snip[1]).slice(0, 240) : "" });
  }
  return hits;
}

async function viaSearx(base: string, q: string): Promise<Hit[]> {
  const u = new URL("/search", base);
  u.searchParams.set("q", q);
  u.searchParams.set("format", "json");
  const res = await fetch(u, { headers: { "user-agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`搜索源返回 ${res.status}`);
  const j = (await res.json()) as { results?: { title?: string; content?: string; url?: string }[] };
  return (j.results ?? []).slice(0, 5).map((r) => ({
    title: String(r.title ?? "").trim(),
    snippet: String(r.content ?? "").slice(0, 240),
    url: String(r.url ?? ""),
  }));
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ error: "没给要搜的词" }, { status: 400 });

  const base = process.env.SEARCH_API_BASE?.trim();
  try {
    const hits = base ? await viaSearx(base, q) : await viaBing(q);
    if (hits.length === 0) {
      // ⚠️ 空手而归和"这件事不存在"是两回事，必须分清楚回给上面
      return NextResponse.json({ error: "这次没搜到东西（可能是搜索源改版了）" }, { status: 502 });
    }
    return NextResponse.json({ q, hits });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "搜索失败" },
      { status: 502 },
    );
  }
}
