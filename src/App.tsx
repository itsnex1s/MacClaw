import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { CommandHints } from "./components/CommandHints";
import { CommandInput } from "./components/CommandInput";
import { ConnectForm } from "./components/ConnectForm";
import { ResponsePanel } from "./components/ResponsePanel";
import { SettingsForm } from "./components/SettingsForm";
import type { PanelMode } from "./constants/panel";
import { resolveSubmitAction } from "./features/panel/submit-resolver";
import {
  DEFAULT_INPUT_PLACEHOLDER,
  type SelectionContext,
} from "./features/panel/types";
import { useSelectionPrefill } from "./features/panel/useSelectionPrefill";
import { useCommandInput } from "./hooks/useCommandInput";
import { useWsClient } from "./hooks/useWsClient";
import { usePanelLifecycle } from "./hooks/usePanelLifecycle";
import { usePanelResize } from "./hooks/usePanelResize";
import { safeTrim } from "./lib/commands";
import { clearMediaCache } from "./lib/media-cache";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type AppSettings,
} from "./lib/settings";

function resolvePanelMode(params: {
  showHints: boolean;
  showConnectForm: boolean;
  showSettingsForm: boolean;
  activeQuery: string;
}): PanelMode {
  if (params.showHints) {
    return "hints";
  }
  if (params.showConnectForm) {
    return "connect";
  }
  if (params.showSettingsForm) {
    return "settings";
  }
  return params.activeQuery.length > 0 ? "response" : "compact";
}

export function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [inputPlaceholder, setInputPlaceholder] = useState(
    DEFAULT_INPUT_PLACEHOLDER,
  );
  const [selectionContext, setSelectionContext] =
    useState<SelectionContext | null>(null);

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
  const preserveNextOpenRef = useRef(false);

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

  const resetResponseState = useCallback(() => {
    setActiveQuery("");
    setAssistantText("");
    setStreamingText("");
    streamingTextRef.current = "";
    setIsThinking(false);
    isThinkingRef.current = false;
  }, [setAssistantText, setStreamingText, setIsThinking, isThinkingRef, streamingTextRef]);

  const clearConversation = useCallback(() => {
    setInput("");
    setInputPlaceholder(DEFAULT_INPUT_PLACEHOLDER);
    setSelectionContext(null);
    resetResponseState();
    setShowConnectForm(false);
    setShowSettingsForm(false);
    setHintIndex(0);
    clearMediaCache();
  }, [resetResponseState, setHintIndex, setInput]);

  usePanelLifecycle({
    client,
    settings,
    settingsLoaded,
    preserveNextOpenRef,
    backgroundModeRef,
    isThinkingRef,
    streamingTextRef,
    inputRef,
    clearConversation,
    setBackgroundMode,
  });

  const handleSelectionPrefillStart = useCallback(() => {
    setShowConnectForm(false);
    setShowSettingsForm(false);
    resetResponseState();
  }, [resetResponseState]);

  useSelectionPrefill({
    inputRef,
    preserveNextOpenRef,
    onPrefillStart: handleSelectionPrefillStart,
    setInput,
    setInputPlaceholder,
    setSelectionContext,
  });

  // Which panel mode?
  const panelMode = resolvePanelMode({
    showHints,
    showConnectForm,
    showSettingsForm,
    activeQuery,
  });
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

    const rawInput = safeTrim(inputRef.current?.value ?? input);
    const action = resolveSubmitAction({
      rawInput,
      selectionContext,
      gatewayUrl: settings.gatewayUrl,
      token: settings.token,
      connectionState,
    });

    if (action.kind === "noop") {
      return;
    }

    setInput("");
    setInputPlaceholder(DEFAULT_INPUT_PLACEHOLDER);

    if (action.kind === "open_connect") {
      setConnectUrl(settings.gatewayUrl);
      setConnectToken(settings.token);
      setShowConnectForm(true);
      setShowSettingsForm(false);
      resetResponseState();
      return;
    }

    if (action.kind === "open_settings") {
      setSettingsShortcuts([...settings.shortcuts]);
      setShowSettingsForm(true);
      setShowConnectForm(false);
      resetResponseState();
      return;
    }

    if (action.kind === "show_status") {
      setActiveQuery(action.query);
      setAssistantText(action.message);
      setStreamingText("");
      setIsThinking(false);
      setShowConnectForm(false);
      return;
    }

    setActiveQuery(action.queryLabel);
    setAssistantText("");
    setStreamingText("");
    streamingTextRef.current = "";
    setIsThinking(true);
    isThinkingRef.current = true;
    setShowConnectForm(false);
    setSelectionContext(null);

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
      client.sendChatMessage(action.outgoingPrompt, settings);
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

  const handleInputChange = useCallback(
    (value: string) => {
      if (inputPlaceholder !== DEFAULT_INPUT_PLACEHOLDER) {
        setInputPlaceholder(DEFAULT_INPUT_PLACEHOLDER);
      }
      setInput(value);
    },
    [inputPlaceholder, setInput],
  );

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const currentInput = safeTrim(inputRef.current?.value ?? input);
      if (
        selectionContext &&
        currentInput.length === 0 &&
        event.key === "Backspace"
      ) {
        event.preventDefault();
        setSelectionContext(null);
        return;
      }

      onInputKeyDown(event);
    },
    [input, onInputKeyDown, selectionContext],
  );

  const handleClearSelectionBadge = useCallback(() => {
    setSelectionContext(null);
    inputRef.current?.focus();
  }, []);

  const selectionBadge = selectionContext
    ? `selected: ${selectionContext.chars} chars`
    : undefined;

  return (
    <main className="app-root">
      <CommandInput
        value={input}
        placeholder={inputPlaceholder}
        selectionBadge={selectionBadge}
        connectionState={connectionState}
        onChange={handleInputChange}
        onClearSelectionBadge={handleClearSelectionBadge}
        onSubmit={handleSubmit}
        onKeyDown={handleInputKeyDown}
        inputRef={inputRef}
      />

      {showHints ? (
        <CommandHints
          commands={commandHints}
          activeIndex={hintIndex}
          onHover={setHintIndex}
          onSelect={(cmd) => handleInputChange(cmd.name)}
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
