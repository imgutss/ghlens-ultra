import type { Env } from "../env";
import { botUsername } from "../env";
import { Store } from "../core/db";
import type { Telegram } from "../tg/api";
import type { AiBrain } from "../ai/brain";
import { GithubRest } from "../github/rest";

/**
 * Glass keys and a storyteller under every post in a wired channel.
 *
 * The owner posts a project link — any `github.com/owner/repo` in a channel
 * the bot administrates — and the post itself grows a small glass keyboard:
 * architecture, analysis, translation, the repo card. Each button is a deep
 * link, so every reader of the channel lands in the bot on that exact screen,
 * no login, no setup.
 *
 * And under EVERY post — repo or anything else — the storyteller lands a few
 * seconds later: ten casual Persian lines, a friend explaining what the post
 * just said. A repo post is told from live GitHub data (readme, contributors,
 * releases, recent commits); any other post is told from its own words. The
 * channel does not have to be the owner's: anyone who makes the bot an admin
 * has wired their channel, and every wired channel gets both.
 *
 * Consent is membership: the bot only touches a channel it was made an admin
 * of, and only posts that carry no keyboard of their own (the hub's published
 * posts already have buttons — those are never clobbered, and the bot never
 * replies to itself). A post carrying `#بدونتحلیل` (or `#noai`) is left in
 * peace. Keys are armed by editing the post in place — same text, same
 * entities, plus markup — and when the edit is refused (a channel without
 * edit rights) an action bar message goes under it instead.
 */

/** The first `github.com/owner/repo` in a text, or null. */
export function repoFromText(text: string): string | null {
  const m = String(text ?? "").match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
  if (!m) return null;
  const full = `${m[1]}/${m[2].replace(/\.git$/, "")}`;
  return /^[\w.-]+\/[\w.-]+$/.test(full) ? full : null;
}

/**
 * The glass keyboard: four deep links — architecture, AI analysis, README
 * translation, the repo card. URL buttons, so any channel reader can press
 * them; the bot opens on the exact screen.
 */
export function channelRepoKb(full: string, botUser: string): { inline_keyboard: any[][] } {
  const arg = full.replace("/", "_");
  const link = (q: string) => `https://t.me/${botUser}?start=${q}`;
  /* Coloured, the way the owner's favourite store bot paints its rows:
     the left column rides the accent colour, the right goes green then red. */
  return {
    inline_keyboard: [
      [
        { text: "🏛 معماری", url: link(`arch_${arg}`), style: "primary" },
        { text: "🧠 تحلیل", url: link(`c_${arg}`), style: "success" },
      ],
      [
        { text: "🌍 ترجمه", url: link(`t_${arg}`), style: "primary" },
        { text: "📦 کارت", url: link(`repo_${arg}`), style: "danger" },
      ],
    ],
  };
}

/** One channel's daily allowance of storyteller lines. The analysis is a
 *  gift, not a firehose: past the cap the channel stays quiet until
 *  tomorrow. Fail-open — a KV hiccup never silences a channel. */
async function casBudget(env: Env, chat: string | number): Promise<boolean> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const k = `cas:ch:${chat}:${day}`;
    const n = Number((await env.CACHE.get(k).catch(() => null)) ?? 0);
    if (n >= 25) return false;
    await env.CACHE.put(k, String(n + 1), { expirationTtl: 86400 }).catch(() => null);
    return true;
  } catch {
    return true;
  }
}

/** A reply that lands right under the post it belongs to — or, if the post
 *  is gone or too old to reply to, as the next message. Never an error. */
async function sendUnder(tg: Telegram, chat: string | number, mid: number, text: string): Promise<void> {
  const r: any = await tg.call("sendMessage", {
    chat_id: chat, text, reply_to_message_id: mid,
    link_preview_options: { is_disabled: true },
  }).catch(() => null);
  if (!r?.ok) {
    await tg.call("sendMessage", { chat_id: chat, text, link_preview_options: { is_disabled: true } }).catch(() => null);
  }
}

/** The storyteller for a post that points at a repository: ten casual lines
 *  from live GitHub data — the same honest pipeline the showcase post uses —
 *  sent as a reply under the channel post. */
export async function casualRepoReply(
  env: Env, tg: Telegram, ai: AiBrain, chat: string | number, mid: number, ref: string,
): Promise<void> {
  try {
    if (!(await casBudget(env, chat))) return;
    const gh = new GithubRest(env);
    const [meta, readmeRaw, contribs, rels, commits] = await Promise.all([
      gh.repo(ref, 3600).catch(() => null),
      gh.readme(ref, 1800).catch(() => null),
      gh.contributors(ref, 10).catch(() => [] as any[]),
      gh.releases(ref, 5).catch(() => [] as any[]),
      gh.commits(ref, 10).catch(() => [] as any[]),
    ]);
    if (!meta) return;
    let readmeExcerpt = "";
    try {
      const txt = readmeRaw?.content
        ? (readmeRaw.encoding === "base64"
            ? atob(String(readmeRaw.content).replace(/\n/g, ""))
            : String(readmeRaw.content))
        : "";
      readmeExcerpt = txt.slice(0, 1500);
    } catch { /* a readme that will not decode is no readme */ }
    const out = await ai.analyzeRepoCasual({
      full_name: meta.full_name, description: meta.description,
      stars: meta.stargazers_count, forks: meta.forks_count,
      issues: meta.open_issues_count, language: meta.language,
      topics: meta.topics ?? [], license: meta.license?.spdx_id ?? null,
      archived: !!meta.archived, pushed_at: meta.pushed_at, created_at: meta.created_at,
      contributors: Array.isArray(contribs) ? contribs.length : 0,
      releases: Array.isArray(rels) ? rels.length : 0,
      readme_excerpt: readmeExcerpt,
      recent_commits: (Array.isArray(commits) ? commits : []).slice(0, 10).map((c: any) => c.commit?.message?.split("\n")[0]),
    });
    const body = String(out ?? "").trim();
    if (body.length < 40) return;
    await sendUnder(tg, chat, mid, body.slice(0, 3500) + "\n\n🤖 تحلیل خودکار بر اساس دیتای زندهٔ گیت‌هاب");
  } catch (e: any) {
    console.error("lens-swallowed", String(e?.message ?? e));
  }
}

/** The storyteller for any other post: the same ten casual lines about what
 *  the post itself says — grounded in its own words, nothing invented. */
export async function casualPostReply(
  env: Env, tg: Telegram, ai: AiBrain, chat: string | number, mid: number, text: string,
): Promise<void> {
  try {
    if (!(await casBudget(env, chat))) return;
    const out = await ai.analyzePostCasual(text);
    const body = String(out ?? "").trim();
    if (body.length < 40) return;
    await sendUnder(tg, chat, mid, body.slice(0, 3500) + "\n\n🤖 تحلیل خودکار گیت‌لنز");
  } catch (e: any) {
    console.error("lens-swallowed", String(e?.message ?? e));
  }
}

/** A supergroup used as a channel (admin-only posting) never produces
 *  channel_post updates — its posts arrive as ordinary messages. The same
 *  storyteller runs under them, but only for supergroups explicitly wired
 *  through «کانال من»: a discussion group must ask for the analysis, while a
 *  channel's admin membership is consent enough. */
export async function storyUnderSupergroup(post: any, env: Env, tg: Telegram, ai: AiBrain): Promise<void> {
  try {
    const text = String(post?.text ?? post?.caption ?? "");
    if (!text || text.startsWith("/")) return;
    if (post?.from?.is_bot) return;
    if (post?.reply_markup?.inline_keyboard?.length) return;
    const chatId = Number(post?.chat?.id ?? 0);
    if (!chatId) return;
    const log = (name: string, meta?: any) =>
      new Store(env).event(chatId || null, "channelarm", name, meta).catch(() => null);
    const reg = await env.DB.prepare(`SELECT auto FROM channels WHERE chat_id=?`).bind(chatId).first().catch(() => null);
    if (!reg || !Number((reg as any).auto)) { await log("sg:quiet"); return; }
    const full = repoFromText(text);
    if (full) {
      await casualRepoReply(env, tg, ai, chatId, post.message_id, full);
      await log("sg:casual:repo", { mid: post.message_id, full });
    } else if (text.trim().length >= 40) {
      await casualPostReply(env, tg, ai, chatId, post.message_id, text);
      await log("sg:casual:post", { mid: post.message_id });
    } else {
      await log("sg:casual:thin", { mid: post.message_id });
    }
  } catch (e: any) {
    console.error("lens-swallowed", String(e?.message ?? e));
  }
}

/** Arm one channel post, or leave it alone. Every outcome is written to the
 *  events table (kind `channelarm`), so a post that did not grow keys can be
 *  diagnosed from the data instead of a screenshot. */
export async function armChannelPost(post: any, env: Env, tg: Telegram, ai?: AiBrain): Promise<void> {
  const text = String(post?.text ?? post?.caption ?? "");
  if (!text) return;
  const log = (name: string, meta?: any) =>
    new Store(env).event(Number(post?.chat?.id ?? 0) || null, "channelarm", name, meta).catch(() => null);
  // already carries a keyboard (the hub's own publishes, other bots) — not ours to touch
  if (post?.reply_markup?.inline_keyboard?.length) { await log("skip:markup", { mid: post.message_id }); return; }
  // the hub's own publish, keyboard not visible in the update — still not ours to touch
  if (String(post?.from?.username ?? "").toLowerCase() === botUsername(env).toLowerCase()) {
    await log("skip:self", { mid: post.message_id });
    return;
  }

  const chatId = post.chat.id;
  const mid = post.message_id;
  const full = repoFromText(text);

  /* the glass keys — repo posts only */
  if (full) await armKeys(post, env, tg, full, log);

  /* the storyteller — every post: the repo when the post points at one,
   * the post's own content otherwise. A #بدونتحلیل tag opts a post out,
   * and a channel wired with the switch off stays quiet (keys stay). */
  if (!ai) return;
  const reg = await env.DB.prepare(`SELECT auto FROM channels WHERE chat_id=?`).bind(chatId).first().catch(() => null);
  if (reg && !Number((reg as any).auto)) { await log("casual:off", { mid }); return; }
  if (/#بدونتحلیل|#noai/i.test(text)) { await log("casual:off-tag", { mid }); return; }
  if (full) {
    await casualRepoReply(env, tg, ai, chatId, mid, full);
    await log("casual:repo", { mid, full });
  } else if (text.trim().length >= 40) {
    await casualPostReply(env, tg, ai, chatId, mid, text);
    await log("casual:post", { mid });
  } else {
    await log("casual:thin", { mid });
  }
}

/** The keys part: markup-only edit first — the post stays EXACTLY as its
 *  author made it (a rich document stays rich, media keeps its caption) —
 *  then caption/text rewrites for post types the markup edit refuses, then
 *  an action bar under the post when nothing can be edited at all. */
async function armKeys(post: any, env: Env, tg: Telegram, full: string, log: (name: string, meta?: any) => Promise<unknown>): Promise<void> {
  const chatId = post.chat.id;
  const mid = post.message_id;
  const kb = channelRepoKb(full, botUsername(env)) as any;

  const mk: any = await tg.call("editMessageReplyMarkup", {
    chat_id: chatId, message_id: mid, reply_markup: kb,
  });
  if (mk?.ok) { await log("edit:ok", { mid, full, way: "markup" }); return; }
  if (/not modified/i.test(String(mk?.description ?? ""))) { await log("edit:same", { mid, full }); return; }

  /* Fallback for post types the markup edit refuses: rewrite text/caption
     verbatim with the keys. Rich documents that land here lose their document
     shape — which is why the markup path above comes first. */
  const media = !!(post.photo || post.video || post.document || post.animation || post.audio);
  const res: any = media
    ? await tg.call("editMessageCaption", {
        chat_id: chatId, message_id: mid,
        caption: post.caption ?? "",
        ...(post.caption_entities ? { caption_entities: post.caption_entities } : {}),
        reply_markup: kb,
      })
    : await tg.call("editMessageText", {
        chat_id: chatId, message_id: mid,
        text: post.text ?? "",
        ...(post.entities ? { entities: post.entities } : {}),
        reply_markup: kb,
      });

  if (res?.ok) { await log("edit:ok", { mid, full, way: media ? "caption" : "text" }); return; }
  if (/not modified/i.test(String(res?.description ?? ""))) { await log("edit:same", { mid, full }); return; }

  /* No edit rights (or a post type that cannot be edited) — the keys still
     deserve to exist: a small action bar under the post. */
  const bar = await tg.sendMessage(chatId, `🔭 <b>${full}</b>`, { parse_mode: "HTML", reply_markup: kb } as any).catch((e: any) => ({ ok: false, description: String(e?.message ?? e) }));
  await log((bar as any)?.ok ? "bar:ok" : "bar:fail", {
    mid, full,
    edit_error: String(res?.description ?? "").slice(0, 120),
    bar_error: String((bar as any)?.description ?? "").slice(0, 120),
  });
}
