import type { AlertEvent } from "./types.js";
import { sendTelegramAlert, type TelegramConfig } from "./telegram.js";

export interface AlertsConfig {
  telegram?: TelegramConfig;
}

/**
 * Dispatch an alert event to all configured channels.
 * Errors in individual channels are caught and logged — never thrown.
 */
export async function dispatchAlert(
  config: AlertsConfig,
  event: AlertEvent,
  log: { error: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void },
): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (config.telegram) {
    tasks.push(
      sendTelegramAlert(config.telegram, event).catch((err: unknown) => {
        log.error(
          { err: err instanceof Error ? err.message : String(err), channel: "telegram", reason: event.reason },
          "alert dispatch failed",
        );
      }),
    );
  }

  await Promise.all(tasks);
}
