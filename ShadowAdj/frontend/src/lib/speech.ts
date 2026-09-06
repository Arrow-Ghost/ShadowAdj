// Thin wrapper around the browser SpeechRecognition API. Used only when the
// session's transcript source is "browser" (the default, no API key needed).

type Handlers = { onResult: (text: string, isFinal: boolean) => void; onError?: (e: string) => void };

export function browserSpeechSupported(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function startBrowserSpeech(handlers: Handlers): () => void {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) {
    handlers.onError?.('This browser has no SpeechRecognition. Use Chrome, or enable server transcription.');
    return () => {};
  }
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';

  let stopped = false;
  rec.onresult = (ev: any) => {
    let interim = '';
    let final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const chunk = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) final += chunk;
      else interim += chunk;
    }
    if (final) handlers.onResult(final.trim(), true);
    else if (interim) handlers.onResult(interim.trim(), false);
  };
  rec.onerror = (ev: any) => handlers.onError?.(ev.error || 'speech error');
  rec.onend = () => {
    if (!stopped) {
      try {
        rec.start();
      } catch {
        /* already starting */
      }
    }
  };
  rec.start();

  return () => {
    stopped = true;
    try {
      rec.stop();
    } catch {
      /* noop */
    }
  };
}
