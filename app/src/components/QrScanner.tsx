// Scan the desktop's pairing QR with the phone camera. Pure web: getUserMedia
// for the camera and jsQR to decode frames off a canvas, so there is no native
// plugin to compile, and the decode path is unit-testable in Node. iOS WKWebView
// grants the camera to the app when NSCameraUsageDescription is present (see
// Info.plist). If the camera cannot be opened, the sheet says so and the person
// falls back to typing or pasting, never a silent failure.
import { useEffect, useRef, useState } from 'react';
import { useSheetExit } from '../hooks/useSheetExit.js';
import { decodeQrFromImageData } from '../lib/qrDecode.js';

export function QrScanner({
  onDecode,
  onClose,
}: {
  /** Called once with the QR's text; the scanner closes itself after. */
  onDecode: (text: string) => void;
  onClose: () => void;
}) {
  const { closing, dismiss } = useSheetExit(onClose);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let done = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      if (done) return;
      const video = videoRef.current;
      if (video && ctx && video.readyState >= 2 && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const text = decodeQrFromImageData(img);
        if (text) {
          done = true;
          onDecode(text);
          dismiss();
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError('This device has no camera access here. Type or paste the pairing text.');
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        raf = requestAnimationFrame(tick);
      } catch {
        setError(
          'Could not open the camera. Allow camera access in Settings, or type or paste the pairing text.',
        );
      }
    })();

    return () => {
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`sheet-scrim${closing ? ' closing' : ''}`} onClick={dismiss}>
      <div className={`sheet${closing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h2>Scan the desktop QR</h2>
        <p className="sheet-sub">
          Point the camera at the QR on your computer's Desktop + phone screen. It fills in the
          address and token and connects.
        </p>
        {error ? (
          <p className="hint">{error}</p>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: '100%', borderRadius: 12, background: '#000' }}
          />
        )}
        <div className="sheet-actions">
          <button className="btn quiet press-fb" onClick={dismiss}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
