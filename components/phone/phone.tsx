"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LockScreen } from "./lock-screen";
import { HomeScreen } from "./home-screen";
import { AppWindow } from "./app-window";
import { ContactSheet } from "./contact-sheet";
import { ChatApp } from "@/components/apps/chat-app";
import { ContactsApp } from "@/components/apps/contacts-app";
import { SettingsApp } from "@/components/apps/settings-app";
import { PlaceholderApp } from "@/components/apps/placeholder-app";
import { appById } from "@/lib/apps/registry";
import { wallpaperById } from "@/lib/os/wallpapers";
import {
  blankContact,
  deleteContact,
  ensureSeed,
  loadContacts,
  saveContact,
  type Contact,
} from "@/lib/os/contacts";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "@/lib/os/settings";

type Open = { id: string; origin: { x: number; y: number } };

export function Phone() {
  // 首屏用默认值渲染，挂载后再读本地数据：服务端和客户端第一次渲染的东西
  // 必须一致，否则 hydration 会报错。
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [locked, setLocked] = useState(true);
  const [open, setOpen] = useState<Open | null>(null);
  const [closing, setClosing] = useState(false);
  const [sheet, setSheet] = useState<Contact | null>(null);
  const device = useRef<HTMLDivElement>(null);

  const reloadAll = useCallback(() => {
    const s = loadSettings();
    setSettings(s);
    // 第一次进来种一个空联系人，顺手把旧版存在全局设置里的名字/人设搬过来。
    void ensureSeed({ aiName: s.aiName, persona: s.persona }).then(setContacts);
  }, []);

  useEffect(reloadAll, [reloadAll]);

  const patchSettings = (p: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...p };
      saveSettings(next);
      return next;
    });
  };

  const upsertContact = async (c: Contact) => {
    await saveContact(c);
    setContacts(await loadContacts());
  };

  const removeContact = async (id: string) => {
    await deleteContact(id);
    setContacts(await loadContacts());
  };

  const addContact = async () => {
    const c = blankContact();
    await saveContact(c);
    setContacts(await loadContacts());
    setSheet(c);
  };

  const wallpaper = wallpaperById(settings.wallpaperId);

  const openApp = (id: string, center: { x: number; y: number }) => {
    // AppIcon 给的是视口坐标；窗口的 transform-origin 要的是设备框内坐标。
    const box = device.current?.getBoundingClientRect();
    setClosing(false);
    setOpen({
      id,
      origin: box ? { x: center.x - box.left, y: center.y - box.top } : { x: 195, y: 500 },
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
            <ChatApp contacts={contacts} settings={settings} onOpenProfile={setSheet} />
          ) : app.id === "contacts" ? (
            <ContactsApp contacts={contacts} onOpen={setSheet} onAdd={() => void addContact()} />
          ) : app.id === "settings" ? (
            <SettingsApp settings={settings} onChange={patchSettings} onReloadAll={reloadAll} />
          ) : (
            <PlaceholderApp app={app} />
          )}
        </AppWindow>
      )}

      {/* 资料卡浮在最上层：聊天里点头像和通讯录里点条目进的是同一个 */}
      {sheet && (
        <ContactSheet
          contact={sheet}
          canDelete={contacts.length > 1}
          onSave={(c) => void upsertContact(c)}
          onDelete={(id) => void removeContact(id)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
