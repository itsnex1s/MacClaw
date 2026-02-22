import { useMemo, useRef, useState, type MutableRefObject } from "react";
import { WsClient, type ConnectionState } from "../lib/ws-client";
import { emitNotchState } from "../lib/panel-window";

type UseWsClientResult = {
  client: WsClient;
  connectionState: ConnectionState;
  assistantText: string;
  setAssistantText: (text: string) => void;
  streamingText: string;
  setStreamingText: (text: string) => void;
  isThinking: boolean;
  setIsThinking: (v: boolean) => void;
  isThinkingRef: MutableRefObject<boolean>;
  streamingTextRef: MutableRefObject<string>;
};

export function useWsClient(
  backgroundModeRef: MutableRefObject<boolean>,
): UseWsClientResult {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [assistantText, setAssistantText] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  const isThinkingRef = useRef(false);
  const streamingTextRef = useRef("");
  const clientRef = useRef<WsClient | null>(null);

  const client = useMemo(() => {
    if (clientRef.current) {
      return clientRef.current;
    }

    const instance = new WsClient({
      onState: (state) => {
        setConnectionState(state);
        // BUG 2: If WS drops while background streaming, transition notch to "ready"
        // instead of leaving it stuck in "streaming" forever.
        if (
          (state === "idle" || state === "error") &&
          backgroundModeRef.current &&
          (isThinkingRef.current || streamingTextRef.current.length > 0)
        ) {
          const preview = streamingTextRef.current || "Connection lost";
          isThinkingRef.current = false;
          setIsThinking(false);
          void emitNotchState("ready", preview);
        }
      },
      onEvent: (event) => {
        if (event.kind === "assistant_delta") {
          streamingTextRef.current = event.text;
          setStreamingText(event.text);
          isThinkingRef.current = false;
          setIsThinking(false);
          return;
        }

        if (event.kind === "assistant_done") {
          isThinkingRef.current = false;
          setIsThinking(false);
          // BUG 3: Don't emit notch "ready" here — the "assistant" event that
          // follows will emit it with the final text. Emitting in both places
          // caused a double flash.
          return;
        }

        if (event.kind === "assistant") {
          streamingTextRef.current = "";
          setStreamingText("");
          setAssistantText(event.text);
          isThinkingRef.current = false;
          setIsThinking(false);

          if (backgroundModeRef.current) {
            void emitNotchState("ready", event.text);
          }
          return;
        }

        if (event.kind === "error") {
          streamingTextRef.current = "";
          setStreamingText("");
          setAssistantText(`Error: ${event.text}`);
          isThinkingRef.current = false;
          setIsThinking(false);

          if (backgroundModeRef.current) {
            void emitNotchState("ready", `Error: ${event.text}`);
          }
        }
      },
    });

    clientRef.current = instance;
    return instance;
  }, []);

  return {
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
  };
}
