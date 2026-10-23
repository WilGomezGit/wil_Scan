// Cámara del dispositivo: abrir, cambiar entre trasera y frontal, linterna y captura a máxima resolución.
import { canvasOf } from './cv.js';
import { blobToCanvas } from './pages.js';

export class Camera {
  constructor(video) { this.video = video; this.stream = null; this.track = null; this.facing = 'environment'; this.torchOn = false; }

  async start(facing = this.facing) {
    this.stop();
    this.facing = facing;
    const tries = [
      { width: { ideal: 3840 }, height: { ideal: 2160 } },
      { width: { ideal: 1920 }, height: { ideal: 1080 } },
      {},
    ];
    let lastErr = null;
    for (const size of tries) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, ...size } });
        break;
      } catch (e) { lastErr = e; if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break; }
    }
    if (!this.stream) throw lastErr || new Error('No se pudo abrir la cámara.');
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    this.video.muted = true; this.video.playsInline = true;
    await this.video.play().catch(() => {});
    if (!this.video.videoWidth) await new Promise((r) => { this.video.onloadedmetadata = r; setTimeout(r, 3000); });
    return this.info();
  }

  info() {
    const caps = (this.track && this.track.getCapabilities && this.track.getCapabilities()) || {};
    return { width: this.video.videoWidth, height: this.video.videoHeight, torch: !!caps.torch, label: this.track ? this.track.label : '' };
  }

  async setTorch(on) {
    if (!this.track) return false;
    try { await this.track.applyConstraints({ advanced: [{ torch: !!on }] }); this.torchOn = !!on; return true; } catch { return false; }
  }

  // Foto a la máxima resolución del sensor si el navegador lo permite; si no, el fotograma del video
  async capture() {
    // Si el video ya llega en alta resolución (≥ 2560 px de lado mayor: 4K), el fotograma del propio video es instantáneo y sobra para las
    // páginas (se procesan a 1800–2400 px). La foto del sensor tarda de 1 a 3 s en muchos teléfonos: solo se pide cuando el video es de baja resolución.
    if (Math.max(this.video.videoWidth, this.video.videoHeight) >= 2560) return this.frame();
    if (this.track && 'ImageCapture' in window) {
      try {
        const ic = new ImageCapture(this.track);
        const blob = await Promise.race([ic.takePhoto(), new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo')), 2500))]);
        const c = await blobToCanvas(blob, 3000);                       // se decodifica ya reducida: no se carga la foto de 12 MP entera en memoria
        if (Math.min(c.width, c.height) >= Math.min(this.video.videoWidth, this.video.videoHeight)) return c;
      } catch { /* se usa el fotograma */ }
    }
    return this.frame();
  }

  frame() {
    const v = this.video, c = canvasOf(v.videoWidth, v.videoHeight);
    c.getContext('2d').drawImage(v, 0, 0);
    return c;
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ya parada */ } });
    this.stream = null; this.track = null; this.torchOn = false;
    this.video.srcObject = null;
  }
}
