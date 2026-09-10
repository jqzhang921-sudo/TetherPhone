"use client";
import { useCallback, useEffect, useState } from "react";
import {
  blankNote,
  deleteNote,
  loadNotes,
  paperOf,
  saveNote,
  type Note,
} from "@/lib/notes/store";
import { hashOf } from "@/lib/id";
import { displayName, type Contact } from "@/lib/os/contacts";
import type { Settings } from "@/lib/os/settings";
import { ContactStrip } from "@/components/phone/contact-strip";
import { Avatar } from "@/components/phone/avatar";
import { faceOf, useMe, type Face } from "@/lib/os/avatar";

function Sticky({
  note,
  who,
  onToggle,
  onDrop,
}: {
  note: Note;
  /// 谁写的：头像和名字。**一块公用的板，看得出是谁贴的才有意义**
  /// ——只写「你写的」三个字，扫一眼分不出哪些是它留的。
  who: { face: Face; name: string };
  onToggle: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      className="rounded-lg px-3 py-2.5 break-inside-avoid mb-2"
      style={{
        background: paperOf(note.id),
        // 每张歪一点点，按 id 取——同一张便签每次看歪的方向一样
        transform: `rotate(${(hashOf(note.id) % 5) - 2}deg)`,
        boxShadow: "0 2px 8px oklch(0 0 0 / 0.16)",
        opacity: note.done ? 0.5 : 1,
      }}
    >
      <button onClick={onToggle} className="flex gap-2 text-left w-full">
        <span
          className="shrink-0 mt-0.5 w-[15px] h-[15px] rounded-[4px] grid place-items-center"
          style={{
            border: "1.5px solid oklch(0.35 0.02 250 / 0.5)",
            background: note.done ? "oklch(0.35 0.02 250 / 0.75)" : "transparent",
          }}
        >
          {note.done && (
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="oklch(0.99 0 0)"
              strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12.5l5.5 5.5L20 6.5" />
            </svg>
          )}
        </span>
        <span
          className="text-[13px] leading-relaxed"
          style={{
            color: "oklch(0.28 0.02 250)",
            textDecoration: note.done ? "line-through" : "none",
          }}
        >
          {note.text}
        </span>
      </button>
      <div className="flex items-center justify-between pt-1.5">
        <span className="flex items-center gap-1">
          <Avatar face={who.face} size={16} />
          <span className="text-[10px]" style={{ color: "oklch(0.45 0.02 250)" }}>
            {who.name}
          </span>
        </span>
        {note.done && (
          <button onClick={onDrop} className="text-[10px]" style={{ color: "oklch(0.45 0.02 250)" }}>
            撕掉
          </button>
        )}
      </div>
    </div>
  );
}

export function NotesApp({
  contacts,
  settings,
}: {
  contacts: Contact[];
  settings: Settings;
}) {
  const meFace = useMe(settings);
  const me = { face: meFace, name: settings.userName.trim() || "你" };
  const [who, setWho] = useState(contacts[0]?.id ?? "");
  const [rows, setRows] = useState<Note[]>([]);
  const [text, setText] = useState("");

  const contact = contacts.find((c) => c.id === who) ?? contacts[0] ?? null;
  const refresh = useCallback(async (cid: string) => setRows(await loadNotes(cid)), []);

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

  const todo = rows.filter((n) => !n.done);
  const done = rows.filter((n) => n.done);

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    await saveNote(blankNote(contact.id, "me", t));
    setText("");
    await refresh(contact.id);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {contacts.length > 1 && (
        <div className="shrink-0 flex gap-2 px-4 pb-2">
          {<ContactStrip contacts={contacts} who={who} onPick={setWho} />}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-3">
        {rows.length === 0 && (
          <div className="h-full grid place-items-center px-8 text-center">
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
              板上还什么都没有。
              <br />
              这块板你们俩共用——它也能往上贴。
            </p>
          </div>
        )}

        {todo.length > 0 && (
          <div style={{ columnCount: 2, columnGap: "0.5rem" }}>
            {todo.map((n) => (
              <Sticky
                key={n.id}
                note={n}
                who={
                  n.author === "me"
                    ? me
                    : { face: faceOf(contact), name: displayName(contact) }
                }
                onToggle={async () => {
                  await saveNote({ ...n, done: true, doneAt: Date.now() });
                  await refresh(contact.id);
                }}
                onDrop={async () => {
                  await deleteNote(n.id);
                  await refresh(contact.id);
                }}
              />
            ))}
          </div>
        )}

        {done.length > 0 && (
          <>
            <div className="text-[11px] px-1 pt-3 pb-2" style={{ color: "var(--ink-faint)" }}>
              做完的 · 留一周，随时能撤
            </div>
            <div style={{ columnCount: 2, columnGap: "0.5rem" }}>
              {done.map((n) => (
                <Sticky
                  key={n.id}
                  note={n}
                  who={
                  n.author === "me"
                    ? me
                    : { face: faceOf(contact), name: displayName(contact) }
                }
                  onToggle={async () => {
                    // 撤销：勾回去，重新算它的一周
                    await saveNote({ ...n, done: false, doneAt: null });
                    await refresh(contact.id);
                  }}
                  onDrop={async () => {
                    await deleteNote(n.id);
                    await refresh(contact.id);
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 px-3 pb-1 pt-1">
        <div className="glass-strong rounded-[24px] flex items-end gap-2 px-3 py-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void add();
              }
            }}
            rows={1}
            placeholder="要记得的事"
            className="flex-1 bg-transparent outline-none resize-none text-[14px] max-h-20 py-1.5"
            style={{ color: "var(--ink)" }}
          />
          <button
            onClick={() => void add()}
            disabled={!text.trim()}
            className="shrink-0 w-9 h-9 rounded-full grid place-items-center disabled:opacity-30"
            style={{ background: contact.tint, color: "oklch(0.99 0 0)" }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
