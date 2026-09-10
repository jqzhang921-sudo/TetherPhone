/// 把浏览器的请求转给上游模型接口。
///
/// 存在的理由有两个，都不是可选的：
/// 1. **CORS**。绝大多数模型接口不给浏览器发跨域头，前端直连会被挡下，
///    而且报错长得像网络问题、不像配置问题。
/// 2. **流式**。SSE 直接把上游的 body 管道接出去，不在中间攒整段，
///    否则回复要等全部生成完才出现。
///
/// key 不落盘、不记日志，只在这一次请求里透传。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/// `content` 可以是一段字，也可以是 OpenAI 那套多模态数组
/// （`[{type:"text"...},{type:"image_url"...}]`）。这里**原样透传，不做判断**。
///
/// ⚠️ 刻意不去猜「这个模型能不能看图」然后把图悄悄丢掉。按 provider 名字猜
/// 能力是错的——一个 OpenAI 兼容、模型也支持识图的自定义端点会被判成不能收图，
/// 图被静默丢弃且查不出原因。宁可原样发过去让上游报错：报错看得见，静默丢弃看不见。
type Body = {
  apiBase?: string;
  apiKey?: string;
  model?: string;
  system?: string;
  messages?: { role: string; content: string | unknown[] | null; [k: string]: unknown }[];
  /// OpenAI 那套 function calling 的工具表。原样透传。
  tools?: unknown[];
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("请求不是合法 JSON", { status: 400 });
  }

  const { apiBase, apiKey, model, system, messages, tools } = body;
  if (!apiKey) return new Response("没有 API key", { status: 400 });
  if (!messages?.length) return new Response("没有消息", { status: 400 });

  const base = (apiBase || "https://api.deepseek.com/v1").replace(/\/+$/, "");

  const upstream = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "deepseek-chat",
      stream: true,
      messages: [
        ...(system?.trim() ? [{ role: "system", content: system.trim() }] : []),
        ...messages,
      ],
      ...(tools?.length ? { tools } : {}),
    }),
  }).catch((e: unknown) => e instanceof Error ? e : new Error(String(e)));

  if (upstream instanceof Error) {
    return new Response(`连不上 ${base}：${upstream.message}`, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    // 把上游的原话带回去。吞掉它等于让人对着"失败了"三个字猜。
    return new Response(`上游 ${upstream.status}：${detail.slice(0, 500)}`, {
      status: upstream.status,
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
