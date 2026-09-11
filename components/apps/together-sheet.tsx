"use client";
import { useState } from "react";
import { Avatar } from "@/components/phone/avatar";
import { faceOf } from "@/lib/os/avatar";
import { displayName, type Contact } from "@/lib/os/contacts";
import { invite } from "@/lib/music/together";
import type { Track } from "@/lib/music/store";
import type { Settings } from "@/lib/os/settings";

/// 「一起听」。挑一个人 → 发出邀请 → 等它答。
///
/// ⚠️ **入口放在「谁和你在这儿」那一行上，不另开按钮。**
/// 那一行本来就在说这件事（头像 + 自己听／和谁一起听），
/// 再加一个「邀请」按钮等于同一件事有两个位置，而且两个都得维护状态。
/// 音乐首页和播放页各有那一行，所以两个门，一个屋子。
///
/// ⚠️ **邀请是会被拒绝的。** 拒绝了就什么都不改——不要「拒绝了也先开着」，
/// 那样这个功能就只是个装样子的确认框。
export function TogetherSheet({
  settings,
  contacts,
  track,
  onDone,
  onClose,
}: {
  settings: Settings;
  contacts: Contact[];
  track: Track | null;
  /// 答应了：把 togetherWith 设成它
  onDone: (contactId: string) => void;
  onClose: () => void;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [said, setSaid] = useState<{ who: Contact; yes: boolean; text: string } | null>(null);
  const on = settings.togetherWith;

  const ask = async (c: Contact) => {
    setAsking(c.id);
    setSaid(null);
    try {
      const a = await invite(settings, c, track);
      if (!a.said) {
        setSaid({ who: c, yes: false, text: "没问上——没连上模型，再试一次？" });
        return;
      }
      setSaid({ who: c, yes: a.yes, text: a.said });
      if (a.yes) onDone(c.id);
    } finally {
      setAsking(null);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <button aria-label="关掉" onClick={onClose} className="absolute inset-0"
        style={{ background: "oklch(0 0 0 / 0.4)" }} />
      <div className="glass-strong relative rounded-t-[26px] px-5 pt-4 pb-6 anim-rise">
        <div className="w-9 h-1 rounded-full mx-auto mb-4" style={{ background: "var(--ink)", opacity: 0.2 }} />
        <h2 className="text-[16px]" style={{ color: "var(--ink)" }}>
          一起听
        </h2>
        <p className="text-[11.5px] leading-relaxed pt-1 pb-3" style={{ color: "var(--ink-faint)" }}>
          {track ? (
            <>
              现在这首是《{track.title}》。叫上谁？
              <b style={{ color: "var(--ink-dim)" }}>它可以不答应。</b>
            </>
          ) : (
            "先放一首，再叫人。"
          )}
        </p>

        <div className="flex flex-col gap-1">
          {contacts.map((c) => {
            const here = on === c.id;
            return (
              <button
                key={c.id}
                disabled={!!asking}
                onClick={() => (here ? onDone("") : void ask(c))}
                className="flex items-center gap-3 rounded-2xl px-2 py-2 text-left disabled:opacity-50 active:opacity-60"
              >
                <Avatar face={faceOf(c)} size={36} ring />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] truncate" style={{ color: "var(--ink)" }}>
                    {displayName(c)}
                  </span>
                  <span className="block text-[11px]" style={{ color: "var(--ink-faint)" }}>
                    {asking === c.id ? "在问它…" : here ? "正在一起听 · 点一下结束" : "发个邀请"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* 它的回答原样摆出来。**答应和拒绝用同一种样子**——
            把拒绝画成红色的错误提示，等于在说它答错了。 */}
        {said && (
          <div className="flex items-start gap-2.5 pt-3">
            <Avatar face={faceOf(said.who)} size={26} ring />
            <span
              className="rounded-[16px] px-3 py-2 text-[13px] leading-relaxed"
              style={{
                background: "color-mix(in oklab, var(--ink) 7%, transparent)",
                color: "var(--ink)",
              }}
            >
              {said.text}
            </span>
          </div>
        )}
        {said?.yes && (
          <p className="text-[11px] pt-2" style={{ color: "var(--ink-faint)" }}>
            这句也在你们的聊天里了。
          </p>
        )}
      </div>
    </div>
  );
}
