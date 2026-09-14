"use client";
import { useState } from "react";
import { Avatar } from "@/components/phone/avatar";
import { faceOf } from "@/lib/os/avatar";
import { displayName, type Contact } from "@/lib/os/contacts";
import { newId, saveMsgs, type Share } from "@/lib/chat/store";
import type { Post } from "@/lib/moments/store";

/// 把一条动态转给某个联系人。
///
/// ⚠️ **先选人，再按「发给 X」，不是点一下名字就发。** 发出去会跳进那个人的聊天、
/// 它会接着回一句——点错了名字，就是把动态甩给了不该给的人，外加一次模型调用。
/// 真聊天软件的转发都要确认一步，理由一样。
export function ForwardSheet({
  post,
  feed,
  contacts,
  meName,
  onSent,
  onClose,
}: {
  post: Post;
  /// 这条动态在谁的那一页上。author = them 时，发帖人就是它
  feed: Contact;
  contacts: Contact[];
  /// 她自己的名字。她发的动态转出去，卡片上写这个
  meName: string;
  /// 发完：去那个人的聊天
  onSent: (contactId: string) => void;
  onClose: () => void;
}) {
  const [to, setTo] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);

  /// 发帖人是谁，**得相对收到的那个人重新算一遍**（见 Share.by 的注释）。
  const shareFor = (target: Contact): Share => ({
    kind: "post",
    postId: post.id,
    by: post.author === "me" ? "her" : feed.id === target.id ? "you" : "other",
    byName: post.author === "me" ? meName : displayName(feed),
    text: post.text,
    photoIds: post.photoIds?.length ? post.photoIds : undefined,
    at: post.at,
  });

  const send = async () => {
    if (!to || busy) return;
    setBusy(true);
    try {
      await saveMsgs([
        {
          id: newId(),
          contactId: to.id,
          role: "user",
          // 正文留空：卡片本身就是这条消息。想附一句话，到聊天里接着说——
          // 那样它回的时候两样都看得到，也不会出现「附言发了，它却没回」。
          content: "",
          share: shareFor(to),
          at: Date.now(),
        },
      ]);
      onSent(to.id);
    } finally {
      setBusy(false);
    }
  };

  const preview = post.text.trim() || (post.photoIds?.length ? `[${post.photoIds.length} 张图]` : "");

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <button
        aria-label="关掉"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "oklch(0 0 0 / 0.4)" }}
      />
      <div className="glass-strong relative rounded-t-[26px] px-5 pt-4 pb-6 anim-rise max-h-[80%] flex flex-col">
        <div
          className="w-9 h-1 rounded-full mx-auto mb-4 shrink-0"
          style={{ background: "var(--ink)", opacity: 0.2 }}
        />
        <h2 className="text-[16px] shrink-0" style={{ color: "var(--ink)" }}>
          转发给
        </h2>
        {/* 转的是哪条，给一眼。一整屏动态里点了「转发」，得确认没点错条 */}
        <p
          className="text-[12px] leading-relaxed pt-1 pb-3 shrink-0 line-clamp-2"
          style={{ color: "var(--ink-faint)" }}
        >
          「{preview}」
        </p>

        <div className="flex-1 min-h-0 overflow-y-auto no-bar flex flex-col gap-1">
          {contacts.map((c) => {
            const on = to?.id === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setTo(on ? null : c)}
                className="flex items-center gap-3 rounded-2xl px-2 py-2 text-left active:opacity-60"
                style={{
                  background: on ? "color-mix(in oklab, var(--ink) 8%, transparent)" : "transparent",
                }}
              >
                <Avatar face={faceOf(c)} size={36} ring />
                <span className="min-w-0 flex-1 text-[14px] truncate" style={{ color: "var(--ink)" }}>
                  {displayName(c)}
                </span>
                {/* 这条本来就是它发的——转回给它自己也行，但要让她知道是在转给原作者 */}
                {post.author === "them" && c.id === feed.id && (
                  <span className="shrink-0 text-[11px]" style={{ color: "var(--ink-faint)" }}>
                    它发的
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => void send()}
          disabled={!to || busy}
          className="shrink-0 w-full rounded-2xl py-3 text-[14px] mt-4 disabled:opacity-35"
          style={{
            background: to ? to.tint : "color-mix(in oklab, var(--ink) 10%, transparent)",
            color: to ? "oklch(0.99 0 0)" : "var(--ink)",
          }}
        >
          {busy ? "在发…" : to ? `发给${displayName(to)}` : "先选一个人"}
        </button>
      </div>
    </div>
  );
}
