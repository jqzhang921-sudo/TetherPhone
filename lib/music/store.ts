"use client";
import { getAllBy, put, remove } from "@/lib/db/idb";
import { newId } from "@/lib/id";

/// 音乐。
///
/// ⚠️ **曲库不挂在联系人下面**，和别的东西不一样：日记、信、动态都是「你和某个人
/// 之间」的，音乐是这台手机自己的。但 IDB 那层每张表都按 contactId 建了索引，
/// 所以用一个固定的作用域名把它塞进同一套机制里，不为它开特例。
export const PHONE = "_phone";

export type Track = {
  id: string;
  contactId: string;
  /// local = 文件就在 blob 里；online = 只记来源，**播的时候现取地址**
  kind: "local" | "online";
  title: string;
  artist: string;
  blob?: Blob;
  /// 在线歌曲在音源那边的 id
  songId?: string;
  cover?: string;
  at: number;
};

export async function loadTracks(): Promise<Track[]> {
  const rows = await getAllBy<Track>("tracks", PHONE);
  return rows.sort((a, b) => b.at - a.at);
}

export const saveTrack = (t: Track) => put("tracks", t);
export const deleteTrack = (id: string) => remove("tracks", id);

export function localTrack(file: File): Track {
  // 文件名当标题：「周杰伦 - 晴天.mp3」这种拆开，拆不开就整个当标题
  const base = file.name.replace(/\.[^.]+$/, "");
  const m = base.match(/^(.+?)\s*[-\u2013\u2014]\s*(.+)$/);
  return {
    id: newId(),
    contactId: PHONE,
    kind: "local",
    title: (m ? m[2] : base).trim(),
    artist: (m ? m[1] : "").trim(),
    blob: file,
    at: Date.now(),
  };
}

export type Found = {
  songId: string;
  title: string;
  artist: string;
  cover?: string;
  /// 音源那边标的收费类型。**拿不到完整音源的那些要让人看出来**，
  /// 别等点下去才发现没声音。
  vip?: boolean;
};

/// 搜。走本站服务端中转——音源实例大多不给浏览器发跨域头。
export async function search(base: string, q: string): Promise<Found[]> {
  const r = await fetch(
    `/api/music?op=search&base=${encodeURIComponent(base)}&q=${encodeURIComponent(q)}`,
  );
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j.songs as Found[];
}


export type Playlist = {
  id: string;
  name: string;
  cover?: string;
  count: number;
  /// 「我喜欢的音乐」。它排在最前面
  liked: boolean;
  /// 自己建的（false = 收藏的别人的）
  mine: boolean;
};

/// 登录之后自己的歌单。没登录返回空——**不抛错**：
/// 没登录不是出了问题，是还没到那一步，界面要说的话也完全不同。
export async function myPlaylists(base: string): Promise<Playlist[]> {
  const r = await fetch(`/api/music?op=mine&base=${encodeURIComponent(base)}`);
  if (r.status === 401) return [];
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j.lists as Playlist[];
}

/// 一个歌单里的歌。
export async function playlistSongs(base: string, id: string): Promise<Found[]> {
  const r = await fetch(
    `/api/music?op=list&base=${encodeURIComponent(base)}&id=${encodeURIComponent(id)}`,
  );
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j.songs as Found[];
}

/// 登没登录、是谁。音乐 app 要靠它决定给你看什么。
export async function musicAccount(base: string): Promise<{ loggedIn: boolean; name?: string }> {
  try {
    const r = await fetch(`/api/music/login?op=status&base=${encodeURIComponent(base)}`);
    if (!r.ok) return { loggedIn: false };
    return (await r.json()) as { loggedIn: boolean; name?: string };
  } catch {
    return { loggedIn: false };
  }
}

/// 取播放地址。
///
/// ⚠️ **给播放器的是本站的转发地址，不是 CDN 的原始地址。**
/// 真机实测浏览器直连 CDN 拿不到（code 4「no supported sources」），
/// 而服务端 fetch 同一个地址是 206 audio/mpeg。转发之后同源、不涉及 CORS
/// 和混合内容，地址也不会过期——每次请求服务端都现去解析一次。
/// 代价是音频流量走服务器。
export async function playUrl(
  base: string,
  songId: string,
): Promise<{ url: string; trial: boolean; loggedIn: boolean }> {
  // 先问一次拿到「是不是只有试听」这个信息——它决定界面上说什么话。
  const r = await fetch(
    `/api/music?op=url&base=${encodeURIComponent(base)}&id=${encodeURIComponent(songId)}`,
  );
  const j = await r.json();
  if (!r.ok || !j.url) throw new Error(j?.error ?? "这首拿不到音源");
  return {
    url: `/api/music?op=stream&base=${encodeURIComponent(base)}&id=${encodeURIComponent(songId)}`,
    trial: !!j.trial,
    loggedIn: !!j.loggedIn,
  };
}

/// 封面的本站地址。**必须走中转**——跨域图画进 canvas 会污染画布，
/// 取色就做不了了（见 lib/music/tone.ts）。
export const coverUrl = (base: string, raw?: string) =>
  raw ? `/api/music?op=cover&base=${encodeURIComponent(base)}&u=${encodeURIComponent(raw)}` : "";

export async function lyric(base: string, songId: string): Promise<string> {
  const r = await fetch(
    `/api/music?op=lyric&base=${encodeURIComponent(base)}&id=${encodeURIComponent(songId)}`,
  );
  if (!r.ok) return "";
  const j = await r.json();
  return (j.lyric as string) ?? "";
}
