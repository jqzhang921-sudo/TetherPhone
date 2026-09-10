"use client";
import { useCallback, useEffect, useState } from "react";
import {
  blankComment,
  blankPost,
  deleteComment,
  deletePost,
  loadComments,
  loadPosts,
  claimPending,
  savePost,
  saveComment,
  timeAgo,
  type Comment,
  type Post,
} from "@/lib/moments/store";
import { completeOnce, identity } from "@/lib/ai";
import { loadMsgs } from "@/lib/chat/store";
import { loadPhotos, type Photo } from "@/lib/photos/store";
import { PhotoImg } from "@/components/photos/photo-img";
import { PhotoPicker } from "@/components/photos/photo-picker";
import { displayName, type Contact } from "@/lib/os/contacts";
import type { Settings } from "@/lib/os/settings";

function Heart({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill={on ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.2 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9A4.6 4.6 0 0 1 19.4 13z" />
    </svg>
  );
}

export function MomentsApp({
  contacts,
  settings,
}: {
  contacts: Contact[];
  settings: Settings;
}) {
  const [who, setWho] = useState(contacts[0]?.id ?? "");
  const [posts, setPosts] = useState<Post[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [photos, setPhotos] = useState<Record<string, Photo>>({});
  const [draft, setDraft] = useState<{ text: string; photoIds: string[] } | null>(null);
  const [picking, setPicking] = useState(false);
  const [replyTo, setReplyTo] = useState<{ postId: string; commentId?: string; who: string } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const contact = contacts.find((c) => c.id === who) ?? contacts[0] ?? null;

  const refresh = useCallback(async (cid: string) => {
    setPosts(await loadPosts(cid));
    setComments(await loadComments(cid));
  }, []);

  useEffect(() => {
    if (!who && contacts[0]) setWho(contacts[0].id);
  }, [contacts, who]);

  /// 打开时看一眼：她发过、它还没回应过的那条。
  ///
  /// ⚠️ **没有这样的候选就到此为止，连模型都不问。** 这条是从沐那边搬的：
  /// 频率由「有没有事情发生」决定，不由数字决定——问了它只会凑话。
  const settle = useCallback(
    async (c: Contact) => {
      if (!settings.apiKey) return;
      // 挑和占在同一个事务里完成。抢不到（别人已经占了）就直接回，
      // 这也是防重入的全部——ref 挡不住组件重新挂载。
      const hit = await claimPending(c.id);
      if (!hit) return;

      setBusy(true);
      try {
        const talk = (await loadMsgs(c.id))
          .filter((m) => m.role !== "event")
          .slice(-8)
          .map((m) => `${m.role === "user" ? "她" : "你"}：${m.content}`)
          .join("\n");
        const out = await completeOnce(
          settings,
          c,
          [
            ...identity(c, settings),
            `她发了条动态：「${hit.text}」`,
            talk ? `你们最近说过：\n${talk}` : "",
            "你要不要回应？",
            "想说点什么就**只输出那句话**（一句，别长，像在评论区说话）；",
            "只想让她知道你看到了，就输出「赞」；",
            "没什么想说的，就输出「不说」——**这也是常有的事，别硬凑**。",
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const said = out.trim();
        const seen = { ...hit, seenByThem: true };
        if (said === "赞") {
          await savePost({ ...seen, likedByThem: true });
        } else if (said && !/^(不说|没有|无|不回应)$/.test(said)) {
          await savePost({ ...seen, likedByThem: true });
          await saveComment(blankComment(c.id, hit.id, "them", said));
        } else {
          await savePost(seen);
        }
        await refresh(c.id);
      } catch (e) {
        // 问失败了就把坑退回去，下次打开还能再来一次
        await savePost({ ...hit, seenByThem: false });
        setNote(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [settings, refresh],
  );

  useEffect(() => {
    if (!contact) return;
    void loadPhotos(contact.id).then((all) =>
      setPhotos(Object.fromEntries(all.map((p) => [p.id, p]))),
    );
    void refresh(contact.id).then(() => void settle(contact));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who]);

  if (!contact) {
    return (
      <div className="flex-1 grid place-items-center px-10 text-center">
        <p className="text-[13px]" style={{ color: "var(--ink-faint)" }}>
          先在通讯录里建一个联系人。
        </p>
      </div>
    );
  }

  const nameOf = (a: "me" | "them") => (a === "me" ? settings.userName.trim() || "你" : displayName(contact));
  const faceOf = (a: "me" | "them") => (a === "me" ? settings.userEmoji : contact.emoji);
  const tintOf = (a: "me" | "them") => (a === "me" ? "oklch(0.7 0.02 250)" : contact.tint);

  // ── 写一条 ──────────────────────────────────────────────────
  if (draft) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-4 pb-2">
          <button onClick={() => setDraft(null)} className="text-[14px]" style={{ color: "var(--ink-dim)" }}>
            算了
          </button>
          <button
            onClick={async () => {
              if (!draft.text.trim() && !draft.photoIds.length) return setDraft(null);
              await savePost({
                ...blankPost(contact.id, "me", draft.text.trim()),
                photoIds: draft.photoIds.length ? draft.photoIds : undefined,
              });
              await refresh(contact.id);
              setDraft(null);
            }}
            className="text-[14px]"
            style={{ color: "var(--ink)" }}
          >
            发出去
          </button>
        </div>

        <div className="flex-1 min-h-0 px-4">
          <textarea
            autoFocus
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            placeholder="这会儿在想什么"
            className="w-full h-40 bg-transparent outline-none resize-none text-[16px] leading-relaxed"
            style={{ color: "var(--ink)" }}
          />
          {!!draft.photoIds.length && (
            <div className="grid grid-cols-3 gap-1.5">
              {draft.photoIds.map((id) => (
                <PhotoImg key={id} photo={photos[id]} className="w-full rounded-lg object-cover"
                  style={{ aspectRatio: "1 / 1" }} />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 pb-2">
          <button onClick={() => setPicking(true)} className="text-[13px]" style={{ color: "var(--ink-faint)" }}>
            配图{draft.photoIds.length ? ` · ${draft.photoIds.length}` : ""}
          </button>
        </div>

        {picking && (
          <PhotoPicker
            contactId={contact.id}
            picked={draft.photoIds}
            onDone={(ids) => setDraft({ ...draft, photoIds: ids })}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    );
  }

  // ── 时间线 ──────────────────────────────────────────────────
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {contacts.length > 1 && (
        <div className="shrink-0 flex gap-2 px-4 pb-2">
          {contacts.map((c) => (
            <button
              key={c.id}
              onClick={() => setWho(c.id)}
              className="shrink-0 w-8 h-8 rounded-full grid place-items-center text-[16px]"
              style={{
                background: c.tint,
                opacity: c.id === who ? 1 : 0.4,
                outline: c.id === who ? "2px solid var(--ink)" : "none",
                outlineOffset: 2,
              }}
            >
              {c.emoji}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto no-bar px-4 pb-3 flex flex-col gap-3">
        {posts.length === 0 && !busy && (
          <div className="flex-1 grid place-items-center px-8 text-center">
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
              这儿还什么都没有。
              <br />
              你发一条，它看到了会来说话。
            </p>
          </div>
        )}

        {posts.map((p) => {
          const mine = comments.filter((c) => c.postId === p.id);
          // 名字统一走 nameOf——点赞写「你」、评论写「Cleo」的话，
          // 同一条动态里同一个人会有两个叫法。
          const likes = [p.likedByMe && nameOf("me"), p.likedByThem && nameOf("them")].filter(Boolean);
          return (
            <article key={p.id} className="glass rounded-2xl p-3.5">
              <div className="flex items-center gap-2.5 mb-2">
                <span
                  className="w-8 h-8 rounded-full grid place-items-center text-[16px] shrink-0"
                  style={{ background: tintOf(p.author) }}
                >
                  {faceOf(p.author)}
                </span>
                <span className="text-[14px]" style={{ color: "var(--ink)" }}>
                  {nameOf(p.author)}
                </span>
                <span className="flex-1" />
                <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                  {timeAgo(p.at)}
                </span>
              </div>

              {!!p.text && (
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--ink)" }}>
                  {p.text}
                </p>
              )}

              {!!p.photoIds?.length && (
                <div className={`grid gap-1.5 mt-2 ${p.photoIds.length > 1 ? "grid-cols-3" : "grid-cols-1"}`}>
                  {p.photoIds.map((id) => (
                    <PhotoImg
                      key={id}
                      photo={photos[id]}
                      className="w-full rounded-lg object-cover"
                      style={{ aspectRatio: p.photoIds!.length > 1 ? "1 / 1" : "4 / 3" }}
                    />
                  ))}
                </div>
              )}

              <div className="flex items-center gap-4 pt-2.5">
                <button
                  onClick={async () => {
                    await savePost({ ...p, likedByMe: !p.likedByMe });
                    await refresh(contact.id);
                  }}
                  className="flex items-center gap-1 text-[12px]"
                  style={{ color: p.likedByMe ? "oklch(0.65 0.19 15)" : "var(--ink-faint)" }}
                >
                  <Heart on={p.likedByMe} />
                  {likes.length > 0 && <span>{likes.join("、")}</span>}
                </button>
                <button
                  onClick={() => {
                    setReplyTo({ postId: p.id, who: nameOf(p.author) });
                    setInput("");
                  }}
                  className="text-[12px]"
                  style={{ color: "var(--ink-faint)" }}
                >
                  说点什么
                </button>
                <span className="flex-1" />
                {p.author === "me" && (
                  <button
                    onClick={async () => {
                      if (!window.confirm("删掉这条动态？下面的评论一起没。")) return;
                      for (const c of mine) await deleteComment(c.id);
                      await deletePost(p.id);
                      await refresh(contact.id);
                    }}
                    className="text-[12px]"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    删掉
                  </button>
                )}
              </div>

              {mine.length > 0 && (
                <div
                  className="mt-2.5 pt-2.5 flex flex-col gap-1.5"
                  style={{ borderTop: "1px solid var(--glass-edge)" }}
                >
                  {mine.map((c) => {
                    const parent = c.replyTo ? mine.find((x) => x.id === c.replyTo) : undefined;
                    return (
                      <button
                        key={c.id}
                        onClick={() =>
                          setReplyTo({ postId: p.id, commentId: c.id, who: nameOf(c.author) })
                        }
                        className="text-left text-[13px] leading-relaxed"
                        style={{ color: "var(--ink-dim)" }}
                      >
                        <span style={{ color: tintOf(c.author) }}>{nameOf(c.author)}</span>
                        {parent && (
                          <>
                            <span style={{ color: "var(--ink-faint)" }}> 回复 </span>
                            <span style={{ color: tintOf(parent.author) }}>{nameOf(parent.author)}</span>
                          </>
                        )}
                        <span style={{ color: "var(--ink-faint)" }}>：</span>
                        {c.text}
                      </button>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}

        {busy && (
          <p className="text-center text-[11px] py-2" style={{ color: "var(--ink-faint)" }}>
            {displayName(contact)}在看…
          </p>
        )}
        {note && (
          <p className="text-center text-[11px] py-1" style={{ color: "var(--ink-faint)" }}>
            {note}
          </p>
        )}
      </div>

      {replyTo ? (
        <div className="shrink-0 px-3 pb-1 pt-1">
          <div className="glass-strong rounded-[24px] flex items-end gap-2 px-3 py-2">
            <textarea
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setReplyTo(null);
              }}
              rows={1}
              placeholder={replyTo.commentId ? `回复 ${replyTo.who}` : "说点什么"}
              className="flex-1 bg-transparent outline-none resize-none text-[14px] max-h-20 py-1.5"
              style={{ color: "var(--ink)" }}
            />
            <button onClick={() => setReplyTo(null)} className="text-[12px] pb-2" style={{ color: "var(--ink-faint)" }}>
              取消
            </button>
            <button
              onClick={async () => {
                const t = input.trim();
                if (!t) return;
                await saveComment(
                  blankComment(contact.id, replyTo.postId, "me", t, replyTo.commentId),
                );
                setInput("");
                setReplyTo(null);
                await refresh(contact.id);
              }}
              disabled={!input.trim()}
              className="shrink-0 w-9 h-9 rounded-full grid place-items-center disabled:opacity-30"
              style={{ background: contact.tint, color: "oklch(0.99 0 0)" }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 px-4 pb-2 flex gap-2">
          <button
            onClick={() => setDraft({ text: "", photoIds: [] })}
            className="glass-strong flex-1 rounded-2xl py-3 text-[14px]"
            style={{ color: "var(--ink)" }}
          >
            发一条
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              if (!settings.apiKey) return setNote("还没填 API key。");
              setBusy(true);
              setNote(null);
              try {
                const talk = (await loadMsgs(contact.id))
                  .filter((m) => m.role !== "event")
                  .slice(-10)
                  .map((m) => `${m.role === "user" ? "她" : "你"}：${m.content}`)
                  .join("\n");
                const text = await completeOnce(
                  settings,
                  contact,
                  [
                    ...identity(contact, settings),
                    "发一条动态。是发给「看到的人」的，不是发给她一个人的——",
                    "所以别写成对她说话，写你自己这会儿的什么。",
                    talk ? `你们最近说过：\n${talk}` : "",
                    "两三句就够。只输出正文，不要引号、不要解释。",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                );
                if (!text) throw new Error("它没写出东西");
                await savePost(blankPost(contact.id, "them", text));
                await refresh(contact.id);
              } catch (e) {
                setNote(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
            className="glass-strong flex-1 rounded-2xl py-3 text-[14px] disabled:opacity-40"
            style={{ color: "var(--ink)" }}
          >
            {busy ? "它在写…" : "让它发一条"}
          </button>
        </div>
      )}
    </div>
  );
}
