import { useEffect, useRef, useState } from 'react';

interface MicTesterProps {
  onAudioLevel?: (level: number) => void;
  onAnalyserCreated?: (analyser: AnalyserNode | null) => void;
}

export default function MicTester({ onAudioLevel, onAnalyserCreated }: MicTesterProps) {
  const [testing, setTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    // Enumerate audio input devices
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const inputs = devices.filter((d) => d.kind === 'audioinput');
        setAudioDevices(inputs);
        if (inputs.length > 0 && !selectedDevice) {
          setSelectedDevice(inputs[0].deviceId);
        }
      }).catch(() => {});
    }
  }, []);

  const stopTest = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    onAnalyserCreated?.(null);
    onAudioLevel?.(0);
    setMicLevel(0);
    setTesting(false);
  };

  const startTest = async () => {
    setPermissionError(null);
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedDevice ? { deviceId: { exact: selectedDevice } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      analyserRef.current = analyser;
      onAnalyserCreated?.(analyser);

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      setTesting(true);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setMicLevel(normalized);
        onAudioLevel?.(normalized / 100);

        rafRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch (err: any) {
      setPermissionError(err.message || 'Microphone access denied or not found');
      stopTest();
    }
  };

  useEffect(() => {
    return () => {
      stopTest();
    };
  }, []);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur-xl transition hover:border-cyan/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-xl border transition ${
              testing
                ? 'border-mint/60 bg-mint/10 text-mint shadow-[0_0_15px_rgba(0,255,156,0.3)]'
                : 'border-white/10 bg-white/5 text-white/50'
            }`}
          >
            {testing ? (
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-mint"></span>
              </span>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 003-3V5a3 3 0 00-3-3 3 3 0 00-3 3v6a3 3 0 003 3z"
                />
              </svg>
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold text-white tracking-wide flex items-center gap-1.5">
              Pre-Flight Audio Check
              {testing && (
                <span className="rounded bg-mint/20 px-1.5 py-0.2 text-[10px] font-mono font-medium text-mint animate-pulse">
                  LIVE INPUT
                </span>
              )}
            </h4>
            <p className="text-[11px] text-white/45">
              Verify signal clarity before initiating real-time debate telemetry
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={testing ? stopTest : startTest}
          className={`rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition active:scale-95 ${
            testing
              ? 'border-rose/50 bg-rose/10 text-rose hover:bg-rose/20'
              : 'border-cyan/50 bg-cyan/10 text-cyan hover:border-cyan hover:bg-cyan/20 hover:text-white shadow-[0_0_12px_rgba(0,212,255,0.15)]'
          }`}
        >
          {testing ? 'Stop Test' : 'Test Mic Signal'}
        </button>
      </div>

      {permissionError && (
        <div className="mt-3 rounded-lg border border-rose/30 bg-rose/10 px-3 py-1.5 text-xs text-rose">
          <span className="font-mono font-bold mr-1.5">[NOTICE]</span>{permissionError}
        </div>
      )}

      {/* Dynamic Sound Level Spectrum Bar */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] font-mono text-white/40 mb-1.5">
          <span>INPUT GAIN</span>
          <span className={micLevel > 15 ? 'text-mint font-bold' : 'text-white/40'}>
            {testing ? `${micLevel}% ${micLevel > 75 ? 'HIGH' : micLevel > 15 ? 'OPTIMAL' : 'LOW'}` : 'OFFLINE'}
          </span>
        </div>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-black/40 border border-white/10 p-0.5">
          <div
            className={`h-full rounded-full transition-all duration-75 ${
              micLevel > 75
                ? 'bg-gradient-to-r from-cyan via-mint to-amber shadow-[0_0_12px_rgba(255,184,0,0.6)]'
                : 'bg-gradient-to-r from-cyan to-mint shadow-[0_0_10px_rgba(0,255,156,0.5)]'
            }`}
            style={{ width: `${testing ? Math.max(4, micLevel) : 0}%` }}
          />
        </div>
      </div>

      {/* Equalizer Frequency Simulation bars when active */}
      {testing && (
        <div className="mt-3 flex items-end justify-between gap-1 h-6 px-1">
          {Array.from({ length: 24 }).map((_, i) => {
            const h = Math.max(15, Math.min(100, Math.sin(i * 0.4 + micLevel * 0.1) * 50 + micLevel * 0.7));
            return (
              <div
                key={i}
                className="flex-1 rounded-t-sm bg-gradient-to-t from-cyan/40 to-mint transition-all duration-75"
                style={{
                  height: `${testing ? h : 15}%`,
                  opacity: 0.3 + (micLevel / 100) * 0.7,
                }}
              />
            );
          })}
        </div>
      )}

      {audioDevices.length > 1 && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[10px] font-mono text-white/40 uppercase">Device:</span>
          <select
            value={selectedDevice}
            onChange={(e) => {
              setSelectedDevice(e.target.value);
              if (testing) {
                stopTest();
                setTimeout(startTest, 100);
              }
            }}
            className="flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white/70 outline-none focus:border-cyan/50"
          >
            {audioDevices.map((d, idx) => (
              <option key={d.deviceId || idx} value={d.deviceId} className="bg-slate-900 text-white">
                {d.label || `Microphone ${idx + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
