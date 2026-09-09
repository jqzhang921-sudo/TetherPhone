"use client";
import type { Contact } from "@/lib/os/contacts";
import type { Settings } from "@/lib/os/settings";

/// 把一次补全整条读完再返回。
///
/// 日记和信都不需要逐字出现——它们是「写好了拿给你看」，不是「正在说话」。
/// 只有聊天要流式，那边在 chat-app 里单独处理。
export async function completeOnce(
  settings: Settings,
  contact: Contact,
  prompt: string,
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiBase: settings.apiBase,
      apiKey: settings.apiKey,
      model: contact.model.trim() || settings.model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  // ⚠️ 跨分片缓冲。SSE 的一行经常被切在两个网络分片里，按分片切行会把
  // 被切开的那行两半都丢掉——症状是长回复零星掉字，不是尾部截断。
  let buf = "";
  let out = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const d = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (typeof d === "string") out += d;
      } catch {
        /* 跳过解析不了的分片，别让整条流断掉 */
      }
    }
  }
  return out.trim();
}

/// 身份那几句。**只给名字，不挂形容词**——挂了模型就去演那个词。
export function identity(c: Contact, me: Settings): string[] {
  return [
    c.name.trim() ? `你叫${c.name.trim()}。` : "",
    me.userName.trim() ? `跟你说话的人叫${me.userName.trim()}。` : "",
    c.persona.trim(),
  ].filter(Boolean);
}
