import type { AlertEvent } from "./types.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

function fmt(n: number): string {
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

function formatMessage(event: AlertEvent): string {
  const ts = new Date(event.timestamp).toISOString();

  if (event.reason === "budget_exceeded") {
    return (
      `🚨 *ClawGuard: Budget Cap Exceeded*\n\n` +
      `Key: \`${event.keyHash}\`\n` +
      `Window: ${event.windowType}\n` +
      `Spend: $${event.currentSpend.toFixed(4)}\n` +
      `Cap: $${fmt(event.cap)}\n` +
      `Request: \`${event.requestId}\`\n` +
      `Time: ${ts}\n\n` +
      `_All requests from this key are now blocked until the window resets._`
    );
  }

  if (event.reason === "budget_warning") {
    return (
      `⚠️ *ClawGuard: Budget Warning*\n\n` +
      `Key: \`${event.keyHash}\`\n` +
      `Window: ${event.windowType}\n` +
      `Spend: $${event.currentSpend.toFixed(4)} / $${fmt(event.cap)} (${event.percentUsed.toFixed(0)}%)\n` +
      `Time: ${ts}`
    );
  }

  if (event.reason === "anomaly_spike") {
    const icon = event.verdict === "DENY" ? "🚨" : event.verdict === "PAUSE" ? "⏸️" : "⚠️";
    return (
      `${icon} *ClawGuard: Spend Anomaly Detected*\n\n` +
      `Key: \`${event.keyHash}\`\n` +
      `Current: $${fmt(event.currentValue)}/hr\n` +
      `Baseline: $${fmt(event.emaValue)}/hr  ±$${fmt(event.stdDev)}\n` +
      `Z-score: ${event.zScore.toFixed(1)}σ\n` +
      `Action: ${event.verdict}\n` +
      `Time: ${ts}\n\n` +
      `_${event.message}_`
    );
  }

  if (event.reason === "pause_gate_opened") {
    const minutes = Math.round(event.timeoutSeconds / 60);
    return (
      `⏸️ *ClawGuard: Request Paused — Your Approval Needed*\n\n` +
      `Key: \`${event.keyHash}\`\n` +
      `Z-score: ${event.zScore.toFixed(1)}σ above baseline\n` +
      `Time: ${ts}\n\n` +
      `_Tap below to approve or deny\\. Auto-denies in ${minutes} min if no response\\._`
    );
  }

  if (event.reason === "pause_gate_resolved") {
    const icon = event.decision === "approved" ? "✅" : "❌";
    const label = event.decision === "approved" ? "Approved" : event.decision === "denied" ? "Denied" : "Timed out";
    return (
      `${icon} *ClawGuard: Paused Request ${label}*\n\n` +
      `Key: \`${event.keyHash}\`\n` +
      `Decision: ${label}\n` +
      `Time: ${ts}`
    );
  }

  // loop_detected
  const triggerLabel: Record<string, string> = {
    duplicate: "Duplicate content loop",
    heartbeat: "Heartbeat storm",
    cost_spiral: "Cost spiral",
  };
  return (
    `🚨 *ClawGuard: Loop Detected*\n\n` +
    `Key: \`${event.keyHash}\`\n` +
    `Trigger: ${triggerLabel[event.trigger] ?? event.trigger}\n` +
    `Detail: ${event.message}\n` +
    `Time: ${ts}\n\n` +
    `_Requests from this key have been blocked._`
  );
}

export async function sendTelegramAlert(
  config: TelegramConfig,
  event: AlertEvent,
): Promise<void> {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const body = JSON.stringify({
    chat_id: config.chatId,
    text: formatMessage(event),
    parse_mode: "Markdown",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${text}`);
  }
}

/**
 * Sends a pause-gate message with Approve / Deny inline keyboard buttons.
 * Returns the Telegram message_id so it can be edited after resolution.
 */
export async function sendPauseAlert(
  config: TelegramConfig,
  keyHash: string,
  zScore: number,
  timeoutSeconds: number,
): Promise<number> {
  const minutes = Math.round(timeoutSeconds / 60);
  const text =
    `⏸️ *ClawGuard: Request Paused — Your Approval Needed*\n\n` +
    `Key: \`${keyHash}\`\n` +
    `Z-score: ${zScore.toFixed(1)}σ above baseline\n\n` +
    `_Tap below to approve or deny\\. Auto-denies in ${minutes} min if no response\\._`;

  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const body = JSON.stringify({
    chat_id: config.chatId,
    text,
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Approve", callback_data: `approve:${keyHash}` },
        { text: "❌ Deny",    callback_data: `deny:${keyHash}` },
      ]],
    },
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${text}`);
  }

  const json = await res.json() as { ok: boolean; result: { message_id: number } };
  return json.result.message_id;
}

/**
 * Answers a Telegram callback_query to remove the loading spinner on the button.
 * Must be called after resolving a gate — Telegram requires it within 10 seconds.
 */
export async function answerCallbackQuery(
  config: TelegramConfig,
  callbackQueryId: string,
  text: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${config.botToken}/answerCallbackQuery`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
  });
}

/**
 * Registers a webhook URL with Telegram so it receives callback_query updates.
 * Called once on proxy startup when CLAWGUARD_TELEGRAM_WEBHOOK_URL is set.
 */
export async function registerWebhook(
  config: TelegramConfig,
  webhookUrl: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${config.botToken}/setWebhook`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram setWebhook error ${res.status}: ${text}`);
  }
}
