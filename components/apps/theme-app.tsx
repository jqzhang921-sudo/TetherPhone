"use client";
import { useCallback, useState } from "react";
import { WALLPAPERS } from "@/lib/os/wallpapers";
import { BUBBLES } from "@/lib/os/bubbles";
import { MATERIALS, materialOf } from "@/lib/os/materials";
import { PHONE_SCOPE, blankPhoto, savePhoto, shrink } from "@/lib/photos/store";
import type { Settings } from "@/lib/os/settings";

/// 主题。壁纸、玻璃、气泡——**「这台手机长什么样」都归这儿**，
/// 设置里只留「它怎么工作」。外观散在两处的话，每加一样都得先想放哪边。
function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-[12px] mb-2.5 px-1" style={{ color: "var(--ink-faint)" }}>
        {title}
      </h2>
      <div className="glass-strong rounded-3xl p-4 flex flex-col gap-3.5">
        {children}
        {hint && (
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
            {hint}
          </p>
        )}
      </div>
    </section>
  );
}

/// 一条滑杆。
///
/// ⚠️ **拖动时只改本地 state，松手才写设置。** 每移动一像素写一次
/// localStorage 会把整棵树重渲染几十次，手感会变成一顿一顿的。
///
/// ⚠️ **显示的必须是实际生效的值。** 用户存了 30、但下限把它顶到 79 时，
/// 眼睛看到的是 79——标签还写 30 就是在骗人。所以 `floorAt` 一起夹。
function Slider({
  value,
  fallback,
  min,
  max,
  unit,
  unset,
  onCommit,
}: {
  value: number;
  /// 没设过时滑杆停在哪
  fallback: number;
  min: number;
  max: number;
  unit: string;
  /// 哪个数表示「没设过，用 CSS 的默认」。
  ///
  /// ⚠️ **不是每根滑杆都有这么一个数。** 边缘厚度的 0 是「我就要平的」，
  /// 不是「没设过」——把它当默认，滑杆会停在 16 却给你写着「默认」，
  /// 而实际生效的是 0，看到的和存着的和生效的三样全对不上。
  /// 所以有这个格子的滑杆，量程要避开它（模糊从 2 起跳，2px 和 0px 长得一样）。
  unset?: number;
  onCommit: (v: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const picked = drag ?? value;
  const bare = unset !== undefined && picked === unset;
  const shown = bare ? null : Math.max(picked, min);
  const commit = () => {
    if (drag !== null) onCommit(Math.max(drag, min));
    setDrag(null);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          value={shown ?? fallback}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commit}
          onPointerCancel={commit}
          onKeyUp={commit}
          className="flex-1"
          style={{ accentColor: "var(--ink)" }}
        />
        <span className="text-[12px] tabular-nums w-14 text-right" style={{ color: "var(--ink-dim)" }}>
          {shown === null ? "默认" : `${shown}${unit}`}
        </span>
      </div>
      {unset !== undefined && !bare && (
        <button
          onClick={() => {
            setDrag(null);
            onCommit(unset);
          }}
          className="self-start text-[12px]"
          style={{ color: "var(--ink-faint)" }}
        >
          回到默认
        </button>
      )}
    </div>
  );
}

export function ThemeApp({
  settings,
  onChange,
  /// 当前壁纸算出来的玻璃下限（0~1）。滑杆不能拉到它以下。
  floor,
  /// 自己传的壁纸那张图，只为预览用
  wallpaperUrl,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  floor: number;
  wallpaperUrl?: string;
}) {
  const lowest = Math.max(20, Math.round(floor * 100));
  /// 实际生效的玻璃浓度（用户设的和壁纸下限取大），预览要用真值
  const live = settings.glassAlpha ? Math.max(settings.glassAlpha, lowest) : null;

  /// 没设过时滑杆停在哪。深浅两套的默认值不一样，写死一个数总有一边对不上，
  /// 直接问 CSS 要。
  const [base, setBase] = useState({ alpha: 50, icon: 44, blur: 20 });
  const probe = useCallback((el: HTMLDivElement | null) => {
    const dev = el?.closest(".device");
    if (!dev) return;
    const cs = getComputedStyle(dev);
    const n = (k: string, d: number) => {
      const v = parseInt(cs.getPropertyValue(k), 10);
      return Number.isFinite(v) ? v : d;
    };
    setBase({ alpha: n("--glass-alpha", 50), icon: n("--glass-icon-alpha", 44), blur: n("--glass-blur", 20) });
  }, []);

  return (
    <div ref={probe} className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-6">
      <Card
        title="玻璃"
        hint={
          live === null
            ? `现在用的是默认。往左拉更通透——这张壁纸最薄能到 ${lowest}%。`
            : `越往左越透。这张壁纸最薄只能到 ${lowest}%——再薄，压在上面的字就会在壁纸亮的地方看不清。`
        }
      >
        {/* 预览：一块真玻璃、一个真图标，压在当前壁纸上，拖的时候就看得见 */}
        <div
          className="rounded-2xl h-[104px] p-3 flex items-end gap-2.5"
          style={{
            ...(wallpaperUrl
              ? { backgroundImage: `url(${wallpaperUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
              : {
                  background: (WALLPAPERS.find((w) => w.id === settings.wallpaperId) ?? WALLPAPERS[0])
                    .css,
                }),
          }}
        >
          <div className="glass rounded-xl px-3 py-2 text-[13px]" style={{ color: "var(--ink)" }}>
            这行字要一直读得清
          </div>
          <span className="glass-icon rounded-[14px] w-11 h-11 shrink-0" />
        </div>

        {/* 一档 = 下面几根滑杆的一组值。挑完照样能接着拉——
            滑杆是唯一的真相，这儿只是替你把三个数一起调对。 */}
        <div className="flex gap-2">
          {MATERIALS.map((m) => {
            const on = materialOf(settings) === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onChange(m.set)}
                className="flex-1 rounded-2xl px-3 py-2.5 text-left"
                style={{
                  background: "color-mix(in oklab, var(--glass-tint) 40%, transparent)",
                  outline: on ? "2px solid var(--ink)" : "1px solid var(--glass-edge)",
                }}
              >
                <div className="text-[13px]" style={{ color: "var(--ink)" }}>
                  {m.name}
                </div>
                <div className="text-[11px] leading-tight pt-0.5" style={{ color: "var(--ink-faint)" }}>
                  {m.hint}
                </div>
              </button>
            );
          })}
        </div>

        <div>
          <div className="text-[12px] pb-1" style={{ color: "var(--ink-faint)" }}>
            卡片和组件
          </div>
          <Slider
            value={settings.glassAlpha}
            fallback={base.alpha}
            min={lowest}
            max={92}
            unit="%"
            unset={0}
            onCommit={(v) => onChange({ glassAlpha: v })}
          />
        </div>

        <div>
          <div className="text-[12px] pb-1" style={{ color: "var(--ink-faint)" }}>
            桌面图标
          </div>
          <Slider
            value={settings.iconAlpha}
            fallback={base.icon}
            min={lowest}
            max={92}
            unit="%"
            unset={0}
            onCommit={(v) => onChange({ iconAlpha: v })}
          />
        </div>

        <div>
          <div className="text-[12px] pb-1" style={{ color: "var(--ink-faint)" }}>
            磨砂的程度
          </div>
          <Slider
            value={settings.glassBlur}
            fallback={base.blur}
            min={2}
            max={80}
            unset={0}
            unit="px"
            onCommit={(v) => onChange({ glassBlur: v })}
          />
          <p className="text-[11px] leading-relaxed pt-1.5" style={{ color: "var(--ink-faint)" }}>
            二十上下你还认得出底下是什么；越往右纹路越化得开，到七八十就只剩一团一团的颜色了。
            压在一片平坦的颜色上糊和不糊长得一样——那时候撑起玻璃感的是边和顶上那道光，不是模糊。
          </p>
        </div>

        <div>
          <div className="text-[12px] pb-1" style={{ color: "var(--ink-faint)" }}>
            颜色的浓度
          </div>
          <Slider
            value={settings.glassSat}
            fallback={190}
            min={100}
            max={320}
            unit="%"
            unset={0}
            onCommit={(v) => onChange({ glassSat: v })}
          />
          <p className="text-[11px] leading-relaxed pt-1.5" style={{ color: "var(--ink-faint)" }}>
            模糊是在做平均，而平均会把对着来的两种颜色互相抵消掉。糊得越狠越该往右拉，
            不然剩下的是一片灰，不是玻璃。
          </p>
        </div>

        <div>
          <div className="text-[12px] pb-1" style={{ color: "var(--ink-faint)" }}>
            边缘的厚度
          </div>
          <Slider
            value={settings.glassEdge}
            fallback={16}
            min={0}
            max={40}
            unit="px"
            onCommit={(v) => onChange({ glassEdge: v })}
          />
          <p className="text-[11px] leading-relaxed pt-1.5" style={{ color: "var(--ink-faint)" }}>
            边上那圈会把壁纸「挤」进来一点，像玻璃真的有厚度。拉到 0 就是平的。
            只在桌面的卡片和底座上有——app 里面的玻璃底下不是壁纸，挤不出东西来。
          </p>
        </div>
      </Card>

      <Card title="气泡" hint="没挑的话就是「跟随主题」：你那侧用联系人的颜色，换个人聊天就换个色。">
        <div className="flex flex-col gap-2.5">
          {BUBBLES.map((b) => {
            const on = (settings.bubbleStyle || BUBBLES[0].id) === b.id;
            return (
              <button
                key={b.id}
                onClick={() => onChange({ bubbleStyle: b.id })}
                className="rounded-2xl p-3 text-left"
                style={{
                  background: "color-mix(in oklab, var(--glass-tint) 40%, transparent)",
                  outline: on ? "2px solid var(--ink)" : "1px solid var(--glass-edge)",
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[14px]" style={{ color: "var(--ink)" }}>
                    {b.name}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                    {b.hint}
                  </span>
                </div>
                {/* 两句真气泡，照着聊天页的圆角和内边距 */}
                <div className="flex flex-col gap-1.5">
                  {/* 圆角跟聊天页保持一致，不然挑的时候看到的和真的不是一个形状 */}
                  <span
                    className="self-start px-3 py-1.5 text-[13px]"
                    style={{ borderRadius: "18px 18px 18px 5px", ...b.them }}
                  >
                    今天走了很远
                  </span>
                  <span
                    className="self-end px-3 py-1.5 text-[13px]"
                    style={{ borderRadius: "18px 18px 5px 18px", ...b.me("oklch(0.62 0.14 250)") }}
                  >
                    我也是
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

  <Card title="壁纸">
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
  </Card>
    </div>
  );
}
