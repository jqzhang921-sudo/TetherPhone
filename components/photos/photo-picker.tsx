"use client";
import { useEffect, useState } from "react";
import { loadPhotos, type Photo } from "@/lib/photos/store";
import { PhotoImg } from "./photo-img";

/// 从相册里挑几张。日记和信都用它。
///
/// **只列收进相册的。** 聊天里随手发的图不该出现在这儿——
/// 贴进日记是件挑过的事，不是从聊天记录里翻。
export function PhotoPicker({
  contactId,
  picked,
  onDone,
  onPick,
  doneLabel,
  onClose,
}: {
  contactId: string;
  picked: string[];
  onDone: (ids: string[]) => void;
  /// 传了它就是单选：点一张立刻回调并关掉，不出下面那个确认按钮。
  /// 挑头像是"挑一张"，多选的编号和"贴 N 张"在那儿是多余的。
  onPick?: (p: Photo) => void;
  /// 底下那个按钮怎么说。默认「贴 N 张」——贴进日记/动态是它最早的用途。
  doneLabel?: (n: number) => string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Photo[]>([]);
  const [sel, setSel] = useState<string[]>(picked);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    void loadPhotos(contactId).then((all) => setRows(all.filter((p) => p.saved)));
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, [contactId]);

  const toggle = (id: string) =>
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <button
        aria-label="关掉"
        onClick={onClose}
        className="absolute inset-0"
        style={{
          background: "oklch(0 0 0 / 0.4)",
          opacity: entered ? 1 : 0,
          transition: "opacity 240ms var(--ease-ios)",
        }}
      />
      <div
        className="glass-strong relative rounded-t-[28px] max-h-[72%] flex flex-col"
        style={{
          transform: entered ? "none" : "translateY(100%)",
          transition: "transform 320ms var(--ease-ios)",
        }}
      >
        <div className="shrink-0 pt-2.5 pb-1 flex justify-center">
          <span className="w-9 h-1 rounded-full" style={{ background: "var(--ink)", opacity: 0.25 }} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-3">
          {rows.length === 0 ? (
            <p className="text-[13px] text-center py-10 leading-relaxed" style={{ color: "var(--ink-faint)" }}>
              相册里还没有图。
              <br />
              去相册加几张，或者把聊天里的图收进来。
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {rows.map((p) => {
                const i = sel.indexOf(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      if (onPick) {
                        onPick(p);
                        onClose();
                      } else toggle(p.id);
                    }}
                    className="relative rounded-lg overflow-hidden"
                    style={{ aspectRatio: "1 / 1" }}
                  >
                    <PhotoImg photo={p} className="w-full h-full object-cover" />
                    {i >= 0 && (
                      <>
                        <span className="absolute inset-0" style={{ background: "oklch(0.2 0 0 / 0.35)" }} />
                        {/* 显示第几张——贴进去的顺序就是选的顺序 */}
                        <span
                          className="absolute top-1 right-1 w-5 h-5 rounded-full grid place-items-center text-[11px]"
                          style={{ background: "oklch(0.62 0.14 250)", color: "oklch(0.99 0 0)" }}
                        >
                          {i + 1}
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 pb-5 pt-1" hidden={!!onPick}>
          <button
            onClick={() => {
              onDone(sel);
              onClose();
            }}
            className="w-full rounded-2xl py-3 text-[15px]"
            style={{ background: "oklch(0.62 0.14 250)", color: "oklch(0.99 0 0)" }}
          >
            {doneLabel ? doneLabel(sel.length) : sel.length ? `贴 ${sel.length} 张` : "不贴了"}
          </button>
        </div>
      </div>
    </div>
  );
}
