export const PANEL_SIZE = {
  compact: { width: 750, height: 56 },
  hints: { width: 750, height: 160 },
  connect: { width: 750, height: 200 },
  settings: { width: 750, height: 280 },
} as const;

export type PanelMode = keyof typeof PANEL_SIZE | "response";

export const PANEL_WIDTH = 750;
export const PANEL_INPUT_HEIGHT = 56;
export const PANEL_RESPONSE_CHROME = 26; // margins + border
export const PANEL_MAX_HEIGHT = 420;
