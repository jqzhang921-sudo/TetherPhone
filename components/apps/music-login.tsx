"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Status = { loggedIn: boolean; name?: string; vip?: boolean; viaEnv?: boolean };

const inputStyle: React.CSSProperties = {
  background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
  border: "1px solid var(--glass-edge)",
  color: "var(--ink)",
};

/// 音乐账号登录。
///
/// 两条路是**针对不同处境**的，不是给人挑好看的：
/// - 扫码：手边有第二块屏（电脑上开着这个页面，用手机的网易云 App 扫）
/// - 手机号 + 短信：**只有一台手机**时唯一走得通的路——屏幕上的码没法用同一台
///   手机去扫
export function MusicLogin({ base }: { base: string }) {
  const [st, setSt] = useState<Status | null>(null);
  const [mode, setMode] = useState<"none" | "qr" | "sms">("none");
  const [qr, setQr] = useState<{ key: string; img: string } | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const timer = useRef<number | null>(null);

  const q = useCallback(
    async (op: string, extra = "") => {
      const r = await fetch(
        `/api/music/login?op=${op}&base=${encodeURIComponent(base)}${extra}`,
      );
      return { ok: r.ok, body: await r.json() };
    },
    [base],
  );

  const refresh = useCallback(async () => {
    const { body } = await q("status");
    setSt(body as Status);
  }, [q]);

  useEffect(() => {
    void refresh();
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [refresh]);

  const startQr = async () => {
    setTip(null);
    const { ok, body } = await q("qr-start");
    if (!ok || !body.img) return setTip(body.error ?? "拿不到二维码");
    setQr({ key: body.key, img: body.img });
    setMode("qr");
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      const { body: s } = await q("qr-check", `&key=${encodeURIComponent(body.key)}`);
      if (s.code === 802) setTip("扫到了，在手机上点确认");
      else if (s.code === 800) {
        setTip("二维码过期了，重新点一次");
        if (timer.current) window.clearInterval(timer.current);
      } else if (s.code === 803) {
        if (timer.current) window.clearInterval(timer.current);
        setMode("none");
        setQr(null);
        setTip(null);
        await refresh();
      }
    }, 2500);
  };

  if (st?.loggedIn) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[13px]" style={{ color: "var(--ink)" }}>
          已登录：{st.name || "（没拿到昵称）"}
          {/* ⚠️ 会员状态要说实话。不说的话，人会以为登录了就该能听全， */}
          {/* 然后对着还是 30 秒的试听怀疑是不是没登上。 */}
          <span style={{ color: "var(--ink-faint)" }}>
            {st.vip ? " · 有会员" : " · 没有会员（VIP 歌仍然只有试听）"}
          </span>
        </p>
        <button
          onClick={async () => {
            await q("logout");
            await refresh();
          }}
          className="text-left text-[13px]"
          style={{ color: "oklch(0.62 0.19 25)" }}
        >
          退出登录
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
        {st?.viaEnv
          ? "服务器上配了一个共用账号。你也可以登自己的——登了就用你自己的。"
          : "不登录也能搜、能看歌词，能完整听的主要是翻唱和冷门。"}
        <br />
        <b style={{ color: "var(--ink-dim)" }}>登录信息不进浏览器存储</b>
        ，所以不会跟着「导出备份」跑掉。
      </p>

      {mode === "none" && (
        <div className="flex gap-2">
          <button
            onClick={() => void startQr()}
            className="flex-1 rounded-2xl py-2.5 text-[13px]"
            style={{ background: "color-mix(in oklab, var(--glass-tint) 80%, transparent)", color: "var(--ink)" }}
          >
            扫码登录
          </button>
          <button
            onClick={() => {
              setMode("sms");
              setTip(null);
            }}
            className="flex-1 rounded-2xl py-2.5 text-[13px]"
            style={{ background: "color-mix(in oklab, var(--glass-tint) 80%, transparent)", color: "var(--ink)" }}
          >
            手机号登录
          </button>
        </div>
      )}

      {mode === "qr" && qr && (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.img} alt="登录二维码" className="w-40 h-40 rounded-xl bg-white p-1" />
          <p className="text-[11px] text-center leading-relaxed" style={{ color: "var(--ink-faint)" }}>
            用网易云 App 扫这个码。
            <br />
            <b style={{ color: "var(--ink-dim)" }}>只有一台手机的话扫不了自己的屏幕</b>
            ——那就用手机号登录。
          </p>
          <button onClick={() => { setMode("none"); setQr(null); }} className="text-[12px]"
            style={{ color: "var(--ink-faint)" }}>
            算了
          </button>
        </div>
      )}

      {mode === "sms" && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="手机号"
              inputMode="numeric"
              className="flex-1 rounded-2xl px-3.5 py-2.5 text-[14px] outline-none"
              style={inputStyle}
            />
            <button
              disabled={sending || !phone.trim()}
              onClick={async () => {
                setSending(true);
                setTip(null);
                const { body } = await q("sms-send", `&phone=${encodeURIComponent(phone.trim())}`);
                setTip(body.ok ? "验证码发出去了" : body.msg || body.error || "发不出去");
                setSending(false);
              }}
              className="shrink-0 rounded-2xl px-3 text-[13px] disabled:opacity-40"
              style={{ background: "color-mix(in oklab, var(--glass-tint) 80%, transparent)", color: "var(--ink)" }}
            >
              发验证码
            </button>
          </div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="收到的验证码"
            inputMode="numeric"
            className="rounded-2xl px-3.5 py-2.5 text-[14px] outline-none"
            style={inputStyle}
          />
          <div className="flex gap-2">
            <button onClick={() => setMode("none")} className="flex-1 rounded-2xl py-2.5 text-[13px]"
              style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink)" }}>
              算了
            </button>
            <button
              disabled={!phone.trim() || !code.trim()}
              onClick={async () => {
                setTip(null);
                const { ok, body } = await q(
                  "sms-login",
                  `&phone=${encodeURIComponent(phone.trim())}&captcha=${encodeURIComponent(code.trim())}`,
                );
                if (ok) {
                  setMode("none");
                  setPhone("");
                  setCode("");
                  await refresh();
                } else setTip(body.error ?? "登录失败");
              }}
              className="flex-1 rounded-2xl py-2.5 text-[13px] disabled:opacity-40"
              style={{ background: "oklch(0.62 0.14 250)", color: "oklch(0.99 0 0)" }}
            >
              登录
            </button>
          </div>
        </div>
      )}

      {tip && (
        <p className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
          {tip}
        </p>
      )}
    </div>
  );
}
