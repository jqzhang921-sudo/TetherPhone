"use client";
import { useEffect, useRef, useState } from "react";
import { LockScreen } from "./lock-screen";
import { HomeScreen } from "./home-screen";
import { AppWindow } from "./app-window";
import { ChatApp } from "@/components/apps/chat-app";
import { SettingsApp } from "@/components/apps/settings-app";
import { PlaceholderApp } from "@/components/apps/placeholder-app";
import { appById } from "@/lib/apps/registry";
import { wallpaperById } from "@/lib/os/wallpapers";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "@/lib/os/settings";

type Open = { id: string; origin: { x: number; y: number } };

export function Phone() {
  // 首屏用默认值渲染，挂载后再读 localStorage：服务端和客户端第一次
  // 渲染的东西必须一致，否则 hydration 会报错。
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [locked, setLocked] = useState(true);
  const [open, setOpen] = useState<Open | null>(null);
  const [closing, setClosing] = useState(false);
  const device = useRef<HTMLDivElement>(null);

  useEffect(() => setSettings(loadSettings()), []);

  const patch = (p: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...p };
      saveSettings(next);
      return next;
    });
  };

  const wallpaper = wallpaperById(settings.wallpaperId);

  const openApp = (id: string, center: { x: number; y: number }) => {
    // AppIcon 给的是视口坐标；窗口的 transform-origin 要的是设备框内坐标。
    const box = device.current?.getBoundingClientRect();
    setClosing(false);
    setOpen({
      id,
      origin: box
        ? { x: center.x - box.left, y: center.y - box.top }
        : { x: 195, y: 500 },
    });
  };

  const closeApp = () => {
    // 先播收回动画，播完再卸载——直接卸载就是硬切，看着像闪退。
    setClosing(true);
    window.setTimeout(() => {
      setOpen(null);
      setClosing(false);
    }, 420);
  };

  const app = open ? appById(open.id) : undefined;

  return (
    <div
      ref={device}
      className="device"
      data-tone={wallpaper.tone}
      style={{ background: wallpaper.css }}
    >
      {locked ? (
        <LockScreen onUnlock={() => setLocked(false)} />
      ) : (
        <HomeScreen onOpen={openApp} />
      )}

      {open && app && (
        <AppWindow app={app} origin={open.origin} closing={closing} onClose={closeApp}>
          {app.id === "chat" ? (
            <ChatApp settings={settings} />
          ) : app.id === "settings" ? (
            <SettingsApp settings={settings} onChange={patch} />
          ) : (
            <PlaceholderApp app={app} />
          )}
        </AppWindow>
      )}
    </div>
  );
}
