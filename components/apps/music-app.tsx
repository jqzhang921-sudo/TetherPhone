"use client";
import { useCallback, useEffect, useState } from "react";
import {
  deleteTrack,
  loadTracks,
  localTrack,
  lyric as fetchLyric,
  saveTrack,
  search,
  PHONE,
  type Found,
  type Track,
} from "@/lib/music/store";
import { mmss, usePlayer } from "@/components/phone/player";
import { MusicPlayer } from "./music-player";
import { displayName, type Contact } from "@/lib/os/contacts";
import { newId } from "@/lib/id";
import type { Settings } from "@/lib/os/settings";
import { Avatar } from "@/components/phone/avatar";
import { faceOf, useMe } from "@/lib/os/avatar";

function Bars({ on }: { on: boolean }) {
  return (
    <span className="flex items-end gap-[2px] h-3.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full"
          style={{
            background: "currentColor",
            height: on ? undefined : "40%",
            animation: on ? `bar 900ms ${i * 140}ms ease-in-out infinite` : "none",
          }}
        />
      ))}
    </span>
  );
}

/// 一起听了多久。**不满一分钟就说秒**——「一起听了 0 分钟」看着像坏了。
function span(sec: number) {
  if (sec < 60) return `${Math.floor(sec)} 秒`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

/// 一张唱片。**不用 emoji**——样子由系统定，iPhone / 安卓 / Windows 三个样，
/// 和界面永远不搭。也不画实心色块：这块地方是要「安静地占着」，不是要抢眼。
function Disc() {
  return (
    <svg viewBox="0 0 96 96" width="84" height="84" aria-hidden>
      <circle cx="48" cy="48" r="45" fill="none" stroke="var(--ink)" strokeOpacity="0.11" />
      <circle cx="48" cy="48" r="34" fill="none" stroke="var(--ink)" strokeOpacity="0.085" />
      <circle cx="48" cy="48" r="23" fill="none" stroke="var(--ink)" strokeOpacity="0.065" />
      <circle cx="48" cy="48" r="7" fill="var(--ink)" fillOpacity="0.1" />
      {/* 斜着的一道高光，免得它看起来像个靶子 */}
      <path
        d="M19 27 A37 37 0 0 1 71 19"
        fill="none"
        stroke="var(--ink)"
        strokeOpacity="0.16"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/// 曲库空着时的样子。
///
/// ⚠️ **空状态是这个 app 唯一保证会被看到的界面**——第一次打开必然是空的。
/// 原来它是一句灰字，而且指了一条走不通的路（「配了音源之后去找歌」，
/// 可怎么配、去哪配都没说）。**空状态要么给一个能当场按下去的东西，
/// 要么就不配占着满屏这块地方。**
function Empty({
  onAdd,
  onHookup,
}: {
  onAdd: (f: FileList | null) => void;
  onHookup: () => void;
}) {
  return (
    <div className="h-full grid place-items-center px-8">
      <div className="flex flex-col items-center gap-5 -mt-6">
        <Disc />
        {/* text-balance：不加的话最后会孤零零掉下来一个「源。」 */}
        <p
          className="text-[13px] leading-relaxed text-center text-balance"
          style={{ color: "var(--ink-faint)" }}
        >
          还没有歌。本地文件加进来就能听。
          <br />
          网易云那些要先接一个音源。
        </p>
        <div className="flex gap-2.5">
          <label
            className="glass-strong rounded-full px-4 py-2 text-[13px] cursor-pointer"
            style={{ color: "var(--ink)" }}
          >
            加本地文件
            <input
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={(e) => {
                onAdd(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <button
            onClick={onHookup}
            className="rounded-full px-4 py-2 text-[13px]"
            style={{
              background: "color-mix(in oklab, var(--ink) 8%, transparent)",
              color: "var(--ink-dim)",
            }}
          >
            怎么接网易云
          </button>
        </div>
      </div>
    </div>
  );
}

/// 「怎么接网易云」。
///
/// ⚠️ **这段必须长在 app 里，不能只写在文档里。** 登录入口本来就有
/// （设置 → 音乐账号，扫码 / 短信两条路都做好了），但它**只有在音源地址
/// 已经填好之后才显示**——等于把说明书锁在了它要说明的那扇门后面。
/// 第一次打开的人看到的是一片空白，和一句办不到的建议。
function Hookup({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <div className="flex gap-3">
      <span
        className="shrink-0 w-5 h-5 rounded-full grid place-items-center text-[11px] tabular-nums"
        style={{
          background: "color-mix(in oklab, var(--ink) 10%, transparent)",
          color: "var(--ink-dim)",
        }}
      >
        {n}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px]" style={{ color: "var(--ink)" }}>
          {title}
        </span>
        <span
          className="block text-[11.5px] leading-relaxed pt-0.5"
          style={{ color: "var(--ink-faint)" }}
        >
          {children}
        </span>
      </span>
    </div>
  );
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <button
        aria-label="关掉"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "oklch(0 0 0 / 0.35)" }}
      />
      <div className="glass-strong relative rounded-t-[26px] px-5 pt-4 pb-6 anim-rise max-h-[86%] overflow-y-auto no-bar">
        <div
          className="w-9 h-1 rounded-full mx-auto mb-4"
          style={{ background: "var(--ink)", opacity: 0.2 }}
        />
        <h2 className="text-[16px] pb-1.5" style={{ color: "var(--ink)" }}>
          接上网易云
        </h2>
        <p className="text-[11.5px] leading-relaxed pb-4" style={{ color: "var(--ink-faint)" }}>
          网易云没有对外开放的接口，这台手机没法直接登录它。中间要隔一个
          <b style={{ color: "var(--ink-dim)" }}>「音源」</b>
          ——一个你自己跑起来的小服务，它替你跟网易云说话，这个 App 只跟它说话。
        </p>
        <div className="flex flex-col gap-3.5">
          <Step n={1} title="先跑一个音源服务">
            NeteaseCloudMusicApi 那一类。跑起来它会占一个端口，比如
            <code> http://127.0.0.1:3300</code>。它不在这个 App 里，得单独跑着。
          </Step>
          <Step n={2} title="把地址填进 设置 → 音乐">
            填完之后，设置里才会多出一组「音乐账号」——
            <b style={{ color: "var(--ink-dim)" }}>填之前它是不显示的</b>，
            所以你一开始找不到登录在哪儿。
          </Step>
          <Step n={3} title="在那儿扫码登录">
            用手机上的网易云 App 扫屏幕上这个码。手边只有这一台手机的话走
            「手机号 + 短信」那条——自己的屏幕没法拿自己扫。
          </Step>
        </div>
        <button
          onClick={onSettings}
          className="w-full rounded-2xl py-3 text-[14px] mt-5"
          style={{
            background: "color-mix(in oklab, var(--ink) 10%, transparent)",
            color: "var(--ink)",
          }}
        >
          去设置
        </button>
        <p className="text-[11px] leading-relaxed pt-3" style={{ color: "var(--ink-faint)" }}>
          扫码那条从头到尾没有密码。登录之后拿到的是一串凭据，存在这个站的
          httpOnly cookie 里，页面上的脚本读不到，也不会写进备份。
          <br />
          能不能听到整首，看你账号自己的权限——没权限的只会放一段试听。
        </p>
      </div>
    </div>
  );
}

export function MusicApp({
  settings,
  contacts,
  onChange,
  onOpenSettings,
}: {
  settings: Settings;
  contacts: Contact[];
  onChange: (p: Partial<Settings>) => void;
  /// 去设置里填音源、登录账号。音乐 app 自己开不了别的 app
  onOpenSettings: () => void;
}) {
  const p = usePlayer();
  const me = useMe(settings);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [tab, setTab] = useState<"lib" | "find">("lib");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [words, setWords] = useState<string | null>(null);
  /// 展开成全屏播放页
  const [full, setFull] = useState(false);
  /// 「怎么接网易云」那一层
  const [hookup, setHookup] = useState(false);

  const together = contacts.find((c) => c.id === settings.togetherWith) ?? null;

  const base = settings.musicApiBase.trim();

  const refresh = useCallback(async () => setTracks(await loadTracks()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) await saveTrack(localTrack(f));
    await refresh();
  };

  const runSearch = async () => {
    if (!q.trim()) return;
    if (!base) return setNote("还没配音源地址。设置 → 音乐里填一个。");
    setBusy(true);
    setNote(null);
    try {
      setFound(await search(base, q.trim()));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addOnline = async (f: Found, andPlay: boolean) => {
    const t: Track = {
      id: newId(),
      contactId: PHONE,
      kind: "online",
      title: f.title,
      artist: f.artist,
      songId: f.songId,
      cover: f.cover,
      at: Date.now(),
    };
    await saveTrack(t);
    const next = await loadTracks();
    setTracks(next);
    if (andPlay) p.play(t, next);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <style>{`@keyframes bar { 0%,100% { height: 30% } 50% { height: 100% } }`}</style>

      {/* 正在放的那首。**没在放就不占位置**——空的播放器条比没有更碍事 */}
      {p.track && (
        <div className="shrink-0 glass rounded-2xl mx-4 mb-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <span style={{ color: "var(--ink-dim)" }}>
              <Bars on={p.playing} />
            </span>
            {/* 点标题这块展开成播放页；控制键还留在原地，
                不用为了暂停先展开再收起 */}
            <button onClick={() => setFull(true)} className="min-w-0 flex-1 text-left active:opacity-60">
              <span className="block text-[14px] truncate" style={{ color: "var(--ink)" }}>
                {p.track.title}
              </span>
              <span className="block text-[11px] truncate" style={{ color: "var(--ink-faint)" }}>
                {p.track.artist || (p.track.kind === "online" ? "在线" : "本地文件")}
              </span>
            </button>
            <button onClick={p.prev} className="p-1.5 active:opacity-50" aria-label="上一首">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="var(--ink-dim)">
                <path d="M7 6h2v12H7zM19 6v12l-9-6z" />
              </svg>
            </button>
            <button onClick={p.toggle} className="p-1.5 active:opacity-50" aria-label="播放暂停">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="var(--ink)">
                {p.playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5l12 7-12 7z" />}
              </svg>
            </button>
            <button onClick={p.next} className="p-1.5 active:opacity-50" aria-label="下一首">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="var(--ink-dim)">
                <path d="M15 6h2v12h-2zM5 6l9 6-9 6z" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <span className="text-[10px] tabular-nums w-8" style={{ color: "var(--ink-faint)" }}>
              {mmss(p.at)}
            </span>
            <input
              type="range"
              min={0}
              max={p.len || 0}
              value={p.at}
              onChange={(e) => p.seek(Number(e.target.value))}
              className="flex-1 h-1 accent-current"
              style={{ color: "var(--ink-dim)" }}
            />
            <span className="text-[10px] tabular-nums w-8 text-right" style={{ color: "var(--ink-faint)" }}>
              {mmss(p.len)}
            </span>
          </div>

          {p.track.kind === "online" && (
            <button
              onClick={async () => {
                if (words !== null) return setWords(null);
                setWords(await fetchLyric(base, p.track!.songId!));
              }}
              className="text-[11px] pt-1"
              style={{ color: "var(--ink-faint)" }}
            >
              {words === null ? "看歌词" : "收起歌词"}
            </button>
          )}
          {words !== null && (
            <pre
              className="text-[12px] leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto no-bar mt-1"
              style={{ color: "var(--ink-dim)", fontFamily: "inherit" }}
            >
              {words.replace(/\[[\d:.]+\]/g, "").trim() || "这首没有歌词"}
            </pre>
          )}

          {p.trial && (
            <p className="text-[11px] pt-1" style={{ color: "var(--ink-dim)" }}>
              这首只有试听片段{p.len > 0 ? `，${mmss(p.len)} 就断` : ""}——
              {p.loggedIn ? "你的账号没有这首的完整权限。" : "要先登录（见 tools/music-login.mjs）。"}
            </p>
          )}
          {p.err && (
            <p className="text-[11px] pt-1" style={{ color: "oklch(0.65 0.19 25)" }}>
              {p.err}
            </p>
          )}
        </div>
      )}

      {/* 一起听。**主题就是那两个头像和累计时间**，别的都别加——
          唱片转不转不重要，「有人和你在同一首歌里」才是这件事本身。 */}
      {contacts.length > 0 && (
        <div className="shrink-0 px-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center -space-x-2">
              <Avatar face={me} size={28} ring />
              {contacts.map((c) => {
                const on = c.id === settings.togetherWith;
                return (
                  <button
                    key={c.id}
                    onClick={() => onChange({ togetherWith: on ? "" : c.id })}
                    className="rounded-full transition-opacity"
                    style={{ opacity: on ? 1 : 0.35 }}
                  >
                    <Avatar face={faceOf(c)} size={28} ring />
                  </button>
                );
              })}
            </span>
            <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
              {together
                ? `和${displayName(together)}一起听了 ${span(together.together ?? 0)}`
                : "自己听 · 点头像叫上它"}
            </span>
          </div>

        </div>
      )}

      <div className="shrink-0 flex gap-2 px-4 pb-2">
        {(["lib", "find"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-1.5 rounded-full text-[12px]"
            style={{
              // ⚠️ 原来是 glass-tint 95%。app 的底本来就是那个颜色，
              // 等于白压白——选中的那颗看不出被选中。改成掺墨色，深浅两套都立得住。
              background: tab === t ? "color-mix(in oklab, var(--ink) 9%, transparent)" : "transparent",
              color: tab === t ? "var(--ink)" : "var(--ink-faint)",
            }}
          >
            {t === "lib" ? "曲库" : "找歌"}
          </button>
        ))}
      </div>

      {tab === "lib" ? (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto no-bar px-3 pb-3">
            {tracks.length === 0 ? (
              <Empty onAdd={(f) => void add(f)} onHookup={() => setHookup(true)} />
            ) : (
              tracks.map((t) => {
                const on = p.track?.id === t.id;
                return (
                  <div key={t.id} className="flex items-center gap-3 px-2 py-2.5">
                    <button
                      onClick={() => p.play(t, tracks)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left active:opacity-60"
                    >
                      <span
                        className="shrink-0 w-9 h-9 rounded-lg grid place-items-center"
                        style={{
                          background: "color-mix(in oklab, var(--glass-tint) 80%, transparent)",
                          color: on ? "var(--ink)" : "var(--ink-faint)",
                        }}
                      >
                        {on ? <Bars on={p.playing} /> : (t.kind === "online" ? "♪" : "▸")}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px] truncate" style={{ color: "var(--ink)" }}>
                          {t.title}
                        </span>
                        <span className="block text-[11px] truncate" style={{ color: "var(--ink-faint)" }}>
                          {t.artist || (t.kind === "online" ? "在线" : "本地文件")}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={async () => {
                        await deleteTrack(t.id);
                        await refresh();
                      }}
                      className="text-[11px] px-1"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      移出
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* 空的时候不画这条：空状态自己带了同一个按钮，两个一模一样的
              「加本地文件」上下摆着，看着像哪儿渲染重复了。 */}
          <div className="shrink-0 px-4 pb-2" hidden={tracks.length === 0}>
            <label
              className="glass-strong block w-full rounded-2xl py-3 text-[14px] text-center"
              style={{ color: "var(--ink)" }}
            >
              加本地文件
              <input
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void add(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </>
      ) : (
        <>
          <div className="shrink-0 px-3 pb-2">
            <div className="glass-strong rounded-[22px] flex items-center gap-2 px-3.5 py-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runSearch()}
                placeholder={base ? "歌名或歌手" : "先去设置里配音源地址"}
                disabled={!base}
                className="flex-1 bg-transparent outline-none text-[14px] py-1"
                style={{ color: "var(--ink)" }}
              />
              <button onClick={() => void runSearch()} disabled={busy || !base}
                className="text-[13px] disabled:opacity-40" style={{ color: "var(--ink)" }}>
                {busy ? "找…" : "找"}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto no-bar px-3 pb-3">
            {!base && (
              <div className="grid place-items-center pt-10 px-8">
                <div className="flex flex-col items-center gap-4">
                  <Disc />
                  <p
                    className="text-[12.5px] leading-relaxed text-center"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    在线找歌要一个音源服务。
                    <br />
                    它不在这个 App 里——得你自己跑一个。
                  </p>
                  <button
                    onClick={() => setHookup(true)}
                    className="rounded-full px-4 py-2 text-[13px]"
                    style={{
                      background: "color-mix(in oklab, var(--ink) 8%, transparent)",
                      color: "var(--ink-dim)",
                    }}
                  >
                    怎么接网易云
                  </button>
                </div>
              </div>
            )}
            {found.map((f) => (
              <button
                key={f.songId}
                onClick={() => void addOnline(f, true)}
                className="w-full flex items-center gap-3 px-2 py-2.5 text-left active:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] truncate" style={{ color: "var(--ink)" }}>
                    {f.title}
                  </span>
                  <span className="block text-[11px] truncate" style={{ color: "var(--ink-faint)" }}>
                    {f.artist}
                  </span>
                </span>
                {/* 拿不到完整音源的先标出来，别等点下去才发现没声音 */}
                {f.vip && (
                  <span
                    className="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: "oklch(0.75 0.12 70 / 0.25)", color: "var(--ink-dim)" }}
                  >
                    要会员
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {note && (
        <p className="shrink-0 text-center text-[11px] pb-2 px-6" style={{ color: "var(--ink-faint)" }}>
          {note}
        </p>
      )}

      {hookup && (
        <Hookup
          onClose={() => setHookup(false)}
          onSettings={() => {
            setHookup(false);
            onOpenSettings();
          }}
        />
      )}

      {full && p.track && (
        <MusicPlayer
          settings={settings}
          together={together}
          onChange={onChange}
          onClose={() => setFull(false)}
        />
      )}
    </div>
  );
}
