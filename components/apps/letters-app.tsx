"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ENVELOPES,
  OPEN_AT_MAX_DAYS,
  blankLetter,
  claimDue,
  dayLabel,
  daysLater,
  daysUntil,
  deleteLetter,
  envelopeCss,
  isoDay,
  loadLetters,
  locked,
  monthLater,
  parseDay,
  replyDelay,
  saveLetter,
  shortDay,
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
import { haptic } from "@/lib/os/haptic";
import type { Settings } from "@/lib/os/settings";
import { ContactStrip } from "@/components/phone/contact-strip";

/// 信封。封着的时候看得到封口那道 V 和一点封蜡；拆开之后露出里面的纸。
/// 约了日子还没到的，右下角手写一行哪天拆。
function Envelope({
  tint,
  sealed,
  lock,
  paper,
  children,
}: {
  tint: string;
  sealed: boolean;
  lock?: string;
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
          {lock && (
            <span
              className="absolute right-4 bottom-2.5 text-[16px]"
              style={{ fontFamily: "var(--font-hand)", color: "oklch(0.3 0.03 30 / 0.7)" }}
            >
              {lock}
            </span>
          )}
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

/// 写信时「哪天拆」的几个现成选项。**at 每次都现算**——过了零点，「明天」就是另一天了。
const WHEN: { name: string; at: () => number | null }[] = [
  { name: "寄到就拆", at: () => null },
  { name: "明天", at: () => daysLater(1) },
  { name: "一周后", at: () => daysLater(7) },
  { name: "一个月后", at: () => monthLater() },
];

const chip = (on: boolean): React.CSSProperties => ({
  background: on
    ? "color-mix(in oklab, var(--glass-tint) 95%, transparent)"
    : "color-mix(in oklab, var(--glass-tint) 55%, transparent)",
  color: "var(--ink)",
});

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
  /// 点了一封没到日子的信：那一封晃一下。n 一变 key 就变，连点连晃
  const [nudge, setNudge] = useState<{ id: string; n: number } | null>(null);
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
            due.openAt
              ? `${dayLabel(due.sentAt)}她寄给你一封信，约好${dayLabel(due.openAt)}才拆。到日子了，你刚拆开：`
              : `${dayLabel(due.sentAt)}她寄给你一封信：`,
            due.text,
            talk ? `你们最近还说过这些：\n${talk}` : "",
            // 约了日子的信，是「那天的她」写给「今天的你」的。
            // ⚠️ 中间这些天它没有在过日子——可以说隔了多久，不能编这些天做了什么
            due.openAt
              ? "这封信是那天的她写的，信里说的「现在」是写信那天的现在。隔了这些日子才读到，回的时候可以带上这段时间；但别编你这些天做过什么。"
              : "",
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
    // 挑的日子不是那几个现成的 → 亮「挑个日子」那颗，上面写着挑的是哪天
    const custom = !!draft.openAt && !WHEN.some((w) => w.at() === draft.openAt);
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-4 pb-2">
          <button onClick={() => setDraft(null)} className="text-[14px] active:opacity-50"
            style={{ color: "var(--ink-dim)" }}>
            算了
          </button>
          {!!draft.openAt && (
            <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
              它{shortDay(draft.openAt)}才拆
            </span>
          )}
          <button
            onClick={async () => {
              if (!draft.text.trim()) return setDraft(null);
              const sentAt = Date.now();
              // 写到过了零点才寄，挑的「明天」可能已经是今天——那就是寄到就拆
              const openAt = draft.openAt && draft.openAt > sentAt ? draft.openAt : null;
              // 寄出的同时就定好它大概什么时候回。随机，不然第三封就被认出来了。
              // 约了日子的从那天零点往后算：它那天才拆，拆了才回
              await saveLetter({
                ...draft,
                openAt,
                sentAt,
                openedAt: sentAt,
                replyDueAt: (openAt ?? sentAt) + replyDelay(),
                replied: false,
              });
              await refresh(contact.id);
              setDraft(null);
              setNote(openAt ? `寄出去了。它要到${shortDay(openAt)}才拆。` : "寄出去了。");
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
          <div className="flex items-center gap-1.5 overflow-x-auto no-bar">
            <span className="shrink-0 text-[11px] mr-0.5" style={{ color: "var(--ink-faint)" }}>哪天拆</span>
            {WHEN.map((w) => (
              <button
                key={w.name}
                onClick={() => setDraft({ ...draft, openAt: w.at() })}
                className="shrink-0 px-2.5 py-1 rounded-full text-[12px]"
                style={chip(!custom && w.at() === (draft.openAt ?? null))}
              >
                {w.name}
              </button>
            ))}
            {/* ⚠️ 日期框透明地盖在这颗上面：手机上点它就是点输入框，系统的日期轮盘自己出来；
                电脑上 Chrome 点输入框本身不弹日历，要在点击里补一句 showPicker。 */}
            <label className="relative shrink-0 px-2.5 py-1 rounded-full text-[12px] overflow-hidden" style={chip(custom)}>
              {custom && draft.openAt ? shortDay(draft.openAt) : "挑个日子"}
              <input
                type="date"
                aria-label="挑一个拆信的日子"
                min={isoDay(daysLater(1))}
                max={isoDay(daysLater(OPEN_AT_MAX_DAYS))}
                value={draft.openAt ? isoDay(draft.openAt) : ""}
                onClick={(e) => {
                  try {
                    (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
                  } catch {
                    // 已经弹着了，或者浏览器不让——手机上本来就会自己弹
                  }
                }}
                onChange={(e) => {
                  const at = parseDay(e.target.value);
                  if (at !== null && at > Date.now() && daysUntil(at) <= OPEN_AT_MAX_DAYS) {
                    setDraft({ ...draft, openAt: at });
                  }
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </label>
          </div>

          <div className="flex items-center gap-2">
            {PAPER_RULES.map((r) => (
              <button
                key={r.id}
                onClick={() => setDraft({ ...draft, paperRule: r.id as PaperRule })}
                className="px-3 py-1.5 rounded-full text-[12px]"
                style={chip(draft.paperRule === r.id)}
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
              {reading.openAt ? ` · 约好${shortDay(reading.openAt)}拆` : ""}
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
  const now = Date.now();
  const name = displayName(contact);
  // 约了日子、还没到的那封不算「在路上」：它还没拆，更谈不上写好了回信
  const onTheWay = rows.some(
    (l) => l.author === "me" && !l.replied && l.replyDueAt != null && l.replyDueAt > now && !locked(l, now),
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
          const wait = locked(l, now);
          const left = l.openAt ? daysUntil(l.openAt, now) : 0;
          const label =
            l.author === "me"
              ? wait
                ? `寄给${name} · 它${shortDay(l.openAt!, now)}才拆`
                : `寄给${name}`
              : !sealed
                ? `${name}寄来`
                : wait
                  ? left <= 1
                    ? "明天就能拆了"
                    : `还有 ${left} 天才能拆`
                  : l.openAt
                    ? "到日子了，可以拆了"
                    : "还没拆";
          return (
            <button
              key={l.id}
              onClick={async () => {
                setNote(null);
                if (sealed && wait) {
                  // 没到日子，拆不开。晃一下、说清楚哪天——不然像是点坏了
                  haptic();
                  setNudge((p) => ({ id: l.id, n: (p?.n ?? 0) + 1 }));
                  setNote(`还没到日子，${shortDay(l.openAt!, now)}才能拆。`);
                  return;
                }
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
                {dayLabel(l.sentAt)} · {label}
              </span>
              <div
                key={nudge?.id === l.id ? `n${nudge.n}` : "still"}
                className={nudge?.id === l.id ? "anim-nudge" : undefined}
              >
                <Envelope
                  tint={l.envelope}
                  sealed={sealed}
                  lock={sealed && wait ? `${shortDay(l.openAt!, now)} 拆` : undefined}
                  paper={paperStyle(l.paperTint, "blank")}
                >
                  <span className="block text-[15px] line-clamp-2" style={{ ...handInk, lineHeight: "24px" }}>
                    {l.text}
                  </span>
                </Envelope>
              </div>
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
