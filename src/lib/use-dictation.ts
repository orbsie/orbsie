"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
function recognitionConstructor() {
  const browser = window as SpeechWindow;
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

/** Browser-managed dictation; audio is never stored or relayed by Orbsie. */
export function useDictation(
  value: string,
  onText: (text: string) => void,
  onError: (message: string) => void,
) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const latest = useRef({ value, onText, onError });
  latest.current = { value, onText, onError };

  const cancel = useCallback(() => {
    const current = recognition.current;
    recognition.current = null;
    if (current) {
      current.onresult = current.onerror = current.onend = null;
      current.abort();
    }
    setListening(false);
  }, []);

  useEffect(() => {
    setSupported(!!recognitionConstructor());
    const hide = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      const current = recognition.current;
      recognition.current = null;
      if (current) {
        current.onresult = current.onerror = current.onend = null;
        current.abort();
      }
    };
  }, [cancel]);

  const toggle = useCallback(() => {
    if (recognition.current) {
      // Allow the service to deliver its final correction before ending.
      recognition.current.stop();
      return;
    }
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      latest.current.onError(
        "Speech input isn’t available in this browser. You can still type your prompt.",
      );
      return;
    }
    const current = new Constructor();
    const prefix = latest.current.value.trimEnd();
    recognition.current = current;
    current.lang = navigator.language || "en-US";
    current.continuous = true;
    current.interimResults = true;
    current.onresult = (event) => {
      if (recognition.current !== current) return;
      const transcript = Array.from(event.results, (result) =>
        result[0].transcript.trim(),
      )
        .filter(Boolean)
        .join(" ");
      latest.current.onText(
        [prefix, transcript].filter(Boolean).join(" ").slice(0, 4000),
      );
    };
    current.onerror = (event) => {
      if (recognition.current !== current) return;
      cancel();
      const messages: Record<string, string> = {
        "not-allowed":
          "Microphone access was denied. Allow it in your browser’s site settings to dictate.",
        "service-not-allowed":
          "Your browser’s speech service is unavailable. You can type your prompt instead.",
        "audio-capture": "No microphone was found. Connect one and try again.",
        "no-speech": "No speech was heard. Tap the microphone to try again.",
        network:
          "Your browser’s speech service couldn’t connect. Check your connection and try again.",
      };
      if (event.error !== "aborted")
        latest.current.onError(
          messages[event.error] ??
            "Dictation stopped. Your text is safe; try again or keep typing.",
        );
    };
    current.onend = () => {
      if (recognition.current === current) {
        recognition.current = null;
        setListening(false);
      }
    };
    try {
      setListening(true);
      current.start();
    } catch {
      cancel();
      latest.current.onError(
        "Couldn’t start the microphone. Check your browser permissions and try again.",
      );
    }
  }, [cancel]);

  return { supported, listening, toggle, cancel };
}
