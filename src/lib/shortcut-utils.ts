const CODE_TO_KEY: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

function mapCodeToTauriKey(code: string): string | null {
  // A-Z
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }

  // 0-9
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }

  // F1-F24
  if (/^F\d{1,2}$/.test(code)) {
    return code;
  }

  return CODE_TO_KEY[code] ?? null;
}

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

export function keyEventToShortcut(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) {
    return null;
  }

  const key = mapCodeToTauriKey(e.code);
  if (!key) {
    return null;
  }

  const parts: string[] = [];

  if (e.metaKey || e.ctrlKey) {
    parts.push("CmdOrCtrl");
  }
  if (e.shiftKey) {
    parts.push("Shift");
  }
  if (e.altKey) {
    parts.push("Alt");
  }

  parts.push(key);
  return parts.join("+");
}
