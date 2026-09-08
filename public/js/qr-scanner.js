/**
 * Universal QR Code Scanner & Image Decoder
 * Multi-stage decoding supporting:
 *  1. Live Camera via HTML5 Video (native BarcodeDetector + jsQR fallback)
 *  2. High-Accuracy Image File Upload & Drag-and-Drop (resizing, grayscale, binarization)
 *  3. Visual drop-zone preview & vibration/audio feedback
 */

(function (global) {
  class QRScannerManager {
    constructor(options = {}) {
      this.videoElement = options.videoElement || null;
      this.onScanSuccess = options.onScanSuccess || (() => {});
      this.onError = options.onError || (() => {});
      this.stream = null;
      this.scanning = false;
      this.animationFrameId = null;
      this.facingMode = 'environment';
      this.detector = null;

      // Initialize BarcodeDetector if available
      if ('BarcodeDetector' in window) {
        try {
          this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch (e) {
          try {
            this.detector = new window.BarcodeDetector();
          } catch (e2) {
            console.warn('BarcodeDetector initialization fallback:', e2);
          }
        }
      }

      // Reusable offscreen canvas for frame and image processing
      this.processCanvas = document.createElement('canvas');
      this.processCtx = this.processCanvas.getContext('2d', { willReadFrequently: true });
    }

    getEngine() {
      if (typeof window !== 'undefined' && typeof window.jsQR === 'function') return window.jsQR;
      if (typeof jsQR === 'function') {
        if (typeof window !== 'undefined') window.jsQR = jsQR;
        return jsQR;
      }
      if (typeof globalThis !== 'undefined' && typeof globalThis.jsQR === 'function') {
        if (typeof window !== 'undefined') window.jsQR = globalThis.jsQR;
        return globalThis.jsQR;
      }
      return null;
    }

    async ensureDecoderEngine() {
      if (this.getEngine() || this.detector) return true;

      // Lazy check for BarcodeDetector
      if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
        try {
          this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          return true;
        } catch (e) {
          try {
            this.detector = new window.BarcodeDetector();
            return true;
          } catch (e2) {}
        }
      }

      // Dynamic load fallback
      if (typeof document !== 'undefined') {
        const loadScript = (src) => new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = src;
          s.onload = () => resolve();
          s.onerror = (e) => reject(e);
          document.head.appendChild(s);
        });

        try {
          await loadScript('/vendor/jsqr.min.js');
        } catch (e) {
          try {
            await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js');
          } catch (e2) {
            console.warn('Fallback dynamic jsQR script loading failed:', e2);
          }
        }

        return !!this.getEngine();
      }

      return false;
    }

    async startCamera(videoElem) {
      if (videoElem) this.videoElement = videoElem;
      if (!this.videoElement) {
        throw new Error('No video element provided for QR scanner');
      }

      this.stopCamera();

      try {
        const constraints = {
          video: {
            facingMode: this.facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        };

        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.videoElement.srcObject = this.stream;
        await this.videoElement.play();

        this.scanning = true;
        this.scanLoop();
        return true;
      } catch (err) {
        console.warn('Camera access unavailable or denied:', err.message);
        this.onError(err);
        return false;
      }
    }

    stopCamera() {
      this.scanning = false;
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }
      if (this.videoElement) {
        this.videoElement.srcObject = null;
      }
    }

    toggleCameraFacing() {
      this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
      if (this.scanning) {
        this.startCamera();
      }
    }

    async scanLoop() {
      if (!this.scanning || !this.videoElement) return;

      if (this.videoElement.readyState === this.videoElement.HAVE_ENOUGH_DATA) {
        // Stage 1: Try native BarcodeDetector
        if (this.detector) {
          try {
            const barcodes = await this.detector.detect(this.videoElement);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              this.triggerSuccess(barcodes[0].rawValue);
              return;
            }
          } catch (e) {}
        }

        // Stage 2: Fallback to jsQR for Safari/Firefox camera frames
        const jsQR = this.getEngine();
        if (typeof jsQR === 'function') {
          const vw = this.videoElement.videoWidth;
          const vh = this.videoElement.videoHeight;
          if (vw > 0 && vh > 0) {
            // Downscale video frame if large for high FPS
            const targetW = Math.min(vw, 640);
            const targetH = Math.round((vh / vw) * targetW);
            this.processCanvas.width = targetW;
            this.processCanvas.height = targetH;
            this.processCtx.drawImage(this.videoElement, 0, 0, targetW, targetH);

            const imgData = this.processCtx.getImageData(0, 0, targetW, targetH);
            const code = jsQR(imgData.data, targetW, targetH, {
              inversionAttempts: 'dontInvert'
            });
            if (code && code.data) {
              this.triggerSuccess(code.data);
              return;
            }
          }
        }
      }

      if (this.scanning) {
        this.animationFrameId = requestAnimationFrame(() => this.scanLoop());
      }
    }

    triggerSuccess(code) {
      this.playBeep();
      if (navigator.vibrate) {
        try { navigator.vibrate(100); } catch (e) {}
      }
      this.onScanSuccess(code);
    }

    playBeep() {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      } catch (e) {}
    }

    /**
     * Decode an image file using multi-stage analysis:
     * 1. Direct jsQR on normalized image (max 1000px)
     * 2. High-contrast thresholded binarization
     * 3. Native BarcodeDetector fallback
     */
    async scanImageFile(file) {
      return new Promise((resolve, reject) => {
        const isImg = (file && file.type && file.type.startsWith('image/')) ||
                      (file && file.name && /\.(png|jpe?g|webp|bmp|svg|gif)$/i.test(file.name));
        if (!file || !isImg) {
          return reject(new Error('Please upload a valid image file (PNG, JPG, WebP)'));
        }

        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = async () => {
            try {
              const result = await this.decodeImageElement(img);
              resolve(result);
            } catch (err) {
              reject(err);
            }
          };
          img.onerror = () => reject(new Error('Failed to load image file. Please try another image.'));
          img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Failed to read file from disk'));
        reader.readAsDataURL(file);
      });
    }

    /**
     * Multi-stage image decoder for high detection accuracy
     */
    async decodeImageElement(img) {
      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;

      if (!origW || !origH) {
        throw new Error('Image has zero dimensions');
      }

      // Ensure QR decoder engine is initialized/loaded
      await this.ensureDecoderEngine();

      const jsQR = this.getEngine();
      const hasJsQR = typeof jsQR === 'function';
      const hasDetector = !!this.detector;

      if (!hasJsQR && !hasDetector) {
        throw new Error('No QR decoder engine available in this browser. Please use Chrome/Edge or ensure jsQR CDN is reachable.');
      }

      // Determine optimal dimensions (clamp to max 1000px for speed and accuracy)
      const maxDim = 1000;
      let targetW = origW;
      let targetH = origH;
      if (targetW > maxDim || targetH > maxDim) {
        if (targetW > targetH) {
          targetH = Math.round((targetH / targetW) * maxDim);
          targetW = maxDim;
        } else {
          targetW = Math.round((targetW / targetH) * maxDim);
          targetH = maxDim;
        }
      }

      const canvas = this.processCanvas;
      const ctx = this.processCtx;
      canvas.width = targetW;
      canvas.height = targetH;
      ctx.drawImage(img, 0, 0, targetW, targetH);

      // --- Stage 1: Try jsQR on normalized canvas ---
      if (hasJsQR) {
        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        const code = jsQR(imgData.data, targetW, targetH, {
          inversionAttempts: 'attemptBoth'
        });
        if (code && code.data) {
          this.triggerSuccess(code.data);
          return code.data;
        }

        // --- Stage 2: Try High-Contrast Binarization with jsQR ---
        const binarizedData = this.binarizeImageData(imgData);
        const codeBinarized = jsQR(binarizedData.data, targetW, targetH, {
          inversionAttempts: 'attemptBoth'
        });
        if (codeBinarized && codeBinarized.data) {
          this.triggerSuccess(codeBinarized.data);
          return codeBinarized.data;
        }
      }

      // --- Stage 3: Native BarcodeDetector on canvas & image ---
      if (hasDetector) {
        try {
          const barcodes = await this.detector.detect(canvas);
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            this.triggerSuccess(barcodes[0].rawValue);
            return barcodes[0].rawValue;
          }
        } catch (e) {}

        try {
          const barcodesOrig = await this.detector.detect(img);
          if (barcodesOrig.length > 0 && barcodesOrig[0].rawValue) {
            this.triggerSuccess(barcodesOrig[0].rawValue);
            return barcodesOrig[0].rawValue;
          }
        } catch (e) {}
      }

      // --- Stage 4: Try unscaled full-resolution image with jsQR if different ---
      if (hasJsQR && (origW !== targetW || origH !== targetH) && origW <= 2000) {
        canvas.width = origW;
        canvas.height = origH;
        ctx.drawImage(img, 0, 0, origW, origH);
        const fullImgData = ctx.getImageData(0, 0, origW, origH);
        const codeFull = jsQR(fullImgData.data, origW, origH, {
          inversionAttempts: 'attemptBoth'
        });
        if (codeFull && codeFull.data) {
          this.triggerSuccess(codeFull.data);
          return codeFull.data;
        }
      }

      throw new Error('No QR code detected in this image. Ensure the QR code is clearly visible and not cropped.');
    }

    /**
     * High-contrast grayscale binarization helper
     */
    binarizeImageData(imgData) {
      const data = new Uint8ClampedArray(imgData.data);
      const len = data.length;

      // Calculate average luminance
      let sum = 0;
      for (let i = 0; i < len; i += 4) {
        sum += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      }
      const threshold = sum / (len / 4);

      for (let i = 0; i < len; i += 4) {
        const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        const val = lum < threshold ? 0 : 255;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
      }

      return new ImageData(data, imgData.width, imgData.height);
    }
  }

  global.QRScannerManager = QRScannerManager;
})(typeof window !== 'undefined' ? window : global);
