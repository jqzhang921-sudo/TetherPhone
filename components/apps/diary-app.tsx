"use client";
import { useEffect, useState } from "react";
import {
  PAPER_RULES,
  PAPER_TINTS,
  blankEntry,
  dayLabel,
  deleteEntry,
  loadDiary,
  paperStyle,
  saveEntry,
  tintCss,
  type DiaryEntry,
  type PaperRule,
} from "@/lib/diary/store";
import { handInk } from "@/lib/paper";
import { loadPhotos, type Photo } from "@/lib/photos/store";
import { PhotoImg } from "@/components/photos/photo-img";
import { PhotoPicker } from "@/components/photos/photo-picker";
import { loadMsgs, newId, saveMsgs, type Msg } from "@/lib/chat/store";
import { displayName, type Contact } from "@/lib/os/contacts";
import { hashOf } from "@/lib/id";
import type { Settings } from "@/lib/os/settings";
import { ContactStrip } from "@/components/phone/contact-strip";
import { Avatar } from "@/components/phone/avatar";
import { faceOf, useMe } from "@/lib/os/avatar";

/// 一次性把整条流读完。日记不需要逐字出现——它是「写好了拿给你看」，
/// 不是「正在说话」。
async function askForDiary(settings: Settings, c: Contact, recent: Msg[]) {
  const talk = recent
    .filter((m) => m.role !== "event")
    .slice(-16)
    .map((m) => `${m.role === "user" ? "她" : "你"}：${m.content}`)
    .join("\n");

  const prompt = [
    c.name.trim() ? `你叫${c.name.trim()}。` : "",
    c.persona.trim(),
    `今天是${dayLabel(Date.now())}。`,
    "你在写自己的日记——写给自己的，不是写给她看的。",
    talk ? `最近你们说过这些：\n${talk}` : "",
    "写 150~250 字。只输出正文，不要标题、不要日期、不要任何解释。",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiBase: settings.apiBase,
      apiKey: settings.apiKey,
      model: c.model.trim() || settings.model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
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
        /* 跳过解析不了的分片 */
      }
    }
  }
  return out.trim();
}

function Lock() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function DiaryApp({
  contacts,
  settings,
}: {
  contacts: Contact[];
  settings: Settings;
}) {
  const me = useMe(settings);
  const [who, setWho] = useState(contacts[0]?.id ?? "");
  const [rows, setRows] = useState<DiaryEntry[]>([]);
  const [reading, setReading] = useState<DiaryEntry | null>(null);
  const [draft, setDraft] = useState<DiaryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, Photo>>({});
  const [picking, setPicking] = useState(false);

  const contact = contacts.find((c) => c.id === who) ?? contacts[0] ?? null;

  const refresh = async (id: string) => setRows(await loadDiary(id));

  useEffect(() => {
    if (!who && contacts[0]) setWho(contacts[0].id);
  }, [contacts, who]);

  useEffect(() => {
    if (!who) return;
    void refresh(who);
    void loadPhotos(who).then((all) => setPhotos(Object.fromEntries(all.map((p) => [p.id, p]))));
  }, [who]);

  if (!contact) {
    return (
      <div className="flex-1 grid place-items-center px-10 text-center">
        <p className="text-[13px]" style={{ color: "var(--ink-faint)" }}>
          先在通讯录里建一个联系人。
        </p>
      </div>
    );
  }

  // ── 写 ──────────────────────────────────────────────────────
  if (draft) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-4 pb-2">
          <button onClick={() => setDraft(null)} className="text-[14px] active:opacity-50"
            style={{ color: "var(--ink-dim)" }}>
            放下
          </button>
          <button
            onClick={async () => {
              if (!draft.text.trim()) return setDraft(null);
              await saveEntry({ ...draft, at: Date.now() });
              await refresh(contact.id);
              setDraft(null);
            }}
            className="text-[14px] active:opacity-50"
            style={{ color: "var(--ink)" }}
          >
            收好
          </button>
        </div>

        <div className="flex-1 min-h-0 px-4 pb-3">
          <div
            className="h-full rounded-2xl p-5 overflow-hidden"
            style={{ ...paperStyle(draft.paperTint, draft.paperRule), boxShadow: "0 8px 28px oklch(0 0 0 / 0.18)" }}
          >
            <div className="h-full flex flex-col">
              <textarea
                autoFocus
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                placeholder="今天…"
                className="flex-1 min-h-0 w-full bg-transparent outline-none resize-none text-[19px]"
                style={handInk}
              />
              {!!draft.photoIds?.length && (
                <div className="shrink-0 flex gap-2 pt-2 overflow-x-auto no-bar">
                  {draft.photoIds.map((id) => (
                    <PhotoImg
                      key={id}
                      photo={photos[id]}
                      className="w-16 h-16 rounded-sm object-cover shrink-0"
                      // 贴纸的样子：白边 + 一点点歪，像真的粘上去的
                      style={{ border: "3px solid oklch(0.99 0 0)", boxShadow: "0 2px 8px oklch(0 0 0 / 0.2)", transform: `rotate(${(hashOf(id) % 7) - 3}deg)` }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-4 pb-2 flex flex-col gap-3">
          <div className="flex gap-2">
            {PAPER_RULES.map((r) => (
              <button
                key={r.id}
                onClick={() => setDraft({ ...draft, paperRule: r.id as PaperRule })}
                className="px-3 py-1.5 rounded-full text-[12px]"
                style={{
                  background:
                    draft.paperRule === r.id
                      ? "color-mix(in oklab, var(--glass-tint) 95%, transparent)"
                      : "color-mix(in oklab, var(--glass-tint) 55%, transparent)",
                  color: "var(--ink)",
                }}
              >
                {r.name}
              </button>
            ))}
            <span className="flex-1" />
            {PAPER_TINTS.map((t) => (
              <button
                key={t.id}
                onClick={() => setDraft({ ...draft, paperTint: t.id })}
                className="w-6 h-6 rounded-full"
                style={{
                  background: t.css,
                  outline: draft.paperTint === t.id ? "2px solid var(--ink)" : "none",
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>

          <div className="flex items-center gap-4">
          <button
            onClick={() => setPicking(true)}
            className="text-[12px]"
            style={{ color: "var(--ink-faint)" }}
          >
            贴图{draft.photoIds?.length ? ` · ${draft.photoIds.length}` : ""}
          </button>
          <button
            onClick={() => setDraft({ ...draft, secret: !draft.secret })}
            className="flex items-center gap-2 text-[12px]"
            style={{ color: draft.secret ? "var(--ink)" : "var(--ink-faint)" }}
          >
            <Lock />
            {draft.secret
              ? `只有你看得见，${displayName(contact)}读不到`
              : `${displayName(contact)}能读到这篇`}
          </button>
          </div>
        </div>

        {picking && (
          <PhotoPicker
            contactId={contact.id}
            picked={draft.photoIds ?? []}
            onDone={(ids) => setDraft({ ...draft, photoIds: ids.length ? ids : undefined })}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    );
  }

  // ── 读 ──────────────────────────────────────────────────────
  if (reading) {
    const mine = reading.author === "me";
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-4 pb-2">
          <button onClick={() => setReading(null)} className="text-[14px] active:opacity-50"
            style={{ color: "var(--ink-dim)" }}>
            合上
          </button>
          <button
            onClick={async () => {
              if (!window.confirm("撕掉这一页？")) return;
              await deleteEntry(reading.id);
              await refresh(contact.id);
              setReading(null);
            }}
            className="text-[14px] active:opacity-50"
            style={{ color: "oklch(0.62 0.19 25)" }}
          >
            撕掉
          </button>
        </div>

        <div className="flex-1 min-h-0 px-4 pb-3 overflow-y-auto no-bar">
          <div
            className="rounded-2xl p-5 min-h-full"
            style={{ ...paperStyle(reading.paperTint, reading.paperRule), boxShadow: "0 8px 28px oklch(0 0 0 / 0.18)" }}
          >
            <div className="text-[12px] mb-3" style={{ color: "oklch(0.45 0.02 250)", fontFamily: "var(--font-hand)" }}>
              {dayLabel(reading.at)} · {mine ? "你" : displayName(contact)}
            </div>
            <p className="text-[19px] whitespace-pre-wrap" style={handInk}>
              {reading.text}
            </p>
            {!!reading.photoIds?.length && (
              <div className="flex flex-wrap gap-3 pt-5">
                {reading.photoIds.map((id) => (
                  <PhotoImg
                    key={id}
                    photo={photos[id]}
                    className="w-28 h-28 rounded-sm object-cover"
                    style={{ border: "5px solid oklch(0.99 0 0)", boxShadow: "0 3px 12px oklch(0 0 0 / 0.22)", transform: `rotate(${(hashOf(id) % 7) - 3}deg)` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 px-4 pb-2">
          {reading.secret && mine ? (
            <button
              onClick={async () => {
                const opened = { ...reading, secret: false };
                await saveEntry(opened);
                // ⚠️ 公开是一个**动作**，不只是一个开关。它在聊天里留下一行，
                // 于是这件事有了时间、有了来由——否则翻过去就没了。
                const ev: Msg = {
                  id: newId(),
                  contactId: contact.id,
                  role: "event",
                  content: `你把 ${dayLabel(reading.at)} 那篇日记给${displayName(contact)}看了`,
                  at: Date.now(),
                };
                await saveMsgs([ev]);
                await refresh(contact.id);
                setReading(opened);
                setNote("给它看了。聊天里留了一行。");
              }}
              className="w-full rounded-2xl py-3 text-[14px]"
              style={{ background: contact.tint, color: "oklch(0.99 0 0)" }}
            >
              给{displayName(contact)}看这一篇
            </button>
          ) : (
            <p className="text-center text-[11px] py-2" style={{ color: "var(--ink-faint)" }}>
              {reading.secret ? "这一篇它没给你看" : "这一篇它读得到"}
            </p>
          )}
          {note && (
            <p className="text-center text-[11px] pt-1" style={{ color: "var(--ink-faint)" }}>
              {note}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── 列表 ────────────────────────────────────────────────────
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {contacts.length > 1 && (
        <div className="shrink-0 flex gap-2 px-4 pb-2 overflow-x-auto no-bar">
          <ContactStrip contacts={contacts} who={who} onPick={setWho} />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-3 flex flex-col gap-3">
        {rows.length === 0 && (
          <div className="flex-1 grid place-items-center px-8 text-center">
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
              本子还是空的。
              <br />
              两个人都能往里写，写完自己决定给不给对方看。
            </p>
          </div>
        )}

        {rows.map((e) => {
          // 它写的、还没给你看的那页——**列表里就打不开**，
          // 不是打开之后才拦。锁着的东西被点开一半是最假的。
          const sealed = e.author === "them" && e.secret;
          return (
          <button
            key={e.id}
            disabled={sealed}
            onClick={() => {
              setNote(null);
              setReading(e);
            }}
            className="text-left rounded-2xl p-4 active:scale-[0.98] transition-transform"
            style={{ ...paperStyle(e.paperTint, e.paperRule, 26), boxShadow: "0 4px 16px oklch(0 0 0 / 0.14)" }}
          >
            <span className="flex items-center gap-1.5 text-[11px] mb-1.5"
              style={{ color: "oklch(0.45 0.02 250)" }}>
              <Avatar face={e.author === "me" ? me : faceOf(contact)} size={16} />
              {dayLabel(e.at)}
              {e.secret && <Lock />}
            </span>
            <span className="block text-[16px] line-clamp-2" style={{ ...handInk, lineHeight: "26px" }}>
              {sealed ? "……" : e.text}
            </span>
          </button>
          );
        })}
      </div>

      <div className="shrink-0 px-4 pb-2 flex gap-2">
        <button
          onClick={() => setDraft(blankEntry(contact.id, "me"))}
          className="glass-strong flex-1 rounded-2xl py-3 text-[14px]"
          style={{ color: "var(--ink)" }}
        >
          写一篇
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            if (!settings.apiKey) return setNote("还没填 API key。");
            setBusy(true);
            setNote(null);
            try {
              const recent = await loadMsgs(contact.id);
              const text = await askForDiary(settings, contact, recent);
              if (!text) throw new Error("它没写出东西");
              // 默认锁着——它也该有不给你看的一页。
              //
              // ⚠️ 这一条成立的前提是**它自己能开**（open_diary 工具，见 lib/tools.ts）。
              // 在有那个工具之前不能这么做：锁上就永远打不开，那不是"它有秘密"，
              // 是"这功能坏了"。做「交换」（你开一篇它开一篇）也不行——那是交易。
              await saveEntry({ ...blankEntry(contact.id, "them"), text, secret: true, paperTint: "sand" });
              await refresh(contact.id);
            } catch (err) {
              setNote(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
          className="glass-strong flex-1 rounded-2xl py-3 text-[14px] disabled:opacity-40"
          style={{ color: "var(--ink)" }}
        >
          {busy ? "它在写…" : "让它写一篇"}
        </button>
      </div>

      {note && (
        <p className="shrink-0 text-center text-[11px] pb-2" style={{ color: "var(--ink-faint)" }}>
          {note}
        </p>
      )}
    </div>
  );
}
