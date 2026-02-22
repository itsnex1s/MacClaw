import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { CommandHints } from "./components/CommandHints";
import { CommandInput } from "./components/CommandInput";
import { ConnectForm } from "./components/ConnectForm";
import { ResponsePanel } from "./components/ResponsePanel";
import { SettingsForm } from "./components/SettingsForm";
import type { PanelMode } from "./constants/panel";
import { useCommandInput } from "./hooks/useCommandInput";
import { useWsClient } from "./hooks/useWsClient";
import { usePanelLifecycle } from "./hooks/usePanelLifecycle";
import { usePanelResize } from "./hooks/usePanelResize";
import { parsePanelCommand, safeTrim } from "./lib/commands";
import { clearMediaCache } from "./lib/media-cache";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type AppSettings,
} from "./lib/settings";

export function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [activeQuery, setActiveQuery] = useState("");
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [connectUrl, setConnectUrl] = useState("");
  const [connectToken, setConnectToken] = useState("");

  const [showSettingsForm, setShowSettingsForm] = useState(false);
  const [settingsShortcuts, setSettingsShortcuts] = useState<
    [string, string, string]
  >(DEFAULT_SETTINGS.shortcuts);

  const [backgroundMode, setBackgroundMode] = useState(false);
  const backgroundModeRef = useRef(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const responsePanelRef = useRef<HTMLElement>(null);

  const {
    client,
    connectionState,
    assistantText,
    setAssistantText,
    streamingText,
    setStreamingText,
    isThinking,
    setIsThinking,
    isThinkingRef,
    streamingTextRef,
  } = useWsClient(backgroundModeRef);

  const {
    input,
    setInput,
    commandHints,
    showHints,
    hintIndex,
    setHintIndex,
    onInputKeyDown,
  } = useCommandInput(showConnectForm || showSettingsForm, activeQuery);

  // Keep ref in sync so closures see current backgroundMode.
  useEffect(() => {
    backgroundModeRef.current = backgroundMode;
  }, [backgroundMode]);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setSettings(loaded);
      setSettingsLoaded(true);
    });
  }, []);

  const clearConversation = useCallback(() => {
    setInput("");
    setActiveQuery("");
    setAssistantText("");
    setStreamingText("");
    streamingTextRef.current = "";
    setIsThinking(false);
    isThinkingRef.current = false;
    setShowConnectForm(false);
    setShowSettingsForm(false);
    setHintIndex(0);
    clearMediaCache();
  }, []);

  usePanelLifecycle({
    client,
    settings,
    settingsLoaded,
    backgroundModeRef,
    isThinkingRef,
    streamingTextRef,
    inputRef,
    clearConversation,
    setBackgroundMode,
  });

  // Which panel mode?
  const panelMode: PanelMode = showHints
    ? "hints"
    : showConnectForm
      ? "connect"
      : showSettingsForm
        ? "settings"
        : activeQuery.length > 0
          ? "response"
          : "compact";

  const renderedAnswer = safeTrim(streamingText) || safeTrim(assistantText);

  usePanelResize(panelMode, responsePanelRef, renderedAnswer, isThinking);

  const handleConnect = async (event: FormEvent) => {
    event.preventDefault();

    const gatewayUrl = safeTrim(connectUrl);
    if (!gatewayUrl) {
      return;
    }

    const nextSettings: AppSettings = {
      ...settings,
      gatewayUrl,
      token: safeTrim(connectToken),
    };

    // Close form, stay compact — dot will show connecting/connected state.
    setShowConnectForm(false);

    try {
      await client.connectAndVerify(nextSettings);
      await saveSettings(nextSettings);
      setSettings(nextSettings);
    } catch (error) {
      // Show error briefly in the response panel.
      setActiveQuery("/connect");
      setAssistantText(
        `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const command = parsePanelCommand(input);
    if (!command) {
      return;
    }

    setInput("");

    if (command.kind === "connect") {
      setConnectUrl(settings.gatewayUrl);
      setConnectToken(settings.token);
      setShowConnectForm(true);
      setShowSettingsForm(false);
      setActiveQuery("");
      setAssistantText("");
      setStreamingText("");
      setIsThinking(false);
      return;
    }

    if (command.kind === "settings") {
      setSettingsShortcuts([...settings.shortcuts]);
      setShowSettingsForm(true);
      setShowConnectForm(false);
      setActiveQuery("");
      setAssistantText("");
      setStreamingText("");
      setIsThinking(false);
      return;
    }

    if (command.kind === "status") {
      setActiveQuery("/status");
      setAssistantText(
        `Gateway: ${settings.gatewayUrl}\nStatus: ${connectionState}\nToken: ${settings.token ? "***" : "(none)"}`,
      );
      setStreamingText("");
      setIsThinking(false);
      setShowConnectForm(false);
      return;
    }

    setActiveQuery(command.text);
    setAssistantText("");
    setStreamingText("");
    streamingTextRef.current = "";
    setIsThinking(true);
    isThinkingRef.current = true;
    setShowConnectForm(false);

    if (!settingsLoaded) {
      setAssistantText("Loading settings...");
      setIsThinking(false);
      isThinkingRef.current = false;
      return;
    }

    if (!client.connected) {
      setAssistantText(
        connectionState === "connecting"
          ? "Connecting to gateway..."
          : "No connection to gateway.",
      );
      setIsThinking(false);
      isThinkingRef.current = false;
      return;
    }

    try {
      client.sendChatMessage(command.text, settings);
    } catch (error) {
      setAssistantText(`Send failed: ${String(error)}`);
      setIsThinking(false);
      isThinkingRef.current = false;
    }
  };

  const handleShortcutChange = useCallback(
    (index: number, value: string) => {
      setSettingsShortcuts((prev) => {
        const next: [string, string, string] = [...prev];
        next[index] = value;
        return next;
      });
    },
    [],
  );

  const handleSaveSettings = async (event: FormEvent) => {
    event.preventDefault();
    setShowSettingsForm(false);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("update_shortcuts", { shortcuts: settingsShortcuts });

      const nextSettings: AppSettings = {
        ...settings,
        shortcuts: settingsShortcuts,
      };
      await saveSettings(nextSettings);
      setSettings(nextSettings);
    } catch (error) {
      setActiveQuery("/settings");
      setAssistantText(
        `Failed to update shortcuts: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleCopy = useCallback(() => {
    const text = safeTrim(streamingText) || safeTrim(assistantText);
    if (text) {
      void navigator.clipboard.writeText(text);
    }
  }, [streamingText, assistantText]);

  return (
    <main className="app-root">
      <CommandInput
        value={input}
        connectionState={connectionState}
        onChange={setInput}
        onSubmit={handleSubmit}
        onKeyDown={onInputKeyDown}
        inputRef={inputRef}
      />

      {showHints ? (
        <CommandHints
          commands={commandHints}
          activeIndex={hintIndex}
          onHover={setHintIndex}
          onSelect={(cmd) => setInput(cmd.name)}
        />
      ) : showConnectForm ? (
        <ConnectForm
          gatewayUrl={connectUrl}
          token={connectToken}
          onGatewayUrlChange={setConnectUrl}
          onTokenChange={setConnectToken}
          onSubmit={handleConnect}
        />
      ) : showSettingsForm ? (
        <SettingsForm
          shortcuts={settingsShortcuts}
          onShortcutChange={handleShortcutChange}
          onSubmit={handleSaveSettings}
        />
      ) : (
        <ResponsePanel
          ref={responsePanelRef}
          activeQuery={activeQuery}
          response={renderedAnswer}
          isStreaming={!!safeTrim(streamingText)}
          isThinking={isThinking}
          onCopy={handleCopy}
          client={client}
        />
      )}
    </main>
  );
}
