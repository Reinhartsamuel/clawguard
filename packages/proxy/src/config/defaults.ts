export const defaults = {
  port: 4100,
  logLevel: "info",
} as const;

export const providerMap: ReadonlyArray<{ prefix: string; baseUrl: string }> = [
  { prefix: "sk-ant-", baseUrl: "https://api.anthropic.com" },
  { prefix: "sk-", baseUrl: "https://api.openai.com" },
  { prefix: "AI", baseUrl: "https://generativelanguage.googleapis.com" },
];
