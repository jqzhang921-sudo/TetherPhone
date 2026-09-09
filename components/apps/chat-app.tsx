"use client";
import { useEffect, useRef, useState } from "react";
import { loadMsgs, saveMsgs, newId, type Msg } from "@/lib/chat/store";
import type { Settings } from "@/lib/os/settings";

function systemPrompt(s: Settings) {
  const bits: string[] = [];
  if (s.aiName.trim()) bits.push(`你叫${s.aiName.trim()}。`);
  if (s.userName.trim()) bits.push(`跟你说话的人叫${s.userName.trim()}。`);
  if (s.persona.trim()) bits.push(s.persona.trim());
  // 只给名字，不挂任何形容词。挂了模型就去演那个词。
  return bits.join("\n");
}

export function ChatApp({ settings }: { settings: Settings }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => setMsgs(loadMsgs()), []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const commit = (next: Msg[]) => {
    setMsgs(next);
    saveMsgs(next);
  };

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    if (!settings.apiKey) {
      setErr("还没填 API key。回桌面打开「设置」。");
      return;
    }
    setErr(null);

    const mine: Msg = { id: newId(), role: "user", content: body, at: Date.now() };
    const history = [...msgs, mine];
    commit(history);
    setText("");
    setBusy(true);

    const replyId = newId();
    let acc = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiBase: settings.apiBase,
          apiKey: settings.apiKey,
          model: settings.model,
          system: systemPrompt(settings),
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      // ⚠️ 这个 buffer 不是可有可无的：SSE 的一行经常被切在两个网络分片里。
      // 直接对每个分片 split("\n") 会把被切开的那一行两半都丢掉 ——
      // 症状是长回复零星掉字（不是尾部截断，所以特别难认）。
      let buf = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop() ?? ""; // 最后一段可能不完整，留到下一轮

        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              acc += delta;
              setMsgs((prev) => {
                const rest = prev.filter((m) => m.id !== replyId);
                return [...rest, { id: replyId, role: "assistant", content: acc, at: Date.now() }];
              });
            }
          } catch {
            // 单个分片解析不了就跳过这一行，别让整条流断掉
          }
        }
      }

      commit([...history, { id: replyId, role: "assistant", content: acc, at: Date.now() }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      commit(history);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-2 flex flex-col gap-2.5">
        {msgs.length === 0 && !busy && (
          <div className="flex-1 grid place-items-center text-center px-8">
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
              还没有说过话。
            </p>
          </div>
        )}

        {msgs.map((m) => (
          <div
            key={m.id}
            className={`max-w-[78%] px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words rounded-[20px] ${
              m.role === "user" ? "self-end" : "self-start"
            }`}
            style={
              m.role === "user"
                ? { background: "oklch(0.62 0.14 250)", color: "oklch(0.99 0 0)" }
                : {
                    // 承载文字的面自己立住底，不靠透出背景成立
                    background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
                    color: "var(--ink)",
                    border: "1px solid var(--glass-edge)",
                  }
            }
          >
            {m.content}
          </div>
        ))}

        {busy && !msgs.some((m) => m.role === "assistant" && m.content === "") && (
          <div className="self-start px-3.5 py-3 rounded-[20px]"
            style={{ background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)" }}>
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: "var(--ink-faint)", animationDelay: `${i * 160}ms` }} />
              ))}
            </span>
          </div>
        )}

        {err && (
          <div className="self-center text-[12px] text-center px-4 py-2 rounded-xl"
            style={{ color: "oklch(0.65 0.19 25)", background: "oklch(0.65 0.19 25 / 0.12)" }}>
            {err}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="shrink-0 px-3 pb-1 pt-2">
        <div className="glass-strong rounded-[24px] flex items-end gap-2 px-3 py-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="说点什么"
            className="flex-1 bg-transparent outline-none resize-none text-[15px] max-h-28 py-1.5"
            style={{ color: "var(--ink)" }}
          />
          <button
            onClick={() => void send()}
            disabled={busy || !text.trim()}
            className="shrink-0 w-9 h-9 rounded-full grid place-items-center disabled:opacity-30 transition-opacity"
            style={{ background: "oklch(0.62 0.14 250)", color: "oklch(0.99 0 0)" }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
