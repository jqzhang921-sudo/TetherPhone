"use client";
import { useState } from "react";
import { WALLPAPERS } from "@/lib/os/wallpapers";
import type { Settings } from "@/lib/os/settings";

function Field({
  label, value, onChange, placeholder, type = "text", hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; hint?: string;
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
        style={{
          background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
          border: "1px solid var(--glass-edge)",
          color: "var(--ink)",
        }}
      />
      {hint && (
        <span className="block mt-1.5 text-[11px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-[12px] mb-2.5 px-1" style={{ color: "var(--ink-faint)" }}>{title}</h2>
      <div className="glass-strong rounded-3xl p-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function SettingsApp({
  settings, onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const [wiped, setWiped] = useState(false);

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
          label="模型"
          value={settings.model}
          onChange={(v) => onChange({ model: v })}
          placeholder="deepseek-chat"
        />
      </Group>

      <Group title="名字">
        <Field label="它叫" value={settings.aiName} onChange={(v) => onChange({ aiName: v })} placeholder="还没起名" />
        <Field label="你叫" value={settings.userName} onChange={(v) => onChange({ userName: v })} placeholder="它该怎么称呼你" />
        <label className="block">
          <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>人设</span>
          <textarea
            value={settings.persona}
            onChange={(e) => onChange({ persona: e.target.value })}
            rows={5}
            placeholder="留空也能聊。"
            className="mt-1.5 w-full rounded-2xl px-3.5 py-2.5 text-[14px] outline-none resize-none leading-relaxed"
            style={{
              background: "color-mix(in oklab, var(--glass-tint) 88%, transparent)",
              border: "1px solid var(--glass-edge)",
              color: "var(--ink)",
            }}
          />
          <span className="block mt-1.5 text-[11px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
            写它是谁、在意什么、怎么说话。别写「贴心的助手」这类标签——
            挂了形容词，模型就去演那个词。
          </span>
        </label>
      </Group>

      <Group title="壁纸">
        <div className="grid grid-cols-3 gap-3">
          {WALLPAPERS.map((w) => {
            const on = w.id === settings.wallpaperId;
            return (
              <button
                key={w.id}
                onClick={() => onChange({ wallpaperId: w.id })}
                className="rounded-2xl overflow-hidden aspect-[9/16] relative transition-transform active:scale-95"
                style={{
                  background: w.css,
                  outline: on ? "2px solid var(--ink)" : "1px solid var(--glass-edge)",
                  outlineOffset: on ? "2px" : "0",
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

      <Group title="数据">
        <button
          onClick={() => {
            // 聊天记录只在这台浏览器里，删了没有别的副本。
            if (!window.confirm("清空聊天记录？删了找不回来。")) return;
            window.localStorage.removeItem("tether.chat.v1");
            setWiped(true);
          }}
          className="text-left text-[14px] py-1"
          style={{ color: "oklch(0.62 0.19 25)" }}
        >
          清空聊天记录
        </button>
        {wiped && (
          <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
            已清空。回桌面重新打开聊天就看得到。
          </span>
        )}
      </Group>
    </div>
  );
}
