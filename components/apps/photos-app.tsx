"use client";
import { useCallback, useEffect, useState } from "react";
import {
  deletePhoto,
  loadPhotos,
  savePhoto,
  shrink,
  blankPhoto,
  type Photo,
} from "@/lib/photos/store";
import { PhotoImg } from "@/components/photos/photo-img";
import { PhotoViewer } from "@/components/photos/photo-viewer";
import type { Contact } from "@/lib/os/contacts";

export function PhotosApp({ contacts }: { contacts: Contact[] }) {
  const [who, setWho] = useState(contacts[0]?.id ?? "");
  const [rows, setRows] = useState<Photo[]>([]);
  const [all, setAll] = useState(false);
  const [viewing, setViewing] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);

  const contact = contacts.find((c) => c.id === who) ?? contacts[0] ?? null;

  const refresh = useCallback(async (cid: string) => setRows(await loadPhotos(cid)), []);

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

  const shown = all ? rows : rows.filter((p) => p.saved);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-4 pb-2">
        {contacts.length > 1 &&
          contacts.map((c) => (
            <button
              key={c.id}
              onClick={() => setWho(c.id)}
              className="shrink-0 w-8 h-8 rounded-full grid place-items-center text-[16px]"
              style={{
                background: c.tint,
                opacity: c.id === who ? 1 : 0.4,
                outline: c.id === who ? "2px solid var(--ink)" : "none",
                outlineOffset: 2,
              }}
            >
              {c.emoji}
            </button>
          ))}
        <span className="flex-1" />
        {/* 「收着的」和「聊天里出现过的」是两件事。默认只看收着的——
            相册要是把每张随手发的图都堆进来，收藏这个动作就没意义了。 */}
        {(["收着的", "全部"] as const).map((label, i) => (
          <button
            key={label}
            onClick={() => setAll(i === 1)}
            className="px-3 py-1.5 rounded-full text-[12px]"
            style={{
              background:
                (i === 1) === all
                  ? "color-mix(in oklab, var(--glass-tint) 95%, transparent)"
                  : "transparent",
              color: (i === 1) === all ? "var(--ink)" : "var(--ink-faint)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-3">
        {shown.length === 0 ? (
          <div className="h-full grid place-items-center px-8 text-center">
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
              {all ? "还没有图。" : "还没收过图。"}
              <br />
              聊天里发的图，点开能收进来。写日记贴图也从这儿挑。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {shown.map((p) => (
              <button
                key={p.id}
                onClick={() => setViewing(p)}
                className="relative rounded-lg overflow-hidden active:opacity-70"
                style={{ aspectRatio: "1 / 1" }}
              >
                <PhotoImg photo={p} className="w-full h-full object-cover" />
                {!p.saved && (
                  <span
                    className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full"
                    style={{ background: "oklch(0.98 0 0 / 0.85)" }}
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-2">
        <label
          className="glass-strong block w-full rounded-2xl py-3 text-[14px] text-center"
          style={{ color: "var(--ink)", opacity: busy ? 0.5 : 1 }}
        >
          {busy ? "在收…" : "从手机里加几张"}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={busy}
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (!files.length) return;
              setBusy(true);
              try {
                for (const f of files) {
                  const { blob, w, h } = await shrink(f);
                  // 自己加进来的直接算收着了——是她特意挑的，不用再收一次
                  await savePhoto({ ...blankPhoto(contact.id, "me"), blob, w, h, saved: true });
                }
                await refresh(contact.id);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
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
                  await refresh(contact.id);
                  setViewing(null);
                }
          }
          onDelete={async () => {
            await deletePhoto(viewing.id);
            await refresh(contact.id);
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}
