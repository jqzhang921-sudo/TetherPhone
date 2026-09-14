"use client";
import { useEffect, useRef, useState } from "react";
import { StatusBar } from "./status-bar";
import { Avatar } from "./avatar";
import { usePlayer } from "./player";
import { faceOf } from "@/lib/os/avatar";
import { loadMsgs, revealed } from "@/lib/chat/store";
import { displayName, type Contact } from "@/lib/os/contacts";

/// 锁屏。上滑解锁，桌面上点一下也行——鼠标用户没有"上滑"这个动作，
/// 只留手势等于把一半人锁在外面。
///
/// ⚠️ **锁屏上只放「这台手机上刚发生了什么」，不放功能。**
/// 一块只有时间的锁屏等于一道白白多出来的门；但塞成第二个桌面也不对——
/// 锁着的时候你只想知道该不该开它。所以就两样：它最后说的那句、在放的歌。
export function LockScreen({
  contacts,
  onUnlock,
}: {
  contacts: Contact[];
  onUnlock: () => void;
}) {
  const player = usePlayer();
  const [last, setLast] = useState<{ c: Contact; text: string; at: number; morning?: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      let best: { c: Contact; text: string; at: number; morning?: boolean } | null = null;
      const now = Date.now();
      for (const c of contacts) {
        const rows = await loadMsgs(c.id);
        // ⚠️ **只看它说的最后一句**，不是整段对话的最后一条。
        // 她自己刚发的那句显示在锁屏上没有任何意义。
        // ⚠️ 明早才解封的那句，到点之前**不能**上锁屏——那句的 at 在未来，
        // 不滤的话它永远是「最新的一条」，当晚就把惊喜摆出来了。
        const m = [...rows]
          .reverse()
          .find((x) => x.role === "assistant" && x.content.trim() && revealed(x, now));
        if (m && (!best || m.at > best.at))
          best = { c, text: m.content.trim(), at: m.at, morning: !!m.morning };
      }
      if (alive) setLast(best);
    })();
    return () => {
      alive = false;
    };
  }, [contacts]);
  const [now, setNow] = useState<Date | null>(null);
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);

  const hh = now ? String(now.getHours()).padStart(2, "0") : "--";
  const mm = now ? String(now.getMinutes()).padStart(2, "0") : "--";
  const date = now
    ? `${now.getMonth() + 1}月${now.getDate()}日 星期${"日一二三四五六"[now.getDay()]}`
    : "";

  const end = () => {
    if (dy < -90) onUnlock();
    else setDy(0);
    start.current = null;
  };

  return (
    <div
      className="absolute inset-0 flex flex-col anim-fade"
      style={{
        transform: `translateY(${dy}px)`,
        opacity: 1 + dy / 400,
        transition: start.current === null ? "transform 320ms var(--ease-ios), opacity 320ms" : "none",
        touchAction: "none",
      }}
      onPointerDown={(e) => { start.current = e.clientY; }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        setDy(Math.min(0, e.clientY - start.current));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={() => { if (dy === 0) onUnlock(); }}
    >
      <StatusBar />
      <div className="flex-1 flex flex-col items-center pt-16 select-none">
        <div
          className="text-[13px] tracking-[0.2em] mb-1"
          style={{ color: "var(--ink-dim)" }}
        >
          {date}
        </div>
        <div
          className="text-[86px] leading-none font-light tabular-nums"
          style={{ color: "var(--ink)", textShadow: "0 2px 24px oklch(0 0 0 / 0.3)" }}
        >
          {hh}:{mm}
        </div>
      </div>
      {/* 它最后说的那句。**只截两行**——锁屏不是读消息的地方，
          是决定要不要开它的地方。 */}
      {last && (
        <div className="px-4 pb-3">
          <div className="glass rounded-[22px] px-3.5 py-3 flex gap-2.5 items-start">
            <Avatar face={faceOf(last.c)} size={30} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="text-[12px] font-medium truncate" style={{ color: "var(--ink)" }}>
                  {displayName(last.c)}
                </span>
                <span className="text-[10px] shrink-0" style={{ color: "var(--ink-faint)" }}>
                  {/* 昨晚留的那句不写几点：「5:00」是它解封的时刻，不是它说话的时刻 */}
                  {last.morning
                    ? "昨晚给你留的"
                    : `${new Date(last.at).getHours()}:${String(new Date(last.at).getMinutes()).padStart(2, "0")}`}
                </span>
              </span>
              <span
                className="block text-[12px] leading-relaxed mt-0.5"
                style={{
                  // 留给她的那句是写来让她读的，不是一条通知预览：字深一点、多给一行
                  color: last.morning ? "var(--ink)" : "var(--ink-dim)",
                  display: "-webkit-box",
                  WebkitLineClamp: last.morning ? 3 : 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {last.text}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* 在放什么。锁着也该看得见——歌是它放的，那本身就是一句话。 */}
      {player.track && (
        <div className="px-4 pb-3">
          <div className="glass rounded-[22px] px-3.5 py-2.5 flex items-center gap-2.5">
            <span style={{ color: "var(--ink-dim)" }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M9 17V5l10-2v12" />
                <circle cx="6.5" cy="17.5" r="2.6" />
                <circle cx="16.5" cy="15.5" r="2.6" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] truncate" style={{ color: "var(--ink)" }}>
                {player.track.title}
              </span>
              {!!player.track.artist && (
                <span className="block text-[10px] truncate" style={{ color: "var(--ink-faint)" }}>
                  {player.track.artist}
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      <div
        className="flex flex-col items-center gap-3 select-none"
        style={{ paddingBottom: "calc(2rem + var(--sab))" }}
      >
        <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
          上滑解锁
        </span>
        <span
          className="w-[134px] h-[5px] rounded-full"
          style={{ background: "var(--ink)", opacity: 0.45 }}
        />
      </div>
    </div>
  );
}
