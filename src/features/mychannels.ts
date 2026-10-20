import type { H } from "../core/handler";
import { kb } from "../tg/keyboards";
import { tgEscape } from "../tg/types";
import { setMode, clearMode } from "../core/mode";

/**
 * MY CHANNEL — the storyteller's front door.
 *
 * The analysis under channel posts works by silent consent: make the bot an
 * admin and it begins. But "add an admin somewhere in Telegram's settings"
 * is a secret, not a feature — a channel owner who wants the storyteller has
 * to know it exists. This section is the door: any user can wire their
 * channel from inside the bot, see it registered, switch the storyteller on
 * and off per channel, read what it has been doing, and unplug it.
 *
 * Every check is real, never assumed: the channel must resolve through the
 * Telegram API, and the bot must actually be an administrator there before
 * anything is saved. A channel that is not registered here still gets the
 * storyteller (admin membership is consent enough) — registration adds
 * control, not permission.
 */
export class MyChannels {
  /** Section home: the user's wired channels, and the door to a new one. */
  async home(h: H) {
    const fa = h.loc === "fa";
    await clearMode(h.session).catch(() => null);
    const rows = await h.env.DB.prepare(
      `SELECT chat_id, title, username, auto FROM channels WHERE owner_id=? ORDER BY connected_at DESC LIMIT 20`,
    ).bind(h.u.id).all().catch(() => null);
    const list = (rows?.results ?? []) as any[];

    const head = fa
      ? `📡 <b>کانال من</b>\n\nچنل یا ابرگروهَ خودت را وصل کن تا ربات زیر هر پستش یک تحلیل کوتاه و حرفه‌ای بگذارد — پستِ ریپو از دیتای زندهٔ گیت‌هاب، هر پست دیگری از خودِ متنش. فقط چنل‌هایی که از همین‌جا وصل شوند تحلیل می‌شوند.`
      : `📡 <b>My channel</b>\n\nWire your channel and every post grows a casual analysis right under it — repo posts from live GitHub data, anything else from the post's own words.`;

    if (!list.length) {
      return h.reply(
        head + "\n\n" + (fa
          ? `هنوز چنلی وصل نکرده‌ای. ربات باید <b>ادمین</b> چنلت باشد (حق ارسال پیام کافی است) — بقیه‌اش با من.`
          : `No channel wired yet. The bot must be an <b>admin</b> of your channel (post rights are enough) — the rest is on me.`),
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
        ? `➕ <b>اتصال چنل</b>\n\n۱. در تلگرام وارد چنلت شو → <i>Manage Channel</i> → <i>Administrators</i> → <i>Add Admin</i>\n۲. ربات را اضافه کن — فقط حق <i>Post Messages</i> کافی است\n۳. حالا یکی از این دو را برایم بفرست:\n`
        : `➕ <b>Wire a channel</b>\n\n1. In Telegram: your channel → <i>Manage Channel</i> → <i>Administrators</i> → <i>Add Admin</i>\n2. Add the bot — <i>Post Messages</i> right is enough\n3. Now send me one of these:\n`) +
      (fa
        ? `   • یوزرنیم چنل، مثل <code>@mychannel</code>\n   • یا یک پست از چنل را فوروارد کن\n\nادمین‌بودنم را خودم از API تلگرام چک می‌کنم — حدس نمی‌زنم.`
        : `   • the channel's username, like <code>@mychannel</code>\n   • or forward a post from the channel\n\nI verify my admin status through the Telegram API myself — no guessing.`),
      kb([{ text: (fa ? "بی‌خیال" : "Never mind") + " ❌", cb: "ch:home" }]),
      !!h.cbId,
    );
  }

  /** Mode handler: the message is a @username, a t.me link, or a forwarded
   *  channel post. Verify for real, then register. */
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

    await h.env.DB.prepare(
      `INSERT INTO channels (chat_id, owner_id, title, username, auto, connected_at) VALUES (?,?,?,?,1,?) ON CONFLICT(chat_id) DO UPDATE SET owner_id=excluded.owner_id, title=excluded.title, username=excluded.username`,
    ).bind(chatId, h.u.id, title ?? null, username ?? null, Date.now()).run().catch(() => null);
    await clearMode(h.session).catch(() => null);
    await h.store.event(h.u.id, "channelwire", String(chatId)).catch(() => null);
    return this.view(h, Number(chatId), true);
  }

  /** One wired channel: its state, its story count, the switches. */
  async view(h: H, chatId: number, fresh = false) {
    const fa = h.loc === "fa";
    const row = await h.env.DB.prepare(
      `SELECT chat_id, title, username, auto, connected_at FROM channels WHERE chat_id=? AND owner_id=?`,
    ).bind(chatId, h.u.id).first().catch(() => null);
    if (!row) return this.home(h);
    const stat = await h.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM events WHERE kind='channelarm' AND name LIKE 'casual%' AND user_id=?`,
    ).bind(chatId).first().catch(() => null);
    const n = Number((stat as any)?.n ?? 0);
    const name = tgEscape(String((row as any).title ?? (row as any).username ?? chatId));
    const link = (row as any).username ? ` — @${tgEscape(String((row as any).username))}` : "";
    return h.reply(
      (fresh ? (fa ? "✅ <b>متصل شد!</b>\n\n" : "✅ <b>Wired!</b>\n\n") : "") +
      `📡 <b>${name}</b>${link}\n\n` +
      (fa
        ? `🤖 تحلیل خودکار پست‌ها: <b>${(row as any).auto ? "روشن" : "خاموش"}</b>\n📝 پست‌های تحلیل‌شده تا الان: <b>${n}</b>\n\nاز این به بعد زیر پست‌های این چنل، چند ثانیه بعد از انتشار، تحلیل خودمونی می‌نشیند.`
        : `🤖 Post analysis: <b>${(row as any).auto ? "on" : "off"}</b>\n📝 posts analysed so far: <b>${n}</b>\n\nFrom now on, a casual analysis lands a few seconds under every post in this channel.`),
      kb(
        [{ text: ((row as any).auto ? (fa ? "خاموش کردن تحلیل" : "Turn analysis off") + " ⏸" : (fa ? "روشن کردن تحلیل" : "Turn analysis on") + " ▶️"), cb: `ch:toggle:${chatId}` }],
        [{ text: (fa ? "قطع اتصال" : "Unwire") + " 🔌", cb: `ch:off:${chatId}` }],
        [{ text: (fa ? "بازگشت" : "Back") + " ◀️", cb: "ch:home" }],
      ),
      !!h.cbId,
    );
  }

  /** Flip the storyteller for one channel — the keys under repo posts stay. */
  async toggle(h: H, chatId: number) {
    const fa = h.loc === "fa";
    await h.env.DB.prepare(`UPDATE channels SET auto = 1 - auto WHERE chat_id=? AND owner_id=?`)
      .bind(chatId, h.u.id).run().catch(() => null);
    await h.toast(fa ? "تغییر کرد" : "Done");
    return this.view(h, chatId);
  }

  /** Unwire: the row goes, and the channel is back to silent consent —
   *  admin membership alone, no management, no switches. */
  async disconnect(h: H, chatId: number) {
    const fa = h.loc === "fa";
    await h.env.DB.prepare(`DELETE FROM channels WHERE chat_id=? AND owner_id=?`)
      .bind(chatId, h.u.id).run().catch(() => null);
    await h.store.event(h.u.id, "channelunwire", String(chatId)).catch(() => null);
    return h.reply(
      fa
        ? `🔌 اتصال <b>قطع شد</b> — این چنل دیگر در لیست تو نیست.\n\nاگر ربات همچنان ادمین چنل باشد، تحلیل زیر پست‌ها با همان رضایتِ ضمنی (ادمینی) ادامه می‌یابد؛ برای قطع کامل، ادمینی ربات را هم در تلگرام بردار.`
        : `🔌 <b>Unwired</b> — the channel is no longer in your list.\n\nIf the bot is still an admin there, the post analysis continues on that implicit consent; remove the bot's admin role in Telegram to stop it fully.`,
      kb([{ text: (fa ? "کانال‌های من" : "My channels") + " 📡", cb: "ch:home" }]),
      true,
    );
  }
}
