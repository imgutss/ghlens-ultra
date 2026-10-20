import type { H } from "../core/handler";
import { kb } from "../tg/keyboards";
import { tgEscape } from "../tg/types";
import { setMode, clearMode } from "../core/mode";

/**
 * MY CHANNEL — the storyteller's front door.
 *
 * The analysis under channel posts works ONLY as a comment in the channel's
 * linked discussion group — a bot reply inside the channel itself is just
 * another channel post, which the owner forbade. So wiring a channel means
 * three real checks, each read from the Telegram API, never assumed:
 *
 *   1. the bot is an administrator of the channel (post rights);
 *   2. the channel has a linked discussion group (comments enabled);
 *   3. the bot is an administrator of that group (so it receives the
 *      auto-forward of every post and its reply lands as a comment).
 *
 * A supergroup wired as a channel skips 2 and 3 — its posts are ordinary
 * messages and a reply under them already looks right.
 *
 * Every missing piece is named with its exact fix, and a re-check button
 * re-runs the checks when the owner has done their part in Telegram.
 */
export class MyChannels {
  /** Section home: the user's wired channels, and the door to a new one. */
  async home(h: H) {
    const fa = h.loc === "fa";
    await clearMode(h.session).catch(() => null);
    const rows = await h.env.DB.prepare(
      `SELECT chat_id, title, username, auto, kind FROM channels WHERE owner_id=? ORDER BY connected_at DESC LIMIT 20`,
    ).bind(h.u.id).all().catch(() => null);
    const list = (rows?.results ?? []) as any[];

    const head = fa
      ? `📡 <b>کانال من</b>\n\nچنل یا ابرگروهَ خودت را وصل کن تا ربات زیر هر پستش یک تحلیل کوتاه و حرفه‌ای بگذارد — پستِ ریپو از دیتای زندهٔ گیت‌هاب، هر پست دیگری از خودِ متنش. تحلیل فقط به‌صورت کامنتِ زیر پست می‌نشیند، نه پست جدا.`
      : `📡 <b>My channel</b>\n\nWire your channel and every post grows a short professional analysis — repo posts from live GitHub data, anything else from the post's own words. The analysis rides as a comment under the post, never as a separate post.`;

    if (!list.length) {
      return h.reply(
        head + "\n\n" + (fa
          ? `هنوز چنلی وصل نکرده‌ای. ربات باید <b>ادمین چنل</b> باشد و <b>کامنت‌های چنل روشن</b> — بقیه‌اش با من.`
          : `No channel wired yet. The bot must be an <b>admin of the channel</b> and the channel's <b>comments must be on</b> — the rest is on me.`),
        kb(
          [{ text: (fa ? "اتصال چنل" : "Wire a channel") + " ➕", cb: "ch:add" }],
          [{ text: (fa ? "بازگشت" : "Back") + " ◀️", cb: "m:home" }],
        ),
        !!h.cbId,
      );
    }

    const rows2 = list.map((c) => [{
      text: `${c.auto ? "🟢" : "⚪️"} ${String(c.title ?? c.username ?? c.chat_id).slice(0, 28)}`,
      cb: `ch:view:${c.chat_id}`,
    }]);
    return h.reply(
      head + `\n\n<i>${fa ? "چنل‌های وصل‌شدهٔ تو — 🟢 تحلیل روشن، ⚪️ خاموش" : "Your wired channels — 🟢 analysis on, ⚪️ off"}</i>`,
      kb(
        ...rows2,
        [{ text: (fa ? "اتصال چنل جدید" : "Wire another channel") + " ➕", cb: "ch:add" }],
        [{ text: (fa ? "بازگشت" : "Back") + " ◀️", cb: "m:home" }],
      ),
      !!h.cbId,
    );
  }

  /** The wiring instructions; the next message the user sends is the channel. */
  async add(h: H) {
    const fa = h.loc === "fa";
    await setMode(h.session, "ch_link", {});
    return h.reply(
      (fa
        ? `➕ <b>اتصال چنل</b>\n\n۱. در تلگرام: چنل → <i>Manage Channel</i> → <i>Administrators</i> → ربات را ادمین کن (حق <i>Post Messages</i>)\n۲. <i>Manage Channel</i> → <i>Discussion</i> → یک گروه بحث لینک کن (کامنت‌ها روشن شود) و ربات را <b>ادمین همان گروه هم بکن</b>\n۳. حالا یکی از این دو را بفرست:\n`
        : `➕ <b>Wire a channel</b>\n\n1. In Telegram: channel → <i>Manage Channel</i> → <i>Administrators</i> → make the bot an admin (<i>Post Messages</i>)\n2. <i>Manage Channel</i> → <i>Discussion</i> → link a discussion group (comments on) and make the bot an <b>admin of that group too</b>\n3. Now send me one of these:\n`) +
      (fa
        ? `   • یوزرنیم چنل، مثل <code>@mychannel</code>\n   • یا یک پست از چنل را فوروارد کن\n\nادمین‌بودنم و روشن‌بودن کامنت‌ها را خودم از API تلگرام چک می‌کنم — حدس نمی‌زنم.\n\n⚠️ بدون گروهِ بحث، تحلیلی وجود ندارد: کامنتِ زیر پست تنها شکلی است که ربات حق دارد بگذارد.`
        : `   • the channel's username, like <code>@mychannel</code>\n   • or forward a post from the channel\n\nI verify my admin status and the comments through the Telegram API myself — no guessing.\n\n⚠️ Without a discussion group there is no analysis: a comment under the post is the only form the bot is allowed to post.`),
      kb([{ text: (fa ? "بی‌خیال" : "Never mind") + " ❌", cb: "ch:home" }]),
      !!h.cbId,
    );
  }

  /** Mode handler: the message is a @username, a t.me link, or a forwarded
   *  channel post. Verify every precondition for real, then register. */
  async receiveLink(h: H, t: string) {
    const fa = h.loc === "fa";
    const fail = (why: string, hint = "") =>
      h.reply(
        `❌ ${why}` + (hint ? `\n\n${hint}` : ""),
        kb([{ text: (fa ? "تلاش دوباره" : "Try again") + " 🔁", cb: "ch:add" }, { text: (fa ? "بی‌خیال" : "Never mind") + " ❌", cb: "ch:home" }]),
        true,
      );

    /* a forwarded channel post carries the chat itself */
    const fwd = (h.msg as any)?.forward_from_chat;
    let chatId: number | string | null = fwd?.id ?? null;
    let title = fwd?.title ?? null, username = fwd?.username ?? null, type = fwd?.type ?? "channel";

    if (!chatId) {
      const m = String(t ?? "").trim().match(/^(?:@|https?:\/\/t\.me\/)([A-Za-z0-9_]{4,32})\/?$/) ?? String(t ?? "").trim().match(/^t\.me\/([A-Za-z0-9_]{4,32})$/);
      if (!m) {
        return fail(
          fa ? "این را نفهمیدم — یوزرنیم چنل (مثل <code>@mychannel</code>) بفرست یا یک پست از چنل را فوروارد کن." : "Didn't catch that — send the channel's username (like <code>@mychannel</code>) or forward a post from it.",
        );
      }
      const g: any = await h.tg.call("getChat", { chat_id: `@${m[1]}` }).catch(() => null);
      if (!g?.ok) return fail(fa ? "چنلی با این نام پیدا نشد." : "No channel found with that name.");
      chatId = g.result.id; title = g.result.title; username = g.result.username; type = g.result.type;
    }

    if (type !== "channel" && type !== "supergroup") {
      return fail(
        fa ? "اینکه فرستادی چنل یا ابرگروه نیست — گروه‌های معمولی و چت خصوصی سرویس تحلیل زیر پست را نمی‌گیرند." : "That is neither a channel nor a supergroup — plain groups and private chats do not get the post analysis.",
      );
    }

    /* the one check that matters: is the bot really an admin there? */
    const me: any = await h.tg.call("getMe").catch(() => null);
    const botId = me?.result?.id;
    if (!botId) return fail(fa ? "الان نمی‌توانم هویت خودم را بپرسم — یک لحظهٔ دیگر دوباره بفرست." : "Could not ask Telegram for my own identity — try again in a moment.");
    const member: any = await h.tg.call("getChatMember", { chat_id: chatId, user_id: botId }).catch(() => null);
    const status = String(member?.result?.status ?? "");
    if (member?.ok !== true || (status !== "administrator" && status !== "creator")) {
      return fail(
        fa ? `من هنوز ادمین این چنل نیستم.` : `I am not an admin of that channel yet.`,
        fa ? `اول ربات را ادمین چنل کن (<i>Manage Channel → Administrators → Add Admin</i>، حق <i>Post Messages</i> کافی است)، بعد دوباره بفرست.` : `First make the bot an admin of the channel (<i>Manage Channel → Administrators → Add Admin</i>, <i>Post Messages</i> is enough), then send it again.`,
      );
    }

    /* for a channel, the comment machinery must exist: a linked discussion
     * group the bot administrates — otherwise there is nowhere legal for
     * the analysis to live. Wire it anyway, name what is missing. */
    let linkedChat: number | null = null;
    if (type === "channel") {
      const gc: any = await h.tg.call("getChat", { chat_id: chatId }).catch(() => null);
      linkedChat = Number(gc?.result?.linked_chat_id ?? 0) || null;
      if (!linkedChat) {
        return fail(
          fa ? "کامنت‌های این چنل بسته است." : "This channel's comments are off.",
          fa ? "تحلیل فقط به‌صورت کامنتِ زیر پست می‌نشیند، و کامنت یعنی گروهِ بحثِ لینک‌شده.\n\n۱. چنل → <i>Manage Channel</i> → <i>Discussion</i> → یک گروه لینک کن\n۲. ربات را ادمین همان گروه بکن\n۳. دوباره یوزرنیم چنل را بفرست" : "The analysis only ever lands as a comment, and comments mean a linked discussion group.\n\n1. Channel → <i>Manage Channel</i> → <i>Discussion</i> → link a group\n2. Make the bot an admin of that group\n3. Send the channel's username again",
        );
      }
      const gm: any = await h.tg.call("getChatMember", { chat_id: linkedChat, user_id: botId }).catch(() => null);
      const gs = String(gm?.result?.status ?? "");
      if (gm?.ok !== true || (gs !== "administrator" && gs !== "creator")) {
        return fail(
          fa ? "ربات هنوز ادمینِ گروه بحث چنل نیست." : "The bot is not an admin of the channel's discussion group yet.",
          fa ? `در تلگرام وارد گروهِ بحث چنل شو → <i>Add Admin</i> → ربات را ادمین کن، بعد دوباره یوزرنیم چنل را بفرست.\n\n<i>بدون این قدم، پست‌های چنل به ربات نمی‌رسند.</i>` : `Open the channel's discussion group → <i>Add Admin</i> → make the bot an admin, then send the channel's username again.\n\n<i>Without this step the channel's posts never reach the bot.</i>`,
        );
      }
    }

    await h.env.DB.prepare(
      `INSERT INTO channels (chat_id, owner_id, title, username, auto, kind, linked_chat, connected_at) VALUES (?,?,?,?,1,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET owner_id=excluded.owner_id, title=excluded.title, username=excluded.username, kind=excluded.kind, linked_chat=excluded.linked_chat`,
    ).bind(chatId, h.u.id, title ?? null, username ?? null, type, linkedChat, Date.now()).run().catch(() => null);
    await clearMode(h.session).catch(() => null);
    await h.store.event(h.u.id, "channelwire", String(chatId)).catch(() => null);
    return this.view(h, Number(chatId), true);
  }

  /** Live state of the comment machinery for one wired channel. */
  private async health(h: H, chatId: number, kind: string): Promise<{ ok: boolean; line: string; fix: string; recheck: boolean }> {
    const fa = h.loc === "fa";
    if (kind === "supergroup") {
      return { ok: true, line: fa ? "✅ ابرگروه — تحلیل زیر پیام‌ها فعال است" : "✅ Supergroup — analysis under messages is live", fix: "", recheck: false };
    }
    const me: any = await h.tg.call("getMe").catch(() => null);
    const botId = me?.result?.id;
    const gc: any = await h.tg.call("getChat", { chat_id: chatId }).catch(() => null);
    const linked = Number(gc?.result?.linked_chat_id ?? 0) || null;
    if (!linked) {
      return {
        ok: false,
        line: fa ? "⚠️ کامنت‌های چنل بسته است — تحلیل غیرفعال" : "⚠️ Channel comments are off — analysis paused",
        fix: fa ? "چنل → <i>Manage Channel</i> → <i>Discussion</i> → یک گروه لینک کن؛ بعد اینجا «بررسی دوباره» را بزن" : "Channel → <i>Manage Channel</i> → <i>Discussion</i> → link a group, then press re-check here",
        recheck: true,
      };
    }
    const gm: any = botId ? await h.tg.call("getChatMember", { chat_id: linked, user_id: botId }).catch(() => null) : null;
    const gs = String(gm?.result?.status ?? "");
    if (gm?.ok !== true || (gs !== "administrator" && gs !== "creator")) {
      return {
        ok: false,
        line: fa ? "⚠️ ربات ادمینِ گروهِ بحث نیست — تحلیل غیرفعال" : "⚠️ The bot is not an admin of the discussion group — analysis paused",
        fix: fa ? "گروهِ بحث چنل → <i>Add Admin</i> → ربات را ادمین کن؛ بعد اینجا «بررسی دوباره» را بزن" : "Discussion group → <i>Add Admin</i> → make the bot an admin, then press re-check here",
        recheck: true,
      };
    }
    /* remember what we learned */
    await h.env.DB.prepare(`UPDATE channels SET linked_chat=? WHERE chat_id=?`).bind(linked, chatId).run().catch(() => null);
    return { ok: true, line: fa ? "✅ کامنت‌ها روشن و ربات در گروه بحث — تحلیل فعال" : "✅ Comments on, bot in the group — analysis live", fix: "", recheck: false };
  }

  /** One wired channel: its state, its story count, the switches. */
  async view(h: H, chatId: number, fresh = false) {
    const fa = h.loc === "fa";
    const row = await h.env.DB.prepare(
      `SELECT chat_id, title, username, auto, kind, connected_at FROM channels WHERE chat_id=? AND owner_id=?`,
    ).bind(chatId, h.u.id).first().catch(() => null);
    if (!row) return this.home(h);
    const stat = await h.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM events WHERE kind='channelarm' AND name LIKE '%casual%' AND user_id=?`,
    ).bind(chatId).first().catch(() => null);
    const n = Number((stat as any)?.n ?? 0);
    const name = tgEscape(String((row as any).title ?? (row as any).username ?? chatId));
    const link = (row as any).username ? ` — @${tgEscape(String((row as any).username))}` : "";
    const health = await this.health(h, chatId, String((row as any).kind ?? "channel"));
    return h.reply(
      (fresh ? (fa ? "✅ <b>متصل شد!</b>\n\n" : "✅ <b>Wired!</b>\n\n") : "") +
      `📡 <b>${name}</b>${link}\n\n` +
      `${health.line}\n` +
      (fa ? `🤖 تحلیل خودکار: <b>${(row as any).auto ? "روشن" : "خاموش"}</b>\n📝 پست‌های تحلیل‌شده: <b>${n}</b>` : `🤖 Analysis: <b>${(row as any).auto ? "on" : "off"}</b>\n📝 posts analysed: <b>${n}</b>`) +
      (health.fix ? `\n\n${health.fix}` : ""),
      kb(
        ...(health.recheck ? [[{ text: (fa ? "بررسی دوباره" : "Re-check") + " 🔄", cb: `ch:check:${chatId}` }]] : []),
        [{ text: ((row as any).auto ? (fa ? "خاموش کردن تحلیل" : "Turn analysis off") + " ⏸" : (fa ? "روشن کردن تحلیل" : "Turn analysis on") + " ▶️"), cb: `ch:toggle:${chatId}` }],
        [{ text: (fa ? "قطع اتصال" : "Unwire") + " 🔌", cb: `ch:off:${chatId}` }],
        [{ text: (fa ? "بازگشت" : "Back") + " ◀️", cb: "ch:home" }],
      ),
      !!h.cbId,
    );
  }

  /** Re-run the comment-machinery checks after the owner did their part. */
  async check(h: H, chatId: number) {
    const fa = h.loc === "fa";
    const row = await h.env.DB.prepare(`SELECT kind FROM channels WHERE chat_id=? AND owner_id=?`).bind(chatId, h.u.id).first().catch(() => null);
    if (!row) return this.home(h);
    const health = await this.health(h, chatId, String((row as any).kind ?? "channel"));
    await h.toast(health.ok ? (fa ? "همه‌چیز آماده ✅" : "All ready ✅") : (fa ? "هنوز کامل نیست" : "Not complete yet"));
    return this.view(h, chatId);
  }

  /** Flip the storyteller for one channel. */
  async toggle(h: H, chatId: number) {
    const fa = h.loc === "fa";
    await h.env.DB.prepare(`UPDATE channels SET auto = 1 - auto WHERE chat_id=? AND owner_id=?`)
      .bind(chatId, h.u.id).run().catch(() => null);
    await h.toast(fa ? "تغییر کرد" : "Done");
    return this.view(h, chatId);
  }

  /** Unwire: the row goes, and the channel is back to untouched. */
  async disconnect(h: H, chatId: number) {
    const fa = h.loc === "fa";
    await h.env.DB.prepare(`DELETE FROM channels WHERE chat_id=? AND owner_id=?`)
      .bind(chatId, h.u.id).run().catch(() => null);
    await h.store.event(h.u.id, "channelunwire", String(chatId)).catch(() => null);
    return h.reply(
      fa
        ? `🔌 اتصال <b>قطع شد</b> — این چنل دیگر تحلیل نمی‌شود و هیچ پیامی در آن نمی‌گذارد.`
        : `🔌 <b>Unwired</b> — this channel is no longer analysed and nothing is ever posted to it.`,
      kb([{ text: (fa ? "کانال‌های من" : "My channels") + " 📡", cb: "ch:home" }]),
      true,
    );
  }
}
