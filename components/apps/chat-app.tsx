"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadMsgs, saveMsgs, newId, type Msg } from "@/lib/chat/store";
import { displayName, type Contact } from "@/lib/os/contacts";
import { dayLabel, loadDiary, type DiaryEntry } from "@/lib/diary/store";
import type { Settings } from "@/lib/os/settings";

function systemPrompt(c: Contact, me: Settings, shared: DiaryEntry[]) {
  const bits: string[] = [];
  if (c.name.trim()) bits.push(`你叫${c.name.trim()}。`);
  if (me.userName.trim()) bits.push(`跟你说话的人叫${me.userName.trim()}。`);
  if (c.persona.trim()) bits.push(c.persona.trim());
  // 只给名字，不挂形容词——挂了模型就去演那个词。

  // 能看到的只有**公开的**日记。私密那些一个字都不进来——
  // 这是整个交换日记机制的地基，漏了就什么都不成立。
  const open = shared.filter((e) => !e.secret).slice(0, 3);
  if (open.length) {
    bits.push(
      "下面是日记本里对你公开的几篇。不用主动提起，除非她说到：\n" +
        open
          .map((e) => `【${dayLabel(e.at)}·${e.author === "me" ? "她写的" : "你写的"}】${e.text.slice(0, 400)}`)
          .join("\n"),
    );
  }
  return bits.join("\n");
}

function Avatar({ c, size = 44 }: { c: Contact; size?: number }) {
  return (
    <span
      className="shrink-0 grid place-items-center rounded-full"
      style={{ width: size, height: size, background: c.tint, fontSize: size * 0.5 }}
    >
      {c.emoji}
    </span>
  );
}

export function ChatApp({
  contacts,
  settings,
  onOpenProfile,
}: {
  contacts: Contact[];
  settings: Settings;
  onOpenProfile: (c: Contact) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const contact = contacts.find((c) => c.id === openId) ?? null;

  // 会话列表要显示每段对话的最后一句
  useEffect(() => {
    if (openId) return;
    let alive = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const c of contacts) {
        const rows = await loadMsgs(c.id);
        out[c.id] = rows.at(-1)?.content.slice(0, 24) ?? "";
      }
      if (alive) setPreviews(out);
    })();
    return () => {
      alive = false;
    };
  }, [openId, contacts]);

  useEffect(() => {
    if (!openId) return;
    let alive = true;
    void loadMsgs(openId).then((rows) => {
      if (alive) setMsgs(rows);
    });
    void loadDiary(openId).then((rows) => {
      if (alive) setDiary(rows);
    });
    return () => {
      alive = false;
    };
  }, [openId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || busy || !contact) return;
    if (!settings.apiKey) {
      setErr("还没填 API key。回桌面打开「设置」。");
      return;
    }
    setErr(null);

    const mine: Msg = {
      id: newId(),
      contactId: contact.id,
      role: "user",
      content: body,
      at: Date.now(),
    };
    const history = [...msgs, mine];
    setMsgs(history);
    void saveMsgs([mine]);
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
          // 联系人可以覆盖全局默认模型
          model: contact.model.trim() || settings.model,
          system: systemPrompt(contact, settings, diary),
          // event 是「发生了一件事」的痕迹，不是谁说的话，不发给模型。
          messages: history
            .filter((m) => m.role !== "event")
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      // ⚠️ 这个 buffer 不是可有可无的：SSE 的一行经常被切在两个网络分片里。
      // 直接对每个分片 split 换行会把被切开的那行两半都丢掉——症状是长回复
      // 零星掉字（不是尾部截断，所以特别难认）。
      let buf = "";

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
            const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              acc += delta;
              setMsgs((prev) => [
                ...prev.filter((m) => m.id !== replyId),
                {
                  id: replyId,
                  contactId: contact.id,
                  role: "assistant" as const,
                  content: acc,
                  at: Date.now(),
                },
              ]);
            }
          } catch {
            // 单个分片解析不了就跳过这一行，别让整条流断掉
          }
        }
      }

      const reply: Msg = {
        id: replyId,
        contactId: contact.id,
        role: "assistant",
        content: acc,
        at: Date.now(),
      };
      void saveMsgs([reply]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMsgs(history);
    } finally {
      setBusy(false);
    }
  }, [text, busy, contact, msgs, settings, diary]);

  // ── 会话列表 ────────────────────────────────────────────────
  if (!contact) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <header className="px-5 pt-1 pb-3 shrink-0">
          <h1 className="text-[26px] font-semibold" style={{ color: "var(--ink)" }}>
            聊天
          </h1>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto no-bar px-3 pb-4">
          {contacts.map((c) => (
            <button
              key={c.id}
              onClick={() => setOpenId(c.id)}
              className="w-full flex items-center gap-3 px-2 py-3 text-left active:opacity-60"
            >
              <Avatar c={c} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] truncate" style={{ color: "var(--ink)" }}>
                  {displayName(c)}
                </span>
                <span
                  className="block text-[13px] truncate mt-0.5"
                  style={{ color: "var(--ink-faint)" }}
                >
                  {previews[c.id] || "还没说过话"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── 聊天室 ──────────────────────────────────────────────────
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 flex items-center gap-2 px-3 pt-1 pb-2.5">
        <button onClick={() => setOpenId(null)} className="p-1.5 -ml-1 active:opacity-50" aria-label="返回">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--ink)"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        {/* 点头像进主页——个性签名、号码、以后的朋友圈都在那儿 */}
        <button onClick={() => onOpenProfile(contact)} className="flex items-center gap-2.5 active:opacity-60">
          <Avatar c={contact} size={32} />
          <span className="text-[16px] font-medium" style={{ color: "var(--ink)" }}>
            {displayName(contact)}
          </span>
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-2 flex flex-col gap-2.5">
        {msgs.length === 0 && !busy && (
          <div className="flex-1 grid place-items-center px-8">
            <p className="text-[13px]" style={{ color: "var(--ink-faint)" }}>
              还没有说过话。
            </p>
          </div>
        )}

        {msgs.map((m) =>
          m.role === "event" ? (
            // 它没开口，只是有件事发生了。样式刻意和日期分割线同一档。
            <div key={m.id} className="self-center px-6 py-1 text-[11px] text-center leading-relaxed"
              style={{ color: "var(--ink-faint)" }}>
              {m.content}
            </div>
          ) : (
          <div
            key={m.id}
            className={`max-w-[78%] px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words rounded-[20px] ${
              m.role === "user" ? "self-end" : "self-start"
            }`}
            style={
              m.role === "user"
                ? { background: contact.bubble, color: "oklch(0.99 0 0)" }
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
          ),
        )}

        {busy && (
          <div
            className="self-start px-3.5 py-3 rounded-[20px]"
            style={{ background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)" }}
          >
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: "var(--ink-faint)", animationDelay: `${i * 160}ms` }}
                />
              ))}
            </span>
          </div>
        )}

        {err && (
          <div
            className="self-center text-[12px] text-center px-4 py-2 rounded-xl"
            style={{ color: "oklch(0.65 0.19 25)", background: "oklch(0.65 0.19 25 / 0.12)" }}
          >
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
            style={{ background: contact.bubble, color: "oklch(0.99 0 0)" }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
