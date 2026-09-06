// Forwards mono microphone audio to the main thread in ~1024-sample blocks.
// Resampling to 16 kHz and Int16 conversion happen on the main thread so this
// stays as light as possible on the audio render quantum.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(1024);
    this._n = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    for (let i = 0; i < ch.length; i += 1) {
      this._buf[this._n++] = ch[i];
      if (this._n === this._buf.length) {
        this.port.postMessage(this._buf.slice(0));
        this._n = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
