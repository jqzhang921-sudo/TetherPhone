"use client";
import { useCallback, useEffect, useState } from "react";
import {
  KINDS,
  deleteTopic,
  digest,
  kindOf,
  loadMemory,
  type MemoryTopic,
} from "@/lib/memory/store";
import { Tree } from "@/components/memory/tree";
import type { Contact } from "@/lib/os/contacts";
import { ContactStrip } from "@/components/phone/contact-strip";

export function MemoryApp({ contacts }: { contacts: Contact[] }) {
  const [who, setWho] = useState(contacts[0]?.id ?? "");
  const [rows, setRows] = useState<MemoryTopic[]>([]);
  const [open, setOpen] = useState<MemoryTopic | null>(null);
  const [raw, setRaw] = useState(false);

  const contact = contacts.find((c) => c.id === who) ?? contacts[0] ?? null;
  const refresh = useCallback(async (cid: string) => setRows(await loadMemory(cid)), []);

  useEffect(() => {
    if (!who && contacts[0]) setWho(contacts[0].id);
  }, [contacts, who]);

  useEffect(() => {
    if (who) void refresh(who);
  }, [who, refresh]);

  if (!contact) {
    return (
      <div className="flex-1 grid place-items-center px-10 text-center">
        <p className="text-[13px]" style={{ color: "var(--ink-faint)" }}>
          先在通讯录里建一个联系人。
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-4 pb-2">
        {contacts.length > 1 &&
          <ContactStrip contacts={contacts} who={who} onPick={setWho} />}
        <span className="flex-1" />
        {/* 「它每轮真正拿到的那段字」——刻意能看原文。
            美化过的摘要会让人以为它记得的比实际多。 */}
        <button
          onClick={() => setRaw((v) => !v)}
          className="px-3 py-1.5 rounded-full text-[12px]"
          style={{
            background: raw ? "color-mix(in oklab, var(--glass-tint) 95%, transparent)" : "transparent",
            color: raw ? "var(--ink)" : "var(--ink-faint)",
          }}
        >
          原文
        </button>
      </div>

      {raw ? (
        <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-4">
          <p className="text-[11px] mb-2" style={{ color: "var(--ink-faint)" }}>
            这就是它每一轮真正拿到的那段。细节不在里面——它要用 open_memory 才看得到。
          </p>
          <pre
            className="text-[12px] leading-relaxed whitespace-pre-wrap rounded-2xl p-3.5"
            style={{
              background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
              color: "var(--ink-dim)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {digest(rows) || "还没有记忆。"}
          </pre>
          <p className="text-[11px] mt-2 text-right" style={{ color: "var(--ink-faint)" }}>
            {digest(rows).length} 字 · 每轮都发
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto no-bar px-3 pb-6">
          {rows.length === 0 ? (
            <div className="h-full grid place-items-center px-8 text-center">
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
                林子还是空的。
                <br />
                它自己会往里种——你们聊着聊着，它觉得该记的就记下了。
              </p>
            </div>
          ) : (
            KINDS.map((k) => {
              const mine = rows.filter((r) => r.kind === k.id);
              if (!mine.length) return null;
              return (
                <section key={k.id} className="mb-1">
                  <div
                    className="text-[11px] px-2 pt-3 pb-1"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    {k.name}
                  </div>
                  {/* 树站在同一条地面上，大小按细节条数长 */}
                  <div
                    className="flex items-end gap-1 flex-wrap px-1 pb-2"
                    style={{ borderBottom: "1px solid var(--glass-edge)" }}
                  >
                    {mine.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setOpen(t)}
                        className="flex flex-col items-center active:opacity-60"
                      >
                        <Tree
                          id={t.id}
                          leaves={t.details.length}
                          tint={k.tint}
                          size={0.85 + Math.min(t.details.length, 12) * 0.055}
                        />
                        <span
                          className="text-[10px] max-w-[72px] truncate"
                          style={{ color: "var(--ink-dim)" }}
                        >
                          {t.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>
      )}

      {open && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end">
          <button
            aria-label="关掉"
            onClick={() => setOpen(null)}
            className="absolute inset-0"
            style={{ background: "oklch(0 0 0 / 0.4)" }}
          />
          <div className="glass-strong relative rounded-t-[28px] max-h-[78%] flex flex-col anim-rise">
            <div className="shrink-0 pt-2.5 pb-1 flex justify-center">
              <span className="w-9 h-1 rounded-full" style={{ background: "var(--ink)", opacity: 0.25 }} />
            </div>

            <div className="overflow-y-auto no-bar px-5 pb-6">
              <div className="flex items-center gap-3 pt-1 pb-3">
                <Tree id={open.id} leaves={open.details.length} tint={kindOf(open.kind).tint} size={1.15} />
                <div className="min-w-0">
                  <div className="text-[17px] font-medium" style={{ color: "var(--ink)" }}>
                    {open.name}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--ink-faint)" }}>
                    {kindOf(open.kind).name} · {open.details.length} 条细节
                  </div>
                </div>
              </div>

              {/* 这一行就是常驻上下文里的那一行。 */}
              <p
                className="text-[14px] leading-relaxed rounded-2xl px-3.5 py-2.5"
                style={{
                  background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
                  color: "var(--ink)",
                }}
              >
                {open.summary}
              </p>

              {open.details.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2">
                  {open.details.map((d, i) => (
                    <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed">
                      <span style={{ color: kindOf(open.kind).tint }}>·</span>
                      <span style={{ color: "var(--ink-dim)" }}>{d}</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-[11px] mt-4 leading-relaxed" style={{ color: "var(--ink-faint)" }}>
                上面那一行它每轮都看得到；下面这些要它自己翻开才看得到。
                {/* 刻意和模型看到的对齐：你点开这一下，等于亲手做了一次 open_memory。 */}
              </p>

              <button
                onClick={async () => {
                  if (!window.confirm(`让它忘掉「${open.name}」？`)) return;
                  await deleteTopic(open.id);
                  await refresh(contact.id);
                  setOpen(null);
                }}
                className="text-left text-[13px] pt-4"
                style={{ color: "oklch(0.62 0.19 25)" }}
              >
                让它忘掉这条
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
