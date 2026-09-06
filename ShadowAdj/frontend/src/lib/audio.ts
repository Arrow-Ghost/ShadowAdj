import { API_BASE } from './api';

const TARGET_RATE = 16_000;
// 100ms chunk at 16 kHz = 1600 samples (cuts packet rate from 47/s to 10/s)
const CHUNK_SAMPLES = 1_600;

export interface CaptureHandle {
  stop: () => void;
  /** Stop the mic and ask the backend to finish; resolves with its final export. */
  finish: (timeoutMs?: number) => Promise<any>;
  socket: WebSocket;
  analyser: AnalyserNode;
  audioCtx: AudioContext;
  getReplayUrl: () => string | null;
}

/** Downsample a Float32 block from `inRate` to 16 kHz with linear interpolation. */
function downsample(block: Float32Array, inRate: number): Float32Array {
  if (inRate === TARGET_RATE) return block;
  const ratio = inRate / TARGET_RATE;
  const outLen = Math.floor(block.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, block.length - 1);
    out[i] = block[lo] + (block[hi] - block[lo]) * (pos - lo);
  }
  return out;
}

function frameAudioChunk(
  f32: Float32Array,
  sequenceNumber: number,
  audioChunkId: number,
  timestampMs: number,
): ArrayBuffer {
  const pcm16ByteLength = f32.length * 2;
  const buffer = new ArrayBuffer(20 + pcm16ByteLength);
  const view = new DataView(buffer);

  // Magic 0x53484144 ('SHAD')
  view.setUint32(0, 0x53484144, false);
  view.setUint32(4, sequenceNumber, false);
  view.setUint32(8, audioChunkId, false);
  view.setFloat64(12, timestampMs, false);

  const pcmView = new Int16Array(buffer, 20, f32.length);
  for (let i = 0; i < f32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    pcmView[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  return buffer;
}

export async function startCapture(opts: {
  sessionId: string;
  transcriptSource: 'browser' | 'server';
  onMessage: (msg: any) => void;
  onClose?: () => void;
}): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });

  const wsBase = API_BASE.replace(/^http/, 'ws');
  const wsUrl = `${wsBase}/ws?sessionId=${opts.sessionId}`;

  let isExplicitStop = false;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  let currentSocket: WebSocket;

  function initWebSocket(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        reconnectAttempts = 0;
        socket.send(
          JSON.stringify({
            type: 'hello',
            transcriptSource: opts.transcriptSource,
            resume: reconnectAttempts > 0,
          }),
        );
        resolve(socket);
      };

      socket.onerror = (err) => {
        if (!currentSocket) reject(err);
      };

      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'ping' && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'pong', at: Date.now() }));
          }
          opts.onMessage(msg);
        } catch {
          /* ignore non-JSON */
        }
      };

      socket.onclose = () => {
        if (!isExplicitStop && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts += 1;
          const delay = Math.min(2000, 300 * Math.pow(1.5, reconnectAttempts));
          opts.onMessage({
            type: 'notice',
            message: `Connection dropped. Reconnecting (attempt ${reconnectAttempts}/${maxReconnectAttempts})…`,
          });
          setTimeout(() => {
            if (!isExplicitStop) {
              initWebSocket()
                .then((newSock) => {
                  currentSocket = newSock;
                  opts.onMessage({ type: 'notice', message: 'Reconnected to session.' });
                })
                .catch(() => {});
            }
          }, delay);
        } else if (!isExplicitStop) {
          opts.onClose?.();
        }
      };
    });
  }

  currentSocket = await initWebSocket();

  // In-memory audio recording for post-session replay (never written to server)
  const recordedBlobs: Blob[] = [];
  let mediaRecorder: MediaRecorder | null = null;
  try {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedBlobs.push(e.data);
    };
    mediaRecorder.start(250);
  } catch {
    /* MediaRecorder not available */
  }

  // Request native 16 kHz AudioContext when supported by the browser to avoid resampling artifacts
  let audioCtx: AudioContext;
  try {
    audioCtx = new AudioContext({ sampleRate: TARGET_RATE });
  } catch {
    audioCtx = new AudioContext();
  }

  await audioCtx.audioWorklet.addModule('/capture-worklet.js');
  const src = audioCtx.createMediaStreamSource(stream);

  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.8;
  src.connect(analyser);

  let seq = 0;
  const startT = performance.now();

  // Accumulate downsampled samples into 100ms (1600 sample) chunks
  let pcmAccumulator = new Float32Array(0);

  const worklet = new AudioWorkletNode(audioCtx, 'capture-processor');
  src.connect(worklet);
  worklet.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    if (currentSocket.readyState !== WebSocket.OPEN) return;

    const ds = downsample(ev.data, audioCtx.sampleRate);
    const nextBuf = new Float32Array(pcmAccumulator.length + ds.length);
    nextBuf.set(pcmAccumulator, 0);
    nextBuf.set(ds, pcmAccumulator.length);
    pcmAccumulator = nextBuf;

    // Dispatch in 100ms chunks (~10 packets/sec)
    while (pcmAccumulator.length >= CHUNK_SAMPLES) {
      const chunk = pcmAccumulator.subarray(0, CHUNK_SAMPLES);
      pcmAccumulator = pcmAccumulator.subarray(CHUNK_SAMPLES);
      seq += 1;
      const framed = frameAudioChunk(chunk, seq, seq, performance.now() - startT);
      if (currentSocket.readyState === WebSocket.OPEN) {
        currentSocket.send(framed);
      }
    }
  };

  let replayUrl: string | null = null;

  const stopMic = () => {
    // Flush any pending trailing samples
    if (pcmAccumulator.length > 0 && currentSocket && currentSocket.readyState === WebSocket.OPEN) {
      seq += 1;
      const framed = frameAudioChunk(pcmAccumulator, seq, seq, performance.now() - startT);
      currentSocket.send(framed);
      pcmAccumulator = new Float32Array(0);
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch {
        /* noop */
      }
    }
    if (recordedBlobs.length > 0 && !replayUrl) {
      try {
        const blob = new Blob(recordedBlobs, { type: mediaRecorder?.mimeType || 'audio/webm' });
        replayUrl = URL.createObjectURL(blob);
      } catch {
        /* noop */
      }
    }
    worklet.port.onmessage = null;
    worklet.disconnect();
    analyser.disconnect();
    src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    audioCtx.close().catch(() => {});
  };

  const stop = () => {
    isExplicitStop = true;
    try {
      currentSocket.send(JSON.stringify({ type: 'end' }));
    } catch {
      /* noop */
    }
    stopMic();
    currentSocket.close();
  };

  const finish = (timeoutMs = 8000): Promise<any> =>
    new Promise((resolve) => {
      isExplicitStop = true;
      stopMic();
      let done = false;
      const finishUp = (value: any) => {
        if (done) return;
        done = true;
        currentSocket.onmessage = null;
        try {
          currentSocket.close();
        } catch {
          /* noop */
        }
        resolve(value);
      };
      const prev = currentSocket.onmessage;
      currentSocket.onmessage = (ev) => {
        if (typeof prev === 'function') prev.call(currentSocket, ev);
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'ended') finishUp(msg.export ?? null);
        } catch {
          /* ignore */
        }
      };
      try {
        currentSocket.send(JSON.stringify({ type: 'end' }));
      } catch {
        finishUp(null);
      }
      setTimeout(() => finishUp(null), timeoutMs);
    });

  const getReplayUrl = () => {
    if (!replayUrl && recordedBlobs.length > 0) {
      try {
        const blob = new Blob(recordedBlobs, { type: mediaRecorder?.mimeType || 'audio/webm' });
        replayUrl = URL.createObjectURL(blob);
      } catch {
        /* noop */
      }
    }
    return replayUrl;
  };

  return {
    stop,
    finish,
    get socket() {
      return currentSocket;
    },
    analyser,
    audioCtx,
    getReplayUrl,
  };
}
