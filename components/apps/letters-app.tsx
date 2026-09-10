"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ENVELOPES,
  blankLetter,
  dayLabel,
  deleteLetter,
  envelopeCss,
  loadLetters,
  claimDue,
  replyDelay,
  saveLetter,
  type Letter,
} from "@/lib/letters/store";
import { PAPER_RULES, PAPER_TINTS, handInk, paperStyle, type PaperRule } from "@/lib/paper";
import { completeOnce, identity } from "@/lib/ai";
import { loadPhotos, type Photo } from "@/lib/photos/store";
import { PhotoImg } from "@/components/photos/photo-img";
import { PhotoPicker } from "@/components/photos/photo-picker";
import { loadMsgs } from "@/lib/chat/store";
import { displayName, type Contact } from "@/lib/os/contacts";
import { hashOf } from "@/lib/id";
import type { Settings } from "@/lib/os/settings";
import { ContactStrip } from "@/components/phone/contact-strip";

/// 信封。封着的时候看得到封口那道 V 和一点封蜡；拆开之后露出里面的纸。
function Envelope({
  tint,
  sealed,
  paper,
  children,
}: {
  tint: string;
  sealed: boolean;
  paper?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{ background: envelopeCss(tint), boxShadow: "0 4px 16px oklch(0 0 0 / 0.16)" }}
    >
      {sealed ? (
        <div className="relative h-[92px]">
          <svg viewBox="0 0 100 46" preserveAspectRatio="none" className="absolute inset-x-0 top-0 w-full h-[46px]">
            <path d="M0 0 L50 34 L100 0" fill="none" stroke="oklch(0 0 0 / 0.16)" strokeWidth="1.2" />
          </svg>
          <span
            className="absolute left-1/2 top-[30px] -translate-x-1/2 w-4 h-4 rounded-full"
            style={{ background: "oklch(0.55 0.16 25 / 0.75)" }}
          />
        </div>
      ) : (
        <div className="p-2">
          <div className="rounded-lg px-3 py-2.5" style={paper}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

export function LettersApp({
  contacts,
  settings,
  onUnreadChange,
}: {
  contacts: Contact[];
  settings: Settings;
  onUnreadChange: () => void;
}) {
  const [who, setWho] = useState(contacts[0]?.id ?? "");
  const [rows, setRows] = useState<Letter[]>([]);
  const [reading, setReading] = useState<Letter | null>(null);
  const [draft, setDraft] = useState<Letter | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, Photo>>({});
  const [picking, setPicking] = useState(false);
  const contact = contacts.find((c) => c.id === who) ?? contacts[0] ?? null;

  const refresh = useCallback(
    async (id: string) => {
      const next = await loadLetters(id);
      setRows(next);
      onUnreadChange();
      return next;
    },
    [onUnreadChange],
  );

  useEffect(() => {
    if (!who && contacts[0]) setWho(contacts[0].id);
  }, [contacts, who]);

  /// 打开信箱时兑现到点的回信。
  ///
  /// 网页没有后台，所以「它在你不看的时候写了封信」只能在你回来时结算。
  /// 这不是妥协——信本来就该是「你回来的时候它在那儿」。
  const settle = useCallback(
    async (c: Contact) => {
      if (!settings.apiKey) return;
      // 挑和占在同一个事务里完成。抢不到就直接回——ref 挡不住组件重新挂载，
      // 只有事务挡得住。
      const due = await claimDue(c.id);
      if (!due) return;

      setBusy(true);
      try {
        const talk = (await loadMsgs(c.id))
          .filter((m) => m.role !== "event")
          .slice(-12)
          .map((m) => `${m.role === "user" ? "她" : "你"}：${m.content}`)
          .join("\n");

        const text = await completeOnce(
          settings,
          c,
          [
            ...identity(c, settings),
            `${dayLabel(due.sentAt)}她寄给你一封信：`,
            due.text,
            talk ? `你们最近还说过这些：\n${talk}` : "",
            "现在你回一封。信比聊天慢，也比聊天沉——不用回应每一句，挑真的想说的那点写。",
            "200~350 字。只输出信的正文，不要称呼行也不要落款，不要任何解释。",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        if (!text) return;

        await saveLetter({
          ...blankLetter(c.id, "them"),
          text,
          paperTint: "sand",
          envelope: "rose",
        });
        await refresh(c.id);
      } catch (e) {
        // 写失败就把坑退回去。**丢一封信比回两封更糟**——她在等。
        await saveLetter({ ...due, replied: false });
        setNote(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [settings, refresh],
  );

  useEffect(() => {
    if (!contact) return;
    void loadPhotos(contact.id).then((all) =>
      setPhotos(Object.fromEntries(all.map((p) => [p.id, p]))),
    );
    void refresh(contact.id).then(() => void settle(contact));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            算了
          </button>
          <button
            onClick={async () => {
              if (!draft.text.trim()) return setDraft(null);
              // 寄出的同时就定好它大概什么时候回。随机，不然第三封就被认出来了。
              await saveLetter({
                ...draft,
                sentAt: Date.now(),
                openedAt: Date.now(),
                replyDueAt: Date.now() + replyDelay(),
                replied: false,
              });
              await refresh(contact.id);
              setDraft(null);
              setNote("寄出去了。");
            }}
            className="text-[14px] active:opacity-50"
            style={{ color: "var(--ink)" }}
          >
            寄出
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
                placeholder={`写给${displayName(contact)}…`}
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
                      style={{
                        border: "3px solid oklch(0.99 0 0)",
                        boxShadow: "0 2px 8px oklch(0 0 0 / 0.2)",
                        transform: `rotate(${(hashOf(id) % 7) - 3}deg)`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-4 pb-2 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
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

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPicking(true)}
              className="text-[11px] mr-2"
              style={{ color: "var(--ink-faint)" }}
            >
              装张照片{draft.photoIds?.length ? ` · ${draft.photoIds.length}` : ""}
            </button>
            <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>信封</span>
            {ENVELOPES.map((e) => (
              <button
                key={e.id}
                onClick={() => setDraft({ ...draft, envelope: e.id })}
                className="w-6 h-6 rounded-md"
                style={{
                  background: e.css,
                  outline: draft.envelope === e.id ? "2px solid var(--ink)" : "none",
                  outlineOffset: 2,
                }}
              />
            ))}
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
            收起来
          </button>
          <button
            onClick={async () => {
              if (!window.confirm("烧掉这封信？")) return;
              await deleteLetter(reading.id);
              await refresh(contact.id);
              setReading(null);
            }}
            className="text-[14px] active:opacity-50"
            style={{ color: "oklch(0.62 0.19 25)" }}
          >
            烧掉
          </button>
        </div>

        <div className="flex-1 min-h-0 px-4 pb-3 overflow-y-auto no-bar">
          <div
            className="rounded-2xl p-5 min-h-full"
            style={{ ...paperStyle(reading.paperTint, reading.paperRule), boxShadow: "0 8px 28px oklch(0 0 0 / 0.18)" }}
          >
            <div className="text-[12px] mb-3" style={{ color: "oklch(0.45 0.02 250)", fontFamily: "var(--font-hand)" }}>
              {dayLabel(reading.sentAt)} · {mine ? `寄给${displayName(contact)}` : `${displayName(contact)}寄来`}
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
                    style={{
                      border: "5px solid oklch(0.99 0 0)",
                      boxShadow: "0 3px 12px oklch(0 0 0 / 0.22)",
                      transform: `rotate(${(hashOf(id) % 7) - 3}deg)`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── 信箱 ────────────────────────────────────────────────────
  const onTheWay = rows.some(
    (l) => l.author === "me" && !l.replied && l.replyDueAt != null && l.replyDueAt > Date.now(),
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {contacts.length > 1 && (
        <div className="shrink-0 flex gap-2 px-4 pb-2 overflow-x-auto no-bar">
          <ContactStrip contacts={contacts} who={who} onPick={setWho} />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-3 flex flex-col gap-3">
        {rows.length === 0 && !busy && (
          <div className="flex-1 grid place-items-center px-8 text-center">
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
              信箱是空的。
              <br />
              写一封寄出去，它会回——但不会马上。
            </p>
          </div>
        )}

        {rows.map((l) => {
          const sealed = l.author === "them" && l.openedAt === null;
          return (
            <button
              key={l.id}
              onClick={async () => {
                setNote(null);
                if (sealed) {
                  // 拆信是个动作。拆过之后就不再是「未拆」了，红点也跟着掉。
                  const opened = { ...l, openedAt: Date.now() };
                  await saveLetter(opened);
                  await refresh(contact.id);
                  setReading(opened);
                  return;
                }
                setReading(l);
              }}
              className="text-left active:scale-[0.98] transition-transform"
            >
              <span
                className="block text-[11px] mb-1.5 px-1"
                style={{ color: "var(--ink-faint)" }}
              >
                {dayLabel(l.sentAt)} ·{" "}
                {l.author === "me" ? `寄给${displayName(contact)}` : sealed ? "还没拆" : `${displayName(contact)}寄来`}
              </span>
              <Envelope
                tint={l.envelope}
                sealed={sealed}
                paper={paperStyle(l.paperTint, "blank")}
              >
                <span className="block text-[15px] line-clamp-2" style={{ ...handInk, lineHeight: "24px" }}>
                  {l.text}
                </span>
              </Envelope>
            </button>
          );
        })}

        {onTheWay && (
          <p className="text-center text-[11px] py-2" style={{ color: "var(--ink-faint)" }}>
            有一封在路上。它写好了，你下次来的时候就在这儿。
          </p>
        )}
      </div>

      <div className="shrink-0 px-4 pb-2 flex gap-2">
        <button
          onClick={() => setDraft(blankLetter(contact.id, "me"))}
          className="glass-strong flex-1 rounded-2xl py-3 text-[14px]"
          style={{ color: "var(--ink)" }}
        >
          写一封
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            if (!settings.apiKey) return setNote("还没填 API key。");
            setBusy(true);
            setNote(null);
            try {
              const talk = (await loadMsgs(contact.id))
                .filter((m) => m.role !== "event")
                .slice(-12)
                .map((m) => `${m.role === "user" ? "她" : "你"}：${m.content}`)
                .join("\n");
              const text = await completeOnce(
                settings,
                contact,
                [
                  ...identity(contact, settings),
                  `今天是${dayLabel(Date.now())}。`,
                  "你要给她写一封信。信比聊天慢，也比聊天沉——不是汇报，是有话想说。",
                  talk ? `你们最近说过这些：\n${talk}` : "",
                  "200~350 字。只输出信的正文，不要称呼行也不要落款，不要任何解释。",
                ]
                  .filter(Boolean)
                  .join("\n"),
              );
              if (!text) throw new Error("它没写出东西");
              await saveLetter({
                ...blankLetter(contact.id, "them"),
                text,
                paperTint: "sand",
                envelope: "rose",
              });
              await refresh(contact.id);
            } catch (e) {
              setNote(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
          className="glass-strong flex-1 rounded-2xl py-3 text-[14px] disabled:opacity-40"
          style={{ color: "var(--ink)" }}
        >
          {busy ? "它在写…" : "让它写一封"}
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
