"use client";
import { MY_PRESETS, liveStatus, statusLabel } from "@/lib/os/status";
import { useEffect, useState } from "react";
import { StatusBar } from "./status-bar";
import { Avatar } from "./avatar";
import type { Face } from "@/lib/os/avatar";
import { useContactImage } from "@/lib/os/contact-image";
import { readImage } from "@/lib/music/tone";
import { loadPosts, type Post } from "@/lib/moments/store";
import { loadPhotos, type Photo } from "@/lib/photos/store";
import { PhotoImg } from "@/components/photos/photo-img";

/// 主页 = 看。资料卡 = 改。
///
/// ⚠️ **两个不能合成一个。** 之前点头像直接进的是编辑器：一屏输入框，
/// 每次想看看 TA 是谁都要面对一堆可编辑字段。真手机上这是两件事——
/// QQ / Telegram 都是先给你一张「这个人长什么样」的页，改资料是上面的一个按钮。
///
/// ⚠️ 横幅**是另一张图，不是头像放大**。她给的两张截图（QQ、Telegram）
/// 都是这样：上面一条自己的图，头像压在图和白卡的交界上。

/// 横幅的高，和取样时用的宽高比。**取样要按 cover 裁过再算**——
/// 横幅是宽扁的一条，拿整张竖图去算深浅，算的是屏幕上看不到的部分。
const BANNER_H = 232;
const BANNER_W = 400;

function span(sec: number) {
  if (sec < 60) return `${Math.floor(sec)} 秒`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

/// 浮在横幅上的圆钮。横幅是用户自己的图，深浅未知——
/// 所以按钮必须自带一块深色底，不能靠 --ink 去猜。
function Round({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-9 h-9 rounded-full grid place-items-center active:scale-90 transition-transform"
      style={{ background: "oklch(0.2 0 0 / 0.42)", backdropFilter: "blur(8px)" }}
    >
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-2.5">
      <span className="text-[12px] w-14 shrink-0" style={{ color: "var(--ink-faint)" }}>
        {label}
      </span>
      <span className="text-[14px] min-w-0 flex-1" style={{ color: "var(--ink)" }}>
        {value}
      </span>
    </div>
  );
}

/// 这一页画谁。
///
/// ⚠️ **用户和联系人共用这一页，不做两套。** 两套的下场是加一个字段要改两处，
/// 迟早分叉——而它们要展示的东西本来就是一样的：一张脸、一个名字、一句签名。
/// 差别只在"能做什么"：联系人能发消息、能改资料；自己只能改自己。
export type Who = {
  id: string;
  name: string;
  realName?: string;
  signature: string;
  face: Face;
  tint: string;
  bannerAt?: number;
  /// 一起听。只有联系人有。
  songs?: number;
  together?: number;
  /// 状态（lib/os/status.ts）。过期的在这一页里当没有
  status?: { word: string; text?: string; at: number } | null;
};

export function ProfilePage({
  who,
  onEdit,
  onChat,
  onSetStatus,
  onClose,
}: {
  who: Who;
  onEdit: () => void;
  /// 自己的主页没有「发消息」
  onChat?: () => void;
  /// 只有自己的主页能改状态。它的状态由它自己设（set_status），她这边只看
  onSetStatus?: (word: string, text: string) => void;
  onClose: () => void;
}) {
  const contact = who;
  const live = liveStatus(contact.status ?? null);
  const [editing, setEditing] = useState(false);
  const [word, setWord] = useState("");
  const [note, setNote] = useState("");
  const openEditor = () => {
    setWord(live?.word ?? "");
    setNote(live?.text ?? "");
    setEditing(true);
  };
  const banner = useContactImage("banner", contact.id, contact.bannerAt);

  /// ⚠️ **横幅那一条要按横幅自己的深浅翻。**
  /// 状态栏画在横幅上，用的是设备（壁纸）的色调——换一张深色横幅，
  /// 时间和信号格就是深色压深色。和聊天页那次是同一个坑，只是位置换了。
  /// 只翻横幅这一层：底下的白卡不跟着变。
  const [bannerDark, setBannerDark] = useState<boolean | null>(null);
  useEffect(() => {
    if (!banner) {
      setBannerDark(null);
      return;
    }
    let alive = true;
    void readImage(banner, BANNER_W / BANNER_H).then((r) => {
      if (alive) setBannerDark(r?.tone.dark ?? null);
    });
    return () => {
      alive = false;
    };
  }, [banner]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);

  useEffect(() => {
    void loadPosts(contact.id).then((all) => setPosts(all.slice(0, 3)));
    void loadPhotos(contact.id).then((all) => setPhotos(all.filter((p) => p.saved).slice(0, 4)));
  }, [contact.id]);

  const name = contact.name;
  const realName = contact.realName ?? "";

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col overflow-y-auto no-bar"
      style={{
        background: "color-mix(in oklab, var(--glass-tint) 92%, transparent)",
        backdropFilter: "blur(28px) saturate(1.5)",
        WebkitBackdropFilter: "blur(28px) saturate(1.5)",
        transform: entered ? "none" : "translateX(18%)",
        opacity: entered ? 1 : 0,
        transition: "transform 300ms var(--ease-ios), opacity 240ms",
      }}
    >
      {/* 横幅。没设图就按 TA 的底色铺一层——空白比一张淡色更像"没做完" */}
      <div
        className="relative shrink-0"
        data-tone={bannerDark === null ? undefined : bannerDark ? "dark" : "light"}
        style={{
          height: BANNER_H,
          ...(banner
            ? { backgroundImage: `url(${banner})`, backgroundSize: "cover", backgroundPosition: "center" }
            : {
                background: `linear-gradient(160deg, ${contact.tint} 0%, color-mix(in oklab, ${contact.tint} 35%, var(--glass-tint)) 100%)`,
              }),
        }}
      >
        <div className="relative z-10">
          <StatusBar />
        </div>
        <div className="absolute top-0 left-0 right-0 z-20 px-4 flex justify-between items-start"
          style={{ paddingTop: "calc(2.6rem + var(--sat))" }}>
          <Round onClick={onClose} label="返回">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="oklch(0.99 0 0)"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </Round>
          <Round onClick={onEdit} label="编辑资料">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="oklch(0.99 0 0)"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
            </svg>
          </Round>
        </div>
      </div>

      {/* 白卡往上压住横幅一角，头像再压住白卡的边——两次交叠，页面才不像两截 */}
      <div
        className="relative flex-1 px-5 pb-8"
        style={{
          marginTop: -26,
          borderRadius: "26px 26px 0 0",
          background: "color-mix(in oklab, var(--glass-tint) 92%, transparent)",
        }}
      >
        <div className="flex items-end gap-3" style={{ marginTop: -40 }}>
          <span
            className="rounded-full p-[3px] shrink-0"
            style={{ background: "color-mix(in oklab, var(--glass-tint) 92%, transparent)" }}
          >
            <Avatar face={contact.face} size={82} />
          </span>
          <div className="min-w-0 flex-1 pb-1.5">
            <div className="text-[21px] font-semibold truncate" style={{ color: "var(--ink)" }}>
              {name}
            </div>
            {realName && (
              <div className="text-[12px] truncate" style={{ color: "var(--ink-faint)" }}>
                本名 {realName}
              </div>
            )}
            {/* 状态。它的只能看；自己的点一下就能改。没设的时候，别人那页什么都不显示，
                自己那页显示一个「设个状态」——空着的地方要么能按，要么就别占位置 */}
            {(live || onSetStatus) && (
              <button
                disabled={!onSetStatus}
                onClick={openEditor}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] max-w-full disabled:cursor-default"
                style={{
                  background: "color-mix(in oklab, var(--ink) 8%, transparent)",
                  color: live ? "var(--ink-dim)" : "var(--ink-faint)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: contact.tint }} />
                <span className="truncate">{live ? statusLabel(live) : "设个状态"}</span>
              </button>
            )}
          </div>
        </div>

        {editing && onSetStatus && (
          // ⚠️ **就地展开，不弹一层。** 这一页本身在滚，里面再叠一层 absolute，
          // 位置会跟着滚动跑；展开在内容里就没有这个问题。
          <div className="mt-3 rounded-2xl p-3" style={{ background: "color-mix(in oklab, var(--ink) 6%, transparent)" }}>
            <div className="flex flex-wrap gap-1.5">
              {MY_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setWord(p)}
                  className="rounded-full px-2.5 py-1 text-[12px]"
                  style={{
                    background: word === p ? "var(--ink)" : "color-mix(in oklab, var(--ink) 8%, transparent)",
                    color: word === p ? "var(--glass-tint)" : "var(--ink-dim)",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
            <input
              value={word}
              onChange={(e) => setWord(e.target.value.slice(0, 8))}
              placeholder="或者自己写一个词"
              className="w-full mt-2.5 rounded-xl px-3 py-2 text-[13px] outline-none bg-transparent"
              style={{ color: "var(--ink)", border: "1px solid var(--glass-edge)" }}
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 30))}
              placeholder="再补一句（可以不写）"
              className="w-full mt-2 rounded-xl px-3 py-2 text-[13px] outline-none bg-transparent"
              style={{ color: "var(--ink)", border: "1px solid var(--glass-edge)" }}
            />
            <div className="flex items-center justify-end gap-4 pt-2.5 text-[13px]">
              {live && (
                <button
                  onClick={() => {
                    onSetStatus("", "");
                    setEditing(false);
                  }}
                  style={{ color: "var(--ink-faint)" }}
                >
                  清掉
                </button>
              )}
              <button onClick={() => setEditing(false)} style={{ color: "var(--ink-faint)" }}>
                算了
              </button>
              <button
                disabled={!word.trim()}
                onClick={() => {
                  onSetStatus(word.trim(), note.trim());
                  setEditing(false);
                }}
                className="disabled:opacity-35"
                style={{ color: "var(--ink)" }}
              >
                好了
              </button>
            </div>
            <p className="text-[11px] leading-relaxed pt-1.5" style={{ color: "var(--ink-faint)" }}>
              24 小时后自己消失。它看得到，说话会跟着调。
            </p>
          </div>
        )}

        {!!contact.signature.trim() && (
          <p className="text-[14px] leading-relaxed mt-3.5" style={{ color: "var(--ink-dim)" }}>
            {contact.signature}
          </p>
        )}

        {onChat && (
          <div className="mt-3">
            <Row
              label="一起听"
              value={
                contact.songs
                  ? `${contact.songs} 首 · ${span(contact.together ?? 0)}`
                  : "还没一起听过"
              }
            />
          </div>
        )}

        {photos.length > 0 && (
          <>
            <div className="text-[12px] pt-3 pb-2" style={{ color: "var(--ink-faint)" }}>
              相册
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {photos.map((p) => (
                <PhotoImg
                  key={p.id}
                  photo={p}
                  className="w-full rounded-[10px] object-cover"
                  style={{ aspectRatio: "1 / 1" }}
                />
              ))}
            </div>
          </>
        )}

        {posts.length > 0 && (
          <>
            <div className="text-[12px] pt-4 pb-2" style={{ color: "var(--ink-faint)" }}>
              最近的动态
            </div>
            <div className="flex flex-col gap-2">
              {posts.map((p) => (
                <div
                  key={p.id}
                  className="rounded-2xl px-3.5 py-2.5"
                  style={{ background: "color-mix(in oklab, var(--ink) 6%, transparent)" }}
                >
                  <div className="text-[13px] leading-relaxed" style={{ color: "var(--ink)" }}>
                    {p.text || (p.photoIds?.length ? `发了 ${p.photoIds.length} 张图` : "")}
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: "var(--ink-faint)" }}>
                    {p.author === "me" ? "你" : name} · {new Date(p.at).getMonth() + 1}月
                    {new Date(p.at).getDate()}日
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {onChat && (
          <button
            onClick={onChat}
            className="mt-6 w-full rounded-2xl py-3 text-[15px]"
            style={{ background: contact.tint, color: "oklch(0.99 0 0)" }}
          >
            发消息
          </button>
        )}
      </div>
    </div>
  );
}
