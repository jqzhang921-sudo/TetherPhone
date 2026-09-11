"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { playUrl, type Track } from "@/lib/music/store";

/// 播放器住在**壳里**，不在音乐 app 里。
///
/// 理由就是真手机的行为：退出音乐 app，歌还在放。放在 app 组件里的话，
/// 一关 app 组件就卸载、audio 元素跟着没，歌就断了。
type Ctl = {
  track: Track | null;
  playing: boolean;
  at: number;
  len: number;
  err: string | null;
  /// 这首只有试听片段。播到一半会断，界面得说出来。
  trial: boolean;
  /// 音源那边有没有登录态。决定试听提示该说哪句话。
  loggedIn: boolean;
  /// 待播清单。**和歌单不是一回事**：歌单是网易云那边的，
  /// 这个是她（或者它）现在挑出来要放的这几首。
  queue: Track[];
  play: (t: Track, queue?: Track[]) => void;
  /// 加到待播的末尾。已经在里面就不重复加。
  enqueue: (t: Track) => void;
  /// 从待播里去掉第 i 首。去掉的正好是在放的那首就顺到下一首。
  dropAt: (i: number) => void;
  /// 把第 from 首挪到 to 的位置。
  moveTo: (from: number, to: number) => void;
  toggle: () => void;
  /// 停下来并且**从桌面上消失**。暂停不等于关掉——
  /// 一条永远杵在那儿的播放条，没有出口就是个 bug。
  stop: () => void;
  next: () => void;
  prev: () => void;
  seek: (s: number) => void;
};

const Ctx = createContext<Ctl | null>(null);
export const usePlayer = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePlayer 得放在 PlayerProvider 里面");
  return c;
};

export function PlayerProvider({
  apiBase,
  onListened,
  onSong,
  children,
}: {
  apiBase: string;
  /// 每放够一段就报一次。**计时放在这儿而不是音乐 app 里**——
  /// 退出 app 歌还在放，计时也该还在走。
  onListened?: (seconds: number) => void;
  /// 开始放一首新的。用来数「一起听过几首」。
  onSong?: () => void;
  children: React.ReactNode;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [len, setLen] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [trial, setTrial] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  /// 本地文件的 objectURL 要手动回收，不然放几十首就攒一堆
  const objUrl = useRef<string | null>(null);

  const load = useCallback(
    async (t: Track) => {
      const el = audio.current;
      if (!el) return;
      setErr(null);
      setTrial(false);
      if (objUrl.current) {
        URL.revokeObjectURL(objUrl.current);
        objUrl.current = null;
      }
      try {
        if (t.kind === "local" && t.blob) {
          objUrl.current = URL.createObjectURL(t.blob);
          el.src = objUrl.current;
        } else if (t.kind === "online" && t.songId) {
          if (!apiBase.trim()) throw new Error("还没配音源地址");
          // 每次都现取：这类地址带签名和有效期，缓存下来隔天就是 403
          const got = await playUrl(apiBase.trim(), t.songId);
          el.src = got.url;
          setTrial(got.trial);
          setLoggedIn(got.loggedIn);
        } else {
          throw new Error("这首没有可播的内容");
        }
        await el.play();
        setPlaying(true);
      } catch (e) {
        setPlaying(false);
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [apiBase],
  );

  const play = useCallback(
    (t: Track, q?: Track[]) => {
      setTrack(t);
      if (q) setQueue(q);
      onSong?.();
      void load(t);
    },
    [load, onSong],
  );

  const step = useCallback(
    (d: 1 | -1) => {
      if (!track || queue.length < 2) return;
      const i = queue.findIndex((x) => x.id === track.id);
      if (i < 0) return;
      // 转圈：最后一首的下一首回到第一首
      const n = queue[(i + d + queue.length) % queue.length];
      setTrack(n);
      onSong?.();
      void load(n);
    },
    [track, queue, load, onSong],
  );

  const enqueue = useCallback((t: Track) => {
    setQueue((q) => (q.some((x) => x.id === t.id) ? q : [...q, t]));
  }, []);

  const moveTo = useCallback((from: number, to: number) => {
    setQueue((q) => {
      if (from === to || from < 0 || to < 0 || from >= q.length || to >= q.length) return q;
      const next = q.slice();
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  }, []);

  const stop = useCallback(() => {
    const el = audio.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    if (objUrl.current) {
      URL.revokeObjectURL(objUrl.current);
      objUrl.current = null;
    }
    setTrack(null);
    setQueue([]);
    setPlaying(false);
    setAt(0);
    setLen(0);
    setErr(null);
    setTrial(false);
  }, []);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el || !track) return;
    if (el.paused) {
      void el.play().then(
        () => setPlaying(true),
        (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
      );
    } else {
      el.pause();
      setPlaying(false);
    }
  }, [track]);

  useEffect(() => {
    return () => {
      if (objUrl.current) URL.revokeObjectURL(objUrl.current);
    };
  }, []);

  // 一起听的计时。
  // ⚠️ 按「真的在放」计，不按墙上时间——暂停了就不该继续攒。
  // 15 秒报一次：太密了每次都要写库，太疏了关掉页面丢的就多。
  useEffect(() => {
    if (!playing || !onListened) return;
    const t = window.setInterval(() => onListened(15), 15_000);
    return () => window.clearInterval(t);
  }, [playing, onListened]);

  /// ⚠️ **删掉正在放的那首，不能只从数组里抹掉。**
  /// 抹掉之后 `step` 用 `findIndex` 找不到当前这首，上一首/下一首直接失灵，
  /// 而歌还在响——看着像播放器卡住了。所以要先把播放位置挪走。
  const dropAt = useCallback(
    (i: number) => {
      setQueue((q) => {
        const gone = q[i];
        const next = q.filter((_, k) => k !== i);
        if (gone && track && gone.id === track.id) {
          const after = next[i] ?? next[0] ?? null;
          if (after) {
            setTrack(after);
            void load(after);
          } else {
            // 清单空了。**停下来并从桌面消失**，别留一条放不动的播放条。
            const el = audio.current;
            if (el) {
              el.pause();
              el.removeAttribute("src");
              el.load();
            }
            setTrack(null);
            setPlaying(false);
            setAt(0);
            setLen(0);
          }
        }
        return next;
      });
    },
    [track, load],
  );

  const value = useMemo<Ctl>(
    () => ({
      track,
      queue,
      enqueue,
      dropAt,
      moveTo,
      playing,
      at,
      len,
      err,
      trial,
      loggedIn,
      play,
      toggle,
      stop,
      next: () => step(1),
      prev: () => step(-1),
      seek: (s: number) => {
        if (audio.current) audio.current.currentTime = s;
      },
    }),
    [track, queue, enqueue, dropAt, moveTo, playing, at, len, err, trial, loggedIn, play, step, stop],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <audio
        ref={audio}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onDurationChange={(e) => setLen(e.currentTarget.duration || 0)}
        onEnded={() => step(1)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onError={() =>
          setErr("这个地址放不出来（可能过期了，或者音源那边挡了）")
        }
        // ⚠️ **这里千万别加 `crossOrigin`。** 我一开始加了 "anonymous"，
        // 注释还写着「省得触发 CORS 检查」——**正好想反了**：不加才不检查，
        // 加了才强制走 CORS，而音乐 CDN 不发 Access-Control-Allow-Origin，
        // 于是整个加载被拦。症状是「点了没反应、时长 0、也不报错」。
        // 普通播放本来就不需要 CORS，只有要读音频数据（Web Audio 分析、
        // 画波形）才需要。
      />
    </Ctx.Provider>
  );
}

export const mmss = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
