"use client";
import { useRef, useState } from "react";
import { WALLPAPERS } from "@/lib/os/wallpapers";
import type { Settings } from "@/lib/os/settings";
import type { Contact } from "@/lib/os/contacts";
import { exportBackup, importBackup } from "@/lib/os/backup";
import { clearAllMsgs } from "@/lib/chat/store";
import { PHONE_SCOPE, blankPhoto, savePhoto, shrink } from "@/lib/photos/store";
import { MusicLogin } from "./music-login";
import { Avatar } from "@/components/phone/avatar";
import { PhotoPicker } from "@/components/photos/photo-picker";
import { cropSquare, clearMeAvatar, saveMeAvatar, useMe } from "@/lib/os/avatar";

const inputStyle: React.CSSProperties = {
  background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
  border: "1px solid var(--glass-edge)",
  color: "var(--ink)",
};

function Field({
  label, value, onChange, placeholder, type = "text", hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-2xl px-3.5 py-2.5 text-[14px] outline-none"
        style={inputStyle}
      />
      {hint && (
        <span className="block mt-1.5 text-[11px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

/// 没设图片头像时挑一个。和联系人那份刻意**不是**同一组——
/// 两边选到同一个 emoji，聊天里就分不出谁是谁了。
const FACES = ["🌱", "🐟", "🍊", "⛅", "🪺", "🧶", "🫐", "🌾", "🐌", "🎐"];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-[12px] mb-2.5 px-1" style={{ color: "var(--ink-faint)" }}>{title}</h2>
      <div className="glass-strong rounded-3xl p-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function SettingsApp({
  settings,
  contacts,
  onChange,
  onReloadAll,
}: {
  settings: Settings;
  /// 只为「从相册选头像」用——相册是按联系人分的，得知道翻谁的
  contacts: Contact[];
  onChange: (patch: Partial<Settings>) => void;
  onReloadAll: () => void;
}) {
  const me = useMe(settings);
  const [pickingFace, setPickingFace] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-6">
      <Group title="模型">
        <Field
          label="接口地址"
          value={settings.apiBase}
          onChange={(v) => onChange({ apiBase: v })}
          placeholder="https://api.deepseek.com/v1"
          hint="任何 OpenAI 兼容的地址都行。要带 /v1。"
        />
        <Field
          label="API Key"
          type="password"
          value={settings.apiKey}
          onChange={(v) => onChange({ apiKey: v })}
          placeholder="sk-..."
          hint="只存在这台设备的浏览器里，不上传。调模型时经本站服务端中转——浏览器直连大多数接口会被 CORS 挡住。"
        />
        <Field
          label="默认模型"
          value={settings.model}
          onChange={(v) => onChange({ model: v })}
          placeholder="deepseek-chat"
          hint="每个联系人可以单独覆盖，在通讯录里改。"
        />
      </Group>

      {/* 名字和人设不在这儿了——它们归联系人管，在通讯录里改。 */}
      <Group title="你自己">
        <div className="flex items-center gap-3.5">
          <Avatar face={me} size={56} />
          <div className="flex-1 flex flex-wrap gap-2">
            <button
              onClick={() => setPickingFace(true)}
              className="rounded-xl px-3 py-2 text-[12px]"
              style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink)" }}
            >
              从相册选
            </button>
            <label
              className="rounded-xl px-3 py-2 text-[12px] cursor-pointer"
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
                  const { blob } = await shrink(f, 640, 0.9);
                  await saveMeAvatar(await cropSquare(blob));
                  // 时间戳一变，用到头像的几处一起重读
                  onChange({ userAvatarAt: Date.now() });
                }}
              />
            </label>
            {settings.userAvatarAt > 0 && (
              <button
                onClick={async () => {
                  await clearMeAvatar();
                  onChange({ userAvatarAt: 0 });
                }}
                className="rounded-xl px-3 py-2 text-[12px]"
                style={{ background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)", color: "var(--ink-faint)" }}
              >
                去掉
              </button>
            )}
          </div>
        </div>
        {settings.userAvatarAt === 0 && (
          <div className="flex flex-wrap gap-2">
            {FACES.map((e) => (
              <button
                key={e}
                onClick={() => onChange({ userEmoji: e })}
                className="w-9 h-9 rounded-full grid place-items-center text-[18px]"
                style={{
                  background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)",
                  outline: settings.userEmoji === e ? "2px solid var(--ink)" : "none",
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <Field
          label="你叫"
          value={settings.userName}
          onChange={(v) => onChange({ userName: v })}
          placeholder="它该怎么称呼你"
        />
        <Field
          label="你的签名"
          value={settings.userSignature}
          onChange={(v) => onChange({ userSignature: v })}
          placeholder="挂在你主页上的一句话"
        />
      </Group>

      <Group title="音乐">
        <Field
          label="音源地址"
          value={settings.musicApiBase}
          onChange={(v) => onChange({ musicApiBase: v })}
          placeholder="http://127.0.0.1:3300"
          hint="留空只能听本地文件。在线找歌要一个音源服务——它不在这个 App 里，你得自己跑一个（比如 api-enhanced），把地址填这儿。"
        />
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
          <b style={{ color: "var(--ink-dim)" }}>这个地址会由本站服务端去请求。</b>
          本机自己跑着用没问题，填 <code>127.0.0.1</code> 也行。
          但<b style={{ color: "var(--ink-dim)" }}>要是把站部署出去给别人开</b>，就该在部署平台上设
          <code> MUSIC_API_BASE </code>
          把地址钉死——否则等于让任何人指使你的服务器去访问任意地址，包括内网。
          （部署环境下内网地址默认已经挡了。）
        </p>
      </Group>

      {settings.musicApiBase.trim() && (
        <Group title="音乐账号">
          <MusicLogin base={settings.musicApiBase.trim()} />
        </Group>
      )}

      <Group title="壁纸">
        <div className="grid grid-cols-3 gap-3">
          {/* 自己传一张。**深浅是从图里算的，不用选**——
              选错了整页字就没法看，而且换一张还得再选一次。 */}
          <label
            className="rounded-2xl aspect-[9/16] grid place-items-center text-[11px] cursor-pointer"
            style={{
              background: "color-mix(in oklab, var(--glass-tint) 70%, transparent)",
              color: "var(--ink-dim)",
              outline: settings.wallpaperPhotoId ? "2px solid var(--ink)" : "1px solid var(--glass-edge)",
              outlineOffset: settings.wallpaperPhotoId ? "2px" : "0",
            }}
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
                // 壁纸要铺满屏，别压到 1280——那是聊天图的尺寸
                const { blob, w, h } = await shrink(f, 1600, 0.86);
                const ph = { ...blankPhoto(PHONE_SCOPE, "me"), blob, w, h, saved: true };
                await savePhoto(ph);
                onChange({ wallpaperPhotoId: ph.id });
              }}
            />
          </label>
          {WALLPAPERS.map((w) => {
            const on = w.id === settings.wallpaperId;
            return (
              <button
                key={w.id}
                onClick={() => onChange({ wallpaperId: w.id, wallpaperPhotoId: "" })}
                className="rounded-2xl overflow-hidden aspect-[9/16] relative transition-transform active:scale-95"
                style={{
                  background: w.css,
                  outline:
                    on && !settings.wallpaperPhotoId
                      ? "2px solid var(--ink)"
                      : "1px solid var(--glass-edge)",
                  outlineOffset: on && !settings.wallpaperPhotoId ? "2px" : "0",
                }}
              >
                <span
                  className="absolute bottom-1 left-0 right-0 text-[10px]"
                  style={{ color: w.tone === "dark" ? "oklch(0.97 0 0)" : "oklch(0.25 0 0)" }}
                >
                  {w.name}
                </span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group title="备份">
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
          所有东西都只存在这台设备上。
          <b style={{ color: "var(--ink-dim)" }}>iPhone 上，Safari 会把七天没打开过的网站数据清掉</b>
          ——把这个页面「添加到主屏幕」就不受这条限制。不管加没加，定期导出一份都不亏。
        </p>
        <button
          onClick={() => void exportBackup()}
          className="text-left text-[14px] py-1"
          style={{ color: "var(--ink)" }}
        >
          导出备份文件
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="text-left text-[14px] py-1"
          style={{ color: "var(--ink)" }}
        >
          从备份恢复
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            // 恢复是整机覆盖不是合并——合并要处理同 id 不同内容、时间线交叉、
            // 联系人重名，那是另一件事，现在做只会做出一堆看不见的冲突。
            if (!window.confirm("恢复会覆盖这台设备上现有的全部数据，继续？")) return;
            const r = await importBackup(f);
            if (!r.ok) {
              setNote(r.why);
              return;
            }
            const n = Object.entries(r.counts)
              .filter(([, v]) => v > 0)
              .map(([k, v]) => `${k} ${v}`)
              .join(" · ");
            setNote(`已恢复：${n || "空备份"}`);
            onReloadAll();
          }}
        />
      </Group>

      <Group title="数据">
        <button
          onClick={async () => {
            if (!window.confirm("清空所有聊天记录？删了找不回来。")) return;
            await clearAllMsgs();
            setNote("聊天记录已清空。");
            onReloadAll();
          }}
          className="text-left text-[14px] py-1"
          style={{ color: "oklch(0.62 0.19 25)" }}
        >
          清空聊天记录
        </button>
      </Group>

      {note && (
        <p className="text-[12px] text-center pb-2" style={{ color: "var(--ink-dim)" }}>
          {note}
        </p>
      )}

      {pickingFace && contacts[0] && (
        <PhotoPicker
          contactId={contacts[0].id}
          picked={[]}
          onDone={() => {}}
          onPick={async (ph) => {
            await saveMeAvatar(await cropSquare(ph.blob));
            onChange({ userAvatarAt: Date.now() });
          }}
          onClose={() => setPickingFace(false)}
        />
      )}
    </div>
  );
}
