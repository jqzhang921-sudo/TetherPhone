"use client";
import { useEffect, useState } from "react";
import { displayName, type Contact } from "@/lib/os/contacts";
import { cropSquare, faceOf } from "@/lib/os/avatar";
import { saveChatBg, clearChatBg } from "@/lib/os/chat-bg";
import { saveContactImage, clearContactImage } from "@/lib/os/contact-image";
import { shrink } from "@/lib/photos/store";
import { PhotoPicker } from "@/components/photos/photo-picker";
import { Avatar } from "./avatar";

const TINTS = [
  "oklch(0.72 0.15 250)",
  "oklch(0.74 0.15 30)",
  "oklch(0.76 0.13 150)",
  "oklch(0.72 0.13 300)",
  "oklch(0.75 0.12 85)",
  "oklch(0.73 0.11 200)",
];

const EMOJI = ["🌙", "🌱", "🐚", "🕯", "🫧", "🍃", "🐈", "🪞", "☁️", "🧊"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
const inputStyle: React.CSSProperties = {
  background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
  border: "1px solid var(--glass-edge)",
  color: "var(--ink)",
};

/// 联系人资料 = 编辑器。刻意只有一份：从聊天页点头像进来的和从通讯录点进来的
/// 是同一个东西，不做「只读版 + 编辑版」两套——那种设计每加一个字段要改两处，
/// 迟早会分叉。
export function ContactSheet({
  contact,
  onSave,
  onDelete,
  onClose,
  canDelete,
}: {
  contact: Contact;
  onSave: (c: Contact) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  canDelete: boolean;
}) {
  const [draft, setDraft] = useState(contact);
  /// 挑图面板现在两个地方用：头像和聊天背景。存一个"挑给谁"而不是两个布尔，
  /// 免得两个都为 true 的状态存在。
  const [picking, setPicking] = useState<"face" | "bg" | "banner" | null>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => setDraft(contact), [contact]);
  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const set = (p: Partial<Contact>) => setDraft((d) => ({ ...d, ...p }));

  const close = () => {
    // 改完直接存，不做「保存/取消」——手机上退出去发现没保存是最恼人的一件事。
    onSave(draft);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-end">
      <button
        aria-label="关闭"
        onClick={close}
        className="absolute inset-0"
        style={{
          background: "oklch(0 0 0 / 0.4)",
          opacity: entered ? 1 : 0,
          transition: "opacity 260ms var(--ease-ios)",
        }}
      />

      <div
        className="glass-strong relative rounded-t-[28px] max-h-[88%] flex flex-col"
        style={{
          transform: entered ? "none" : "translateY(100%)",
          transition: "transform 340ms var(--ease-ios)",
        }}
      >
        <div className="shrink-0 pt-2.5 pb-1 flex justify-center">
          <span className="w-9 h-1 rounded-full" style={{ background: "var(--ink)", opacity: 0.25 }} />
        </div>

        <div className="overflow-y-auto no-bar px-5 pb-6 flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2 pt-1">
            <Avatar face={faceOf(draft)} size={72} />
            <span className="text-[17px] font-medium" style={{ color: "var(--ink)" }}>
              {displayName(draft)}
            </span>
          </div>

          <Row label="头像">
            <div className="flex gap-2 pb-2.5">
              <button
                onClick={() => setPicking("face")}
                className="flex-1 rounded-xl py-2 text-[12px]"
                style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink)" }}
              >
                从相册选
              </button>
              <label
                className="flex-1 rounded-xl py-2 text-[12px] text-center cursor-pointer"
                style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink)" }}
              >
                自己传
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    // 先清空再用：同一张图连选两次的话，value 没变就不会再触发 change
                    e.target.value = "";
                    if (!f) return;
                    // 先压到 640 再裁：手机原图三五兆，直接丢给 createImageBitmap
                    // 是让它解码一张四千万像素的图，只为取中间一个方块
                    const { blob } = await shrink(f, 640, 0.9);
                    set({ avatar: await cropSquare(blob) });
                  }}
                />
              </label>
              {draft.avatar && (
                <button
                  onClick={() => set({ avatar: undefined })}
                  className="rounded-xl px-3 text-[12px]"
                  style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink-faint)" }}
                >
                  去掉
                </button>
              )}
            </div>
            {/* 没设图片时才出现。留着这排而不是删掉——新建一个联系人立刻就有张脸，
                不用先去相册里找图。设了图片再显示就成了摆设：点了没有任何反应。 */}
            <div className="flex flex-wrap gap-2" hidden={!!draft.avatar}>
              {EMOJI.map((e) => (
                <button
                  key={e}
                  onClick={() => set({ emoji: e })}
                  className="w-9 h-9 rounded-full grid place-items-center text-[18px]"
                  style={{
                    background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)",
                    outline: draft.emoji === e ? "2px solid var(--ink)" : "none",
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </Row>

          <Row label="聊天背景">
            <div className="flex gap-2">
              <button
                onClick={() => setPicking("bg")}
                className="flex-1 rounded-xl py-2 text-[12px]"
                style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink)" }}
              >
                从相册选
              </button>
              <label
                className="flex-1 rounded-xl py-2 text-[12px] text-center cursor-pointer"
                style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink)" }}
              >
                自己传
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    // 铺满一屏，别压到 1280——那是聊天图的尺寸
                    const { blob, w, h } = await shrink(f, 1600, 0.86);
                    await saveChatBg(draft.id, blob, w, h);
                    set({ chatBgAt: Date.now() });
                  }}
                />
              </label>
              {draft.chatBgAt && (
                <button
                  onClick={async () => {
                    await clearChatBg(draft.id);
                    set({ chatBgAt: undefined });
                  }}
                  className="rounded-xl px-3 text-[12px]"
                  style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink-faint)" }}
                >
                  去掉
                </button>
              )}
            </div>
            <p className="text-[11px] leading-relaxed pt-2" style={{ color: "var(--ink-faint)" }}>
              只铺在和 TA 的聊天里。深浅从图里算，字和气泡会自己让开。
            </p>
          </Row>

          <Row label="主页横幅">
            <div className="flex gap-2">
              <button
                onClick={() => setPicking("banner")}
                className="flex-1 rounded-xl py-2 text-[12px]"
                style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink)" }}
              >
                从相册选
              </button>
              <label
                className="flex-1 rounded-xl py-2 text-[12px] text-center cursor-pointer"
                style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink)" }}
              >
                自己传
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    // 横幅只占屏幕上面一条，不用壁纸那么大
                    const { blob, w, h } = await shrink(f, 1200, 0.86);
                    await saveContactImage("banner", draft.id, blob, w, h);
                    set({ bannerAt: Date.now() });
                  }}
                />
              </label>
              {draft.bannerAt && (
                <button
                  onClick={async () => {
                    await clearContactImage("banner", draft.id);
                    set({ bannerAt: undefined });
                  }}
                  className="rounded-xl px-3 text-[12px]"
                  style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink-faint)" }}
                >
                  去掉
                </button>
              )}
            </div>
            <p className="text-[11px] leading-relaxed pt-2" style={{ color: "var(--ink-faint)" }}>
              主页最上面那条。<b style={{ color: "var(--ink-dim)" }}>不是头像放大</b>，是另一张图。
            </p>
          </Row>

          <Row label="底色">
            <div className="flex gap-2.5">
              {TINTS.map((t) => (
                <button
                  key={t}
                  onClick={() => set({ tint: t, bubble: t })}
                  className="w-8 h-8 rounded-full"
                  style={{
                    background: t,
                    outline: draft.tint === t ? "2px solid var(--ink)" : "none",
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </Row>

          <Row label="它叫">
            <input
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="还没起名"
              className="w-full rounded-2xl px-3.5 py-2.5 text-[14px] outline-none"
              style={inputStyle}
            />
          </Row>

          <Row label="备注">
            <input
              value={draft.note}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="你怎么叫它。填了就显示这个"
              className="w-full rounded-2xl px-3.5 py-2.5 text-[14px] outline-none"
              style={inputStyle}
            />
          </Row>

          <Row label="个性签名">
            <input
              value={draft.signature}
              onChange={(e) => set({ signature: e.target.value })}
              placeholder="它挂在主页上的一句话"
              className="w-full rounded-2xl px-3.5 py-2.5 text-[14px] outline-none"
              style={inputStyle}
            />
          </Row>

          <Row label="人设">
            <textarea
              value={draft.persona}
              onChange={(e) => set({ persona: e.target.value })}
              rows={5}
              placeholder="留空也能聊。"
              className="w-full rounded-2xl px-3.5 py-2.5 text-[14px] outline-none resize-none leading-relaxed"
              style={inputStyle}
            />
            <span className="block mt-1.5 text-[11px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
              写它是谁、在意什么、怎么说话。别写「贴心的助手」这类标签——
              挂了形容词，模型就去演那个词。
            </span>
          </Row>

          <Row label="模型">
            <input
              value={draft.model}
              onChange={(e) => set({ model: e.target.value })}
              placeholder="留空 = 用设置里的默认"
              className="w-full rounded-2xl px-3.5 py-2.5 text-[14px] outline-none"
              style={inputStyle}
            />
          </Row>

          {canDelete && (
            <button
              onClick={() => {
                if (!window.confirm(`删掉「${displayName(draft)}」？和它的聊天记录一起没。`)) return;
                onDelete(draft.id);
                onClose();
              }}
              className="text-left text-[14px] py-1"
              style={{ color: "oklch(0.62 0.19 25)" }}
            >
              删除这个联系人
            </button>
          )}

          <button
            onClick={close}
            className="mt-1 w-full rounded-2xl py-3 text-[15px]"
            style={{ background: draft.tint, color: "oklch(0.99 0 0)" }}
          >
            完成
          </button>
        </div>
      </div>

      {picking && (
        <PhotoPicker
          contactId={draft.id}
          picked={[]}
          onDone={() => {}}
          onPick={async (ph) => {
            if (picking === "face") {
              set({ avatar: await cropSquare(ph.blob) });
            } else if (picking === "banner") {
              await saveContactImage("banner", draft.id, ph.blob, ph.w, ph.h);
              set({ bannerAt: Date.now() });
            } else {
              await saveChatBg(draft.id, ph.blob, ph.w, ph.h);
              set({ chatBgAt: Date.now() });
            }
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
