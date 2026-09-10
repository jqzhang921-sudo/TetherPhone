"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadMsgs, saveMsgs, newId, type Msg } from "@/lib/chat/store";
import { displayName, type Contact } from "@/lib/os/contacts";
import { dayLabel, loadDiary, type DiaryEntry } from "@/lib/diary/store";
import {
  MAX_PER_MESSAGE,
  blankPhoto,
  deletePhoto,
  loadPhotos,
  savePhoto,
  shrink,
  toDataUrl,
  type Photo,
} from "@/lib/photos/store";
import { PhotoImg } from "@/components/photos/photo-img";
import { PhotoViewer } from "@/components/photos/photo-viewer";
import { useBlobUrl } from "@/lib/use-blob-url";
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

/// 待发区的一张。发送前还没落库，所以直接拿 Blob 显示。
function PendingThumb({ blob, onDrop }: { blob: Blob; onDrop: () => void }) {
  const url = useBlobUrl(blob);
  return (
    <span className="relative shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url ?? undefined} alt="" className="w-14 h-14 rounded-xl object-cover" />
      <button
        onClick={onDrop}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full grid place-items-center text-[11px]"
        style={{ background: "oklch(0.25 0 0 / 0.8)", color: "oklch(0.98 0 0)" }}
        aria-label="去掉这张"
      >
        ✕
      </button>
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
  const [photos, setPhotos] = useState<Record<string, Photo>>({});
  const [pending, setPending] = useState<{ blob: Blob; w: number; h: number }[]>([]);
  const [viewing, setViewing] = useState<Photo | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const contact = contacts.find((c) => c.id === openId) ?? null;

  const refreshPhotos = useCallback(async (cid: string) => {
    const rows = await loadPhotos(cid);
    setPhotos(Object.fromEntries(rows.map((p) => [p.id, p])));
  }, []);

  // 会话列表要显示每段对话的最后一句
  useEffect(() => {
    if (openId) return;
    let alive = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const c of contacts) {
        const rows = await loadMsgs(c.id);
        const last = rows.at(-1);
        out[c.id] = last ? (last.content.slice(0, 24) || (last.photoIds?.length ? "[图片]" : "")) : "";
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
    void loadMsgs(openId).then((rows) => alive && setMsgs(rows));
    void loadDiary(openId).then((rows) => alive && setDiary(rows));
    void refreshPhotos(openId);
    return () => {
      alive = false;
    };
  }, [openId, refreshPhotos]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy, pending]);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    const room = MAX_PER_MESSAGE - pending.length;
    if (room <= 0) return setErr(`一条最多 ${MAX_PER_MESSAGE} 张`);
    const take = Array.from(files).slice(0, room);
    try {
      // 压缩在选完的时候做，不是发送的时候——发送要等的话，
      // 六张图会让「发送」按下去之后卡住一两秒，看着像没反应。
      const done = await Promise.all(take.map((f) => shrink(f)));
      setPending((p) => [...p, ...done]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const send = useCallback(async () => {
    const body = text.trim();
    if ((!body && !pending.length) || busy || !contact) return;
    if (!settings.apiKey) {
      setErr("还没填 API key。回桌面打开「设置」。");
      return;
    }
    setErr(null);

    // 图先落库拿到 id，消息只存 id
    const shots: Photo[] = pending.map((p) => ({
      ...blankPhoto(contact.id, "me"),
      blob: p.blob,
      w: p.w,
      h: p.h,
    }));
    for (const s of shots) await savePhoto(s);

    const mine: Msg = {
      id: newId(),
      contactId: contact.id,
      role: "user",
      content: body,
      photoIds: shots.length ? shots.map((s) => s.id) : undefined,
      at: Date.now(),
    };
    const history = [...msgs, mine];
    setMsgs(history);
    void saveMsgs([mine]);
    setPending([]);
    setText("");
    setBusy(true);
    if (shots.length) void refreshPhotos(contact.id);

    try {
      // 带图的那条按 OpenAI 多模态格式发。**不猜模型能不能看图**——
      // 按名字猜能力是错的，会把图悄悄丢掉且查不出原因。发过去让上游说话。
      const payload = await Promise.all(
        history
          .filter((m) => m.role !== "event")
          .map(async (m) => {
            const ids = m.photoIds ?? [];
            if (!ids.length) return { role: m.role, content: m.content };
            const parts: unknown[] = [];
            // ⚠️ 没打字发图时**不要**替她编一句「分析这张图片」。
            // 那一句会让它去做图像分析，而不是像收到一张照片那样说话。
            if (m.content.trim()) parts.push({ type: "text", text: m.content });
            for (const id of ids) {
              const p = photos[id] ?? shots.find((s) => s.id === id);
              if (!p) continue;
              parts.push({ type: "image_url", image_url: { url: await toDataUrl(p.blob) } });
            }
            return { role: m.role, content: parts };
          }),
      );

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiBase: settings.apiBase,
          apiKey: settings.apiKey,
          model: contact.model.trim() || settings.model,
          system: systemPrompt(contact, settings, diary),
          messages: payload,
        }),
      });
      if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      // ⚠️ 跨分片缓冲。SSE 的一行经常被切在两个网络分片里，按分片切行会把
      // 被切开的那行两半都丢掉——症状是长回复零星掉字，不是尾部截断。
      let buf = "";
      let acc = "";
      const replyId = newId();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const chunk = t.slice(5).trim();
          if (chunk === "[DONE]") continue;
          try {
            const delta = JSON.parse(chunk)?.choices?.[0]?.delta?.content;
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
      void saveMsgs([
        { id: replyId, contactId: contact.id, role: "assistant", content: acc, at: Date.now() },
      ]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMsgs(history);
    } finally {
      setBusy(false);
    }
  }, [text, pending, busy, contact, msgs, settings, diary, photos, refreshPhotos]);

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
                <span className="block text-[13px] truncate mt-0.5" style={{ color: "var(--ink-faint)" }}>
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
            <div key={m.id} className={`max-w-[78%] flex flex-col gap-1.5 ${m.role === "user" ? "self-end items-end" : "self-start items-start"}`}>
              {!!m.photoIds?.length && (
                <div className={`grid gap-1 ${m.photoIds.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {m.photoIds.map((id) => (
                    <button key={id} onClick={() => photos[id] && setViewing(photos[id])}>
                      <PhotoImg
                        photo={photos[id]}
                        className="rounded-[14px] object-cover w-full"
                        style={{
                          maxHeight: m.photoIds!.length > 1 ? 110 : 210,
                          aspectRatio: m.photoIds!.length > 1 ? "1 / 1" : undefined,
                        }}
                      />
                    </button>
                  ))}
                </div>
              )}
              {!!m.content && (
                <div
                  className="px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words rounded-[20px]"
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
              )}
            </div>
          ),
        )}

        {busy && (
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

      {/* 待发区。选完不立刻发——挑错了能一张张叉掉 */}
      {!!pending.length && (
        <div className="shrink-0 flex gap-2 px-4 pb-1 pt-1 overflow-x-auto no-bar">
          {pending.map((p, i) => (
            <PendingThumb
              key={i}
              blob={p.blob}
              onDrop={() => setPending((cur) => cur.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      )}

      <div className="shrink-0 px-3 pb-1 pt-2">
        <div className="glass-strong rounded-[24px] flex items-end gap-2 px-3 py-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="shrink-0 w-8 h-8 grid place-items-center active:opacity-50"
            aria-label="发图片"
          >
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="var(--ink-dim)"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <circle cx="8.5" cy="10" r="1.4" />
              <path d="M4 17l4.5-4.5a2 2 0 0 1 2.8 0L20 21" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files);
              e.target.value = "";
            }}
          />
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
            disabled={busy || (!text.trim() && !pending.length)}
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

      {viewing && (
        <PhotoViewer
          photo={viewing}
          onClose={() => setViewing(null)}
          onSave={
            viewing.saved
              ? undefined
              : async () => {
                  await savePhoto({ ...viewing, saved: true });
                  await refreshPhotos(contact.id);
                  setViewing(null);
                }
          }
          onDelete={async () => {
            await deletePhoto(viewing.id);
            await refreshPhotos(contact.id);
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}
