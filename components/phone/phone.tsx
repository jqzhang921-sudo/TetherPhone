"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LockScreen } from "./lock-screen";
import { HomeScreen } from "./home-screen";
import { AppWindow } from "./app-window";
import { ContactSheet } from "./contact-sheet";
import { ProfilePage, type Who } from "./profile-page";
import { RefractionProvider } from "./refraction";
import { ME_TINT, faceOf, useMe } from "@/lib/os/avatar";
import { displayName } from "@/lib/os/contacts";
import { ChatApp } from "@/components/apps/chat-app";
import { DiaryApp } from "@/components/apps/diary-app";
import { LettersApp } from "@/components/apps/letters-app";
import { WeatherApp } from "@/components/apps/weather-app";
import { PhotosApp } from "@/components/apps/photos-app";
import { MemoryApp } from "@/components/apps/memory-app";
import { NotesApp } from "@/components/apps/notes-app";
import { MomentsApp } from "@/components/apps/moments-app";
import { MusicApp } from "@/components/apps/music-app";
import { PlayerProvider } from "./player";
import { SettingsApp } from "@/components/apps/settings-app";
import { PlaceholderApp } from "@/components/apps/placeholder-app";
import { appById } from "@/lib/apps/registry";
import { wallpaperById } from "@/lib/os/wallpapers";
import { getAll } from "@/lib/db/idb";
import { readImage, floorOfCss } from "@/lib/music/tone";
import type { Photo } from "@/lib/photos/store";
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
import { loadComments, loadPosts } from "@/lib/moments/store";
import { loadNotes } from "@/lib/notes/store";
import { ThemeApp } from "@/components/apps/theme-app";
import { clearContactImage } from "@/lib/os/contact-image";

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
  /// 主页是「看」，资料卡是「改」。两层分开——从主页点编辑才叠资料卡上去。
  /// `"me"` = 看自己那张。
  const [profile, setProfile] = useState<Contact | "me" | null>(null);
  const me = useMe(settings);
  /// 从主页跳进聊天时带上「开谁」。**app 关掉就清空**——
  /// 不清的话下次从桌面点聊天会莫名其妙直接进上一个人的会话。
  const [chatWith, setChatWith] = useState<string | null>(null);
  /// ⚠️ 机身元素得进 state，不能只放 ref：折射那层是在**子组件**里读它的，
  /// ref 变化不触发重渲染，子组件第一帧拿到的会是 null 然后再也不更新。
  const [deviceEl, setDeviceEl] = useState<HTMLElement | null>(null);
  const [badges, setBadges] = useState<Record<string, number>>({});
  const device = useRef<HTMLDivElement>(null);
  /// 计时回调要拿到最新的联系人和「在和谁听」，但又不能把它们塞进依赖里
  /// ——那样每次联系人变动都会重建定时器，永远攒不满 15 秒。用 ref 兜住。
  const contactsRef = useRef<Contact[]>([]);
  const togetherRef = useRef("");

  // ── 系统返回键 ────────────────────────────────────────────────
  //
  // 安卓的返回手势/返回键走的是浏览器历史。每打开一层（app、资料卡）就压一条
  // 历史进去，返回时 popstate 把最上面那层关掉——**这样系统返回键和界面里的
  // home 条走的是同一条路**，不会出现「按返回直接退出整个站」。
  //
  // iOS 加到主屏幕后没有系统返回键，所以 home 条不能撤，它才是那边唯一的出口。
  const depth = useRef(0);
  const sheetRef = useRef<Contact | null>(null);
  const profileRef = useRef<Contact | "me" | null>(null);
  const openRef = useRef<Open | null>(null);
  useEffect(() => {
    sheetRef.current = sheet;
  }, [sheet]);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
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
  /// 桌面上的红点。
  ///
  /// ⚠️ **只数「它做的」，不数她自己写的。** 给自己发的东西点红点是荒唐的，
  /// 而这三张表里两边的行长得一样，很容易顺手全数进去。
  const refreshBadges = useCallback(async (list: Contact[], s: Settings) => {
    let letters = 0;
    let moments = 0;
    let notes = 0;
    for (const c of list) {
      letters += unreadCount(await loadLetters(c.id));
      const [posts, comments, board] = await Promise.all([
        loadPosts(c.id),
        loadComments(c.id),
        loadNotes(c.id),
      ]);
      moments +=
        posts.filter((x) => x.author === "them" && x.at > s.seenMoments).length +
        comments.filter((x) => x.author === "them" && x.at > s.seenMoments).length;
      notes += board.filter((x) => x.author === "them" && !x.done && x.at > s.seenNotes).length;
    }
    setBadges({ letters, moments, notes });
  }, []);

  const reloadAll = useCallback(() => {
    const s = loadSettings();
    setSettings(s);
    // 第一次进来种一个空联系人，顺手把旧版存在全局设置里的名字/人设搬过来。
    void ensureSeed({ aiName: s.aiName, persona: s.persona }).then((list) => {
      setContacts(list);
      void refreshBadges(list, s);
    });
  }, [refreshBadges]);

  useEffect(reloadAll, [reloadAll]);

  /// 关掉 app 时重算角标。**它在聊天里顺手贴了张便签**——那时候桌面还没看见。
  /// 挂在"关掉"上而不是每个 app 各自通知：少一个会忘的地方。
  useEffect(() => {
    if (open) return;
    void refreshBadges(contactsRef.current, settings);
  }, [open, settings, refreshBadges]);

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
    // 挂在这个人身上的大图都存在 photos 表里、以联系人 id 命名，
    // 人没了它们就是孤儿。⚠️ **新加一种图要记得加到这儿**——
    // 漏了不会报错，只会在库里悄悄攒垃圾。
    await Promise.all([clearContactImage("chatbg", id), clearContactImage("banner", id)]);
    await deleteContact(id);
    setContacts(await loadContacts());
  };

  const addContact = async () => {
    const c = blankContact();
    await saveContact(c);
    setContacts(await loadContacts());
    showSheet(c);
  };

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);
  useEffect(() => {
    togetherRef.current = settings.togetherWith;
  }, [settings.togetherWith]);

  /// 一起听的计时落到联系人身上。
  /// ⚠️ 不在 setContacts 的更新函数里做写库——严格模式会把更新函数跑两遍，
  /// 那样每次都记双倍。先算好、写库，再更新状态。
  const onListened = useCallback((sec: number) => {
    const id = togetherRef.current;
    if (!id) return;
    const hit = contactsRef.current.find((c) => c.id === id);
    if (!hit) return;
    const next = { ...hit, together: (hit.together ?? 0) + sec };
    void saveContact(next);
    setContacts((prev) => prev.map((c) => (c.id === id ? next : c)));
  }, []);

  /// 一起听过几首。和计时同一个理由：写库前先算好，别在 setState 的更新函数里做。
  const onSong = useCallback(() => {
    const id = togetherRef.current;
    if (!id) return;
    const hit = contactsRef.current.find((c) => c.id === id);
    if (!hit) return;
    const next = { ...hit, songs: (hit.songs ?? 0) + 1 };
    void saveContact(next);
    setContacts((prev) => prev.map((c) => (c.id === id ? next : c)));
  }, []);

  const wallpaper = wallpaperById(settings.wallpaperId);

  /// 自己传的壁纸。
  /// ⚠️ **深浅要从图里算，不能让人自己选。** 她选错了整页字就没法看，
  /// 而且换一张就得重选一次。用和封面取色同一套（WCAG 相对亮度 0.179 那道门槛，
  /// 不是 OKLab 的 L——两者不是一回事）。
  const [custom, setCustom] = useState<{ url: string; dark: boolean; alpha: number } | null>(null);
  useEffect(() => {
    const id = settings.wallpaperPhotoId;
    if (!id) {
      setCustom(null);
      return;
    }
    let url: string | null = null;
    let alive = true;
    void (async () => {
      const rows = await getAll<Photo>("photos");
      const hit = rows.find((r) => r.id === id);
      if (!hit?.blob || !alive) return;
      url = URL.createObjectURL(hit.blob);
      // 用机身的真实宽高比，别写死——改了 --phone-w/h 这里要跟着走
      const box = device.current;
      const r = await readImage(
        url,
        box && box.offsetHeight ? box.offsetWidth / box.offsetHeight : undefined,
      );
      if (alive) {
        // 存的是这张图**要求的下限**，不是最终值。最终值在 CSS 里
        // 由 max(默认, 下限) 决定——平坦的壁纸下限低于默认，就什么都不改。
        setCustom({ url, dark: r?.tone.dark ?? true, alpha: r?.minAlpha ?? 0 });
      } else URL.revokeObjectURL(url);
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [settings.wallpaperPhotoId]);

  /// 内置壁纸的下限。**照片和渐变走两条路**：照片能采样，渐变采不到，
  /// 只能从它自己的色标推。算一次存着——换壁纸才需要重算。
  const [cssFloor, setCssFloor] = useState(0);
  useEffect(() => {
    if (settings.wallpaperPhotoId) return;
    setCssFloor(floorOfCss(wallpaper.css, wallpaper.tone === "dark"));
  }, [settings.wallpaperPhotoId, wallpaper.css, wallpaper.tone]);

  /// 当前生效的玻璃下限，主题页要用它卡住滑杆
  const floor = settings.wallpaperPhotoId ? (custom?.alpha ?? 0) : cssFloor;

  const openApp = (id: string, center: { x: number; y: number }) => {
    // 打开就算看过。**在这儿记而不是在 app 里面记**——两个 app 各记一遍
    // 迟早有一个忘了，而"角标不消"是那种每次看到都烦一下的毛病。
    if (id === "moments") patchSettings({ seenMoments: Date.now() });
    if (id === "notes") patchSettings({ seenNotes: Date.now() });
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
      setChatWith(null);
    }, 420);
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (depth.current > 0) depth.current--;
      // 从最上面一层往下关
      // ⚠️ 顺序就是叠放顺序：资料卡叠在主页上面，主页叠在 app 上面。
      // 关错顺序的症状是按一次返回，底下那层先没了、上面那层还杵着。
      if (sheetRef.current) {
        setSheet(null);
        return;
      }
      if (profileRef.current) {
        setProfile(null);
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

  /// 收掉最上面那一层。走 history.back()，由 popstate 决定关的是谁——
  /// **别在这里自己判断关哪层**，那就变成两套顺序，迟早不一致。
  const closeLayer = () => {
    if (depth.current > 0) history.back();
    else if (sheet) setSheet(null);
    else setProfile(null);
  };

  const showSheet = (c: Contact) => {
    setSheet(c);
    pushLayer();
  };

  const showProfile = (c: Contact | "me") => {
    setProfile(c);
    pushLayer();
  };

  /// 联系人 → 主页要的那份形状。**收在一处**，
  /// 否则加一个字段要在两个地方各拼一遍。
  const whoOf = (c: Contact): Who => ({
    id: c.id,
    name: displayName(c),
    realName: c.note.trim() && c.name.trim() !== c.note.trim() ? c.name.trim() : "",
    signature: c.signature,
    face: faceOf(c),
    tint: c.tint,
    bannerAt: c.bannerAt,
    songs: c.songs,
    together: c.together,
  });

  const app = open ? appById(open.id) : undefined;

  return (
    // 播放器套在最外面：退出音乐 app 歌还在放，audio 元素不跟着卸载。
    <PlayerProvider apiBase={settings.musicApiBase} onListened={onListened} onSong={onSong}>
    <RefractionProvider
      value={{
        url: custom?.url,
        css: custom ? undefined : wallpaper.css,
        device: deviceEl,
        edge: settings.glassEdge,
      }}
    >
    <div
      ref={(el) => {
        device.current = el;
        setDeviceEl(el);
      }}
      className="device"
      data-tone={custom ? (custom.dark ? "dark" : "light") : wallpaper.tone}
      style={{
        ...(custom
          ? {
              backgroundImage: `url(${custom.url})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : { background: wallpaper.css }),
        // 这张壁纸算出来的下限，交给 CSS 的 max() 去顶
        ["--glass-floor" as string]: `${Math.round(floor * 100)}%`,
        ["--glass-floor-strong" as string]: `${Math.min(92, Math.round(floor * 100) + 16)}%`,
        // 用户在主题里拉的厚度。**只是"想要的观感"**——上面那条下限还压着它，
        // 所以拉到最左也不会把字拉没。0 = 没拉过，用 globals.css 的默认。
        ...(settings.glassAlpha
          ? {
              ["--glass-alpha" as string]: `${settings.glassAlpha}%`,
              ["--glass-alpha-strong" as string]: `${Math.min(92, settings.glassAlpha + 18)}%`,
            }
          : null),
        ...(settings.iconAlpha ? { ["--glass-icon-alpha" as string]: `${settings.iconAlpha}%` } : null),
        ...(settings.glassBlur ? { ["--glass-blur" as string]: `${settings.glassBlur}px` } : null),
      }}
    >
      {locked ? (
        <LockScreen contacts={contacts} onUnlock={() => setLocked(false)} />
      ) : (
        <HomeScreen
          onOpen={openApp}
          badges={badges}
          settings={settings}
          contacts={contacts}
          onChange={patchSettings}
        />
      )}

      {open && app && (
        <AppWindow app={app} origin={open.origin} closing={closing} onClose={closeApp}>
          {app.id === "chat" ? (
            <ChatApp
              contacts={contacts}
              settings={settings}
              onOpenProfile={showProfile}
              onAddContact={() => void addContact()}
              onGreeted={(id) => {
                const c = contactsRef.current.find((x) => x.id === id);
                if (c) void upsertContact({ ...c, greetedAt: Date.now() });
              }}
              openWith={chatWith}
            />
          ) : app.id === "diary" ? (
            <DiaryApp contacts={contacts} settings={settings} />
          ) : app.id === "letters" ? (
            <LettersApp
              contacts={contacts}
              settings={settings}
              onUnreadChange={() => void refreshBadges(contacts, settings)}
            />
          ) : app.id === "music" ? (
            <MusicApp
              settings={settings}
              contacts={contacts}
              onChange={patchSettings}
            />
          ) : app.id === "moments" ? (
            <MomentsApp contacts={contacts} settings={settings} />
          ) : app.id === "notes" ? (
            <NotesApp contacts={contacts} settings={settings} />
          ) : app.id === "memory" ? (
            <MemoryApp contacts={contacts} />
          ) : app.id === "photos" ? (
            <PhotosApp contacts={contacts} />
          ) : app.id === "weather" ? (
            <WeatherApp settings={settings} onChange={patchSettings} />
          ) : app.id === "theme" ? (
            <ThemeApp
              settings={settings}
              onChange={patchSettings}
              floor={floor}
              wallpaperUrl={custom?.url}
            />
          ) : app.id === "settings" ? (
            <SettingsApp
              settings={settings}
              contacts={contacts}
              onChange={patchSettings}
              onReloadAll={reloadAll}
              onOpenMe={() => {
                closeApp();
                window.setTimeout(() => showProfile("me"), 460);
              }}
            />
          ) : (
            <PlaceholderApp app={app} />
          )}
        </AppWindow>
      )}

      {/* 主页：聊天里点头像、通讯录里点条目，进的都是这儿 */}
      {profile === "me" && (
        <ProfilePage
          who={{
            // 自己没有 contactId，给一个固定的，横幅才挂得上
            id: "__me__",
            name: settings.userName.trim() || "你",
            signature: settings.userSignature,
            face: me,
            tint: ME_TINT,
            bannerAt: settings.userBannerAt || undefined,
          }}
          onEdit={() => {
            // 自己的资料在设置里改——名字、签名、头像本来就都在那儿
            closeLayer();
            const box = device.current?.getBoundingClientRect();
            const c = box
              ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
              : { x: 0, y: 0 };
            window.setTimeout(() => openApp("settings", c), 60);
          }}
          onClose={closeLayer}
        />
      )}

      {profile && profile !== "me" && (
        <ProfilePage
          who={whoOf(contacts.find((c) => c.id === profile.id) ?? profile)}
          onEdit={() => showSheet(profile)}
          onChat={() => {
            // 先收主页再开聊天：反过来的话新窗口被压在主页底下，
            // 看着像"点了没反应"。back() 是异步的，等一帧再开。
            closeLayer();
            // openApp 收的是**视口坐标**（它自己再减设备框原点），
            // 传框内坐标会被减两次，窗口从屏幕外面长出来
            const box = device.current?.getBoundingClientRect();
            const c = box
              ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
              : { x: 0, y: 0 };
            setChatWith(profile.id);
            window.setTimeout(() => openApp("chat", c), 60);
          }}
          onClose={closeLayer}
        />
      )}

      {/* 资料卡叠在主页上面：主页是看，这个是改 */}
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
    </RefractionProvider>
    </PlayerProvider>
  );
}
