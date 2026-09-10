"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LockScreen } from "./lock-screen";
import { HomeScreen } from "./home-screen";
import { AppWindow } from "./app-window";
import { ContactSheet } from "./contact-sheet";
import { ChatApp } from "@/components/apps/chat-app";
import { ContactsApp } from "@/components/apps/contacts-app";
import { DiaryApp } from "@/components/apps/diary-app";
import { LettersApp } from "@/components/apps/letters-app";
import { WeatherApp } from "@/components/apps/weather-app";
import { PhotosApp } from "@/components/apps/photos-app";
import { MemoryApp } from "@/components/apps/memory-app";
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
import { loadLetters, unreadCount } from "@/lib/letters/store";

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
  const [badges, setBadges] = useState<Record<string, number>>({});
  const device = useRef<HTMLDivElement>(null);

  // ── 系统返回键 ────────────────────────────────────────────────
  //
  // 安卓的返回手势/返回键走的是浏览器历史。每打开一层（app、资料卡）就压一条
  // 历史进去，返回时 popstate 把最上面那层关掉——**这样系统返回键和界面里的
  // home 条走的是同一条路**，不会出现「按返回直接退出整个站」。
  //
  // iOS 加到主屏幕后没有系统返回键，所以 home 条不能撤，它才是那边唯一的出口。
  const depth = useRef(0);
  const sheetRef = useRef<Contact | null>(null);
  const openRef = useRef<Open | null>(null);
  useEffect(() => {
    sheetRef.current = sheet;
  }, [sheet]);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const pushLayer = () => {
    try {
      history.pushState({ tether: ++depth.current }, "");
    } catch {
      // 历史 API 用不了（极少数内嵌 webview）就退回「只能点 home 条」，
      // 不影响别的。
    }
  };

  /// 桌面上的红点。现在只有「还没拆的信」一种，但入口留成通用的
  /// ——动态、备忘录以后都要往这儿挂。
  const refreshBadges = useCallback(async (list: Contact[]) => {
    let letters = 0;
    for (const c of list) letters += unreadCount(await loadLetters(c.id));
    setBadges({ letters });
  }, []);

  const reloadAll = useCallback(() => {
    const s = loadSettings();
    setSettings(s);
    // 第一次进来种一个空联系人，顺手把旧版存在全局设置里的名字/人设搬过来。
    void ensureSeed({ aiName: s.aiName, persona: s.persona }).then((list) => {
      setContacts(list);
      void refreshBadges(list);
    });
  }, [refreshBadges]);

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
    showSheet(c);
  };

  const wallpaper = wallpaperById(settings.wallpaperId);

  const openApp = (id: string, center: { x: number; y: number }) => {
    // AppIcon 给的是视口坐标；窗口的 transform-origin 要的是设备框内坐标。
    const box = device.current?.getBoundingClientRect();
    setClosing(false);
    pushLayer();
    setOpen({
      id,
      origin: box ? { x: center.x - box.left, y: center.y - box.top } : { x: 195, y: 500 },
    });
  };

  /// 真正的收回动作。**只有 popstate 和兜底路径调它**——
  /// 界面上的关闭走 history.back()，让两条路汇成一条。
  const doCloseApp = useCallback(() => {
    // 先播收回动画，播完再卸载——直接卸载就是硬切，看着像闪退。
    setClosing(true);
    window.setTimeout(() => {
      setOpen(null);
      setClosing(false);
    }, 420);
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (depth.current > 0) depth.current--;
      // 从最上面一层往下关
      if (sheetRef.current) {
        setSheet(null);
        return;
      }
      if (openRef.current) doCloseApp();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [doCloseApp]);

  /// 界面上的关闭。压过历史就走 back（让系统返回键和它同一条路），
  /// 没压成功就直接关。
  const closeApp = () => {
    if (depth.current > 0) history.back();
    else doCloseApp();
  };

  const closeSheet = () => {
    if (depth.current > 0) history.back();
    else setSheet(null);
  };

  const showSheet = (c: Contact) => {
    setSheet(c);
    pushLayer();
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
        <HomeScreen onOpen={openApp} badges={badges} />
      )}

      {open && app && (
        <AppWindow app={app} origin={open.origin} closing={closing} onClose={closeApp}>
          {app.id === "chat" ? (
            <ChatApp contacts={contacts} settings={settings} onOpenProfile={showSheet} />
          ) : app.id === "contacts" ? (
            <ContactsApp contacts={contacts} onOpen={showSheet} onAdd={() => void addContact()} />
          ) : app.id === "diary" ? (
            <DiaryApp contacts={contacts} settings={settings} />
          ) : app.id === "letters" ? (
            <LettersApp
              contacts={contacts}
              settings={settings}
              onUnreadChange={() => void refreshBadges(contacts)}
            />
          ) : app.id === "memory" ? (
            <MemoryApp contacts={contacts} />
          ) : app.id === "photos" ? (
            <PhotosApp contacts={contacts} />
          ) : app.id === "weather" ? (
            <WeatherApp settings={settings} onChange={patchSettings} />
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
          onClose={closeSheet}
        />
      )}
    </div>
  );
}
