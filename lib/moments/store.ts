"use client";
import { claim, getAllBy, put, remove } from "@/lib/db/idb";
import { newId } from "@/lib/id";

/// 动态。两个人各自发，各自评论、回复、点赞。
///
/// ⚠️ **动态不进实时对话的上下文。** 和信同一条理由：它是另一个场合的东西，
/// 塞进每一轮会让它张口就提你昨天发了什么。它要发、要回应，是在**那个场合**
/// 被叫醒的（工具，或者打开动态页时的结算）。
export type Post = {
  id: string;
  contactId: string;
  author: "me" | "them";
  text: string;
  photoIds?: string[];
  likedByMe: boolean;
  likedByThem: boolean;
  /// 它有没有看过这条并做出反应。**只对她发的有意义**——
  /// 用来判断「有没有事情发生」，没发生就连模型都不问。
  seenByThem?: boolean;
  at: number;
};

export type Comment = {
  id: string;
  contactId: string;
  postId: string;
  author: "me" | "them";
  text: string;
  /// 回复哪一条评论。空 = 直接评论这条动态。
  replyTo?: string;
  at: number;
};

export async function loadPosts(contactId: string): Promise<Post[]> {
  const rows = await getAllBy<Post>("posts", contactId);
  return rows.sort((a, b) => b.at - a.at);
}

export async function loadComments(contactId: string): Promise<Comment[]> {
  const rows = await getAllBy<Comment>("comments", contactId);
  return rows.sort((a, b) => a.at - b.at);
}

export const savePost = (p: Post) => put("posts", p);
export const deletePost = (id: string) => remove("posts", id);
export const saveComment = (c: Comment) => put("comments", c);
export const deleteComment = (id: string) => remove("comments", id);

export function blankPost(contactId: string, author: Post["author"], text: string): Post {
  return {
    id: newId(),
    contactId,
    author,
    text,
    likedByMe: false,
    likedByThem: false,
    seenByThem: author === "them",
    at: Date.now(),
  };
}

export function blankComment(
  contactId: string,
  postId: string,
  author: Comment["author"],
  text: string,
  replyTo?: string,
): Comment {
  return { id: newId(), contactId, postId, author, text, replyTo, at: Date.now() };
}

/// 隔多久它才会来看一眼。
///
/// 不是排班表：**没有新东西就不问模型**（见 pendingFor）。这个数只用来拦
/// 「刚发出去它就秒评」——那种即时反应像机器人守在旁边，不像看到了。
const LOOK_AFTER = 2 * 60_000;

/// 原子地挑一条「它还没回应过的、她发的动态」并当场占坑。
///
/// **没有候选就到此为止，连模型都不问**——这条是从沐那边搬来的：
/// 频率由有没有事情发生决定，不由数字决定。
///
/// ⚠️ 挑和占必须在同一个事务里。分两步的话，问模型那几秒里另一个调用会挑中
/// 同一条，于是它评论两次。（React 严格模式下的双跑就能稳定复现。）
export function claimPending(contactId: string): Promise<Post | null> {
  return claim<Post>("posts", (store, done, fail) => {
    const req = store.index("contactId").getAll(contactId);
    req.onsuccess = () => {
      const hit = (req.result as Post[])
        .sort((a, b) => b.at - a.at)
        .find((p) => p.author === "me" && !p.seenByThem && Date.now() - p.at > LOOK_AFTER);
      if (!hit) return;
      const taken = { ...hit, seenByThem: true };
      const w = store.put(taken);
      w.onsuccess = () => done(taken);
      w.onerror = () => fail(w.error);
    };
    req.onerror = () => fail(req.error);
  });
}

export const timeAgo = (at: number) => {
  const d = Date.now() - at;
  if (d < 60_000) return "刚刚";
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`;
  const dt = new Date(at);
  return `${dt.getMonth() + 1}月${dt.getDate()}日`;
};
