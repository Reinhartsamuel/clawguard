export interface BudgetConfig {
  hourly: number | null;
  daily: number | null;
  monthly: number | null;
}

export interface TelegramAlertConfig {
  botToken: string;
  chatId: string;
}

export interface AlertsConfig {
  telegram?: TelegramAlertConfig;
  /** Warn when spend reaches this fraction of the cap (0–1). Default: 0.8 */
  warnThreshold: number;
  /**
   * Public HTTPS URL Telegram will POST callback_query updates to.
   * Required for HITL pause gate. Set to your server's public URL + /telegram-webhook.
   * In local dev, use ngrok or cloudflared to expose localhost.
   * Example: https://my-server.example.com/telegram-webhook
   */
  telegramWebhookUrl?: string;
  /** How long to hold a paused request before auto-denying. Default: 900 (15 min) */
  pauseTimeoutSeconds: number;
}

export interface AnomalyConfig {
  /** Minimum baseline samples before detection activates. Default: 10 */
  minSamples: number;
  /** Alert (WARN) at this many σ above baseline. Default: 3 */
  warnMultiplier: number;
  /** Pause/queue at this many σ above baseline. Default: 5 */
  pauseMultiplier: number;
  /** Hard deny at this many σ above baseline. Default: 10 */
  killMultiplier: number;
  /** EMA window in days — longer = slower to adapt. Default: 14 */
  baselineWindowDays: number;
}

export interface LoopConfig {
  enabled: boolean;
  duplicateThreshold: number;
  duplicateWindowSeconds: number;
  costSpiralAmount: number;
  costSpiralWindowSeconds: number;
  heartbeatThreshold: number;
  heartbeatWindowSeconds: number;
}

export interface ClawGuardConfig {
  budget: BudgetConfig;
  alerts: AlertsConfig;
  anomaly: AnomalyConfig;
  loop: LoopConfig;
}

/**
 * Load config from environment variables.
 *
 * Budget:   CLAWGUARD_BUDGET_HOURLY, CLAWGUARD_BUDGET_DAILY, CLAWGUARD_BUDGET_MONTHLY (USD)
 * Telegram: CLAWGUARD_TELEGRAM_BOT_TOKEN, CLAWGUARD_TELEGRAM_CHAT_ID
 * Warn:     CLAWGUARD_WARN_THRESHOLD (0–1, default 0.8)
 * Anomaly:  CLAWGUARD_ANOMALY_WARN_MULT, CLAWGUARD_ANOMALY_PAUSE_MULT,
 *           CLAWGUARD_ANOMALY_KILL_MULT, CLAWGUARD_ANOMALY_MIN_SAMPLES,
 *           CLAWGUARD_ANOMALY_BASELINE_DAYS
 * Loop:     CLAWGUARD_LOOP_ENABLED, CLAWGUARD_LOOP_DUP_THRESHOLD,
 *           CLAWGUARD_LOOP_DUP_WINDOW, CLAWGUARD_LOOP_SPIRAL_AMOUNT,
 *           CLAWGUARD_LOOP_SPIRAL_WINDOW, CLAWGUARD_LOOP_HB_THRESHOLD,
 *           CLAWGUARD_LOOP_HB_WINDOW
 */
export function loadConfig(): ClawGuardConfig {
  const botToken = process.env["CLAWGUARD_TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["CLAWGUARD_TELEGRAM_CHAT_ID"];
  const telegram =
    botToken && chatId ? { botToken, chatId } : undefined;

  const warnThreshold = parseFloat(
    process.env["CLAWGUARD_WARN_THRESHOLD"] ?? "0.8",
  );

  return {
    budget: {
      hourly: parseEnvDollar("CLAWGUARD_BUDGET_HOURLY"),
      daily: parseEnvDollar("CLAWGUARD_BUDGET_DAILY"),
      monthly: parseEnvDollar("CLAWGUARD_BUDGET_MONTHLY"),
    },
    alerts: {
      telegram,
      warnThreshold: isNaN(warnThreshold) ? 0.8 : Math.min(1, Math.max(0, warnThreshold)),
      telegramWebhookUrl: process.env["CLAWGUARD_TELEGRAM_WEBHOOK_URL"] || undefined,
      pauseTimeoutSeconds: parseEnvInt("CLAWGUARD_PAUSE_TIMEOUT_SECONDS", 900),
    },
    anomaly: {
      minSamples: parseEnvInt("CLAWGUARD_ANOMALY_MIN_SAMPLES", 10),
      warnMultiplier: parseEnvFloat("CLAWGUARD_ANOMALY_WARN_MULT", 3),
      pauseMultiplier: parseEnvFloat("CLAWGUARD_ANOMALY_PAUSE_MULT", 5),
      killMultiplier: parseEnvFloat("CLAWGUARD_ANOMALY_KILL_MULT", 10),
      baselineWindowDays: parseEnvInt("CLAWGUARD_ANOMALY_BASELINE_DAYS", 14),
    },
    loop: {
      enabled: process.env["CLAWGUARD_LOOP_ENABLED"] !== "false",
      duplicateThreshold: parseEnvInt("CLAWGUARD_LOOP_DUP_THRESHOLD", 5),
      duplicateWindowSeconds: parseEnvInt("CLAWGUARD_LOOP_DUP_WINDOW", 300),
      costSpiralAmount: parseEnvFloat("CLAWGUARD_LOOP_SPIRAL_AMOUNT", 2),
      costSpiralWindowSeconds: parseEnvInt("CLAWGUARD_LOOP_SPIRAL_WINDOW", 300),
      heartbeatThreshold: parseEnvInt("CLAWGUARD_LOOP_HB_THRESHOLD", 30),
      heartbeatWindowSeconds: parseEnvInt("CLAWGUARD_LOOP_HB_WINDOW", 60),
    },
  };
}

function parseEnvDollar(key: string): number | null {
  const val = process.env[key];
  if (!val) return null;
  const num = parseFloat(val);
  if (isNaN(num) || num <= 0) return null;
  return num;
}

function parseEnvFloat(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (!val) return defaultVal;
  const num = parseFloat(val);
  return isNaN(num) ? defaultVal : num;
}

function parseEnvInt(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (!val) return defaultVal;
  const num = parseInt(val, 10);
  return isNaN(num) ? defaultVal : num;
}
