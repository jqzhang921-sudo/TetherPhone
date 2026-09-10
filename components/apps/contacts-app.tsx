"use client";
import { displayName, type Contact } from "@/lib/os/contacts";
import { Avatar } from "@/components/phone/avatar";
import { faceOf } from "@/lib/os/avatar";

export function ContactsApp({
  contacts,
  onOpen,
  onAdd,
}: {
  contacts: Contact[];
  onOpen: (c: Contact) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto no-bar px-3 pb-4">
        {contacts.map((c) => (
          <button
            key={c.id}
            onClick={() => onOpen(c)}
            className="w-full flex items-center gap-3 px-2 py-3 text-left active:opacity-60"
          >
            <Avatar face={faceOf(c)} size={44} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] truncate" style={{ color: "var(--ink)" }}>
                {displayName(c)}
              </span>
              <span
                className="block text-[12px] truncate mt-0.5 tabular-nums"
                style={{ color: "var(--ink-faint)" }}
              >
                {c.signature.trim() || c.phone}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="shrink-0 px-4 pb-2">
        <button
          onClick={onAdd}
          className="glass-strong w-full rounded-2xl py-3 text-[15px]"
          style={{ color: "var(--ink)" }}
        >
          新建联系人
        </button>
      </div>
    </div>
  );
}
