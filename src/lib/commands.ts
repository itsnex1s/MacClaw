export type PanelCommand =
  | { kind: "connect" }
  | { kind: "settings" }
  | { kind: "status" }
  | { kind: "prompt"; text: string };

export type CommandDefinition = {
  name: string;
  description: string;
};

export const AVAILABLE_COMMANDS: CommandDefinition[] = [
  { name: "/connect", description: "Configure gateway connection" },
  { name: "/settings", description: "Configure global hotkeys" },
  { name: "/status", description: "Show connection status" },
];

export function safeTrim(value: string): string {
  return value.trim();
}

export function matchingCommands(input: string): CommandDefinition[] {
  const text = safeTrim(input).toLowerCase();
  if (!text.startsWith("/")) {
    return [];
  }
  return AVAILABLE_COMMANDS.filter((c) => c.name.startsWith(text));
}

export function parsePanelCommand(input: string): PanelCommand | null {
  const text = safeTrim(input);
  if (!text) {
    return null;
  }

  if (text === "/connect") {
    return { kind: "connect" };
  }

  if (text === "/settings") {
    return { kind: "settings" };
  }

  if (text === "/status") {
    return { kind: "status" };
  }

  return { kind: "prompt", text };
}
