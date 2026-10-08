// Scan the desktop's pairing QR with the phone camera. Pure web: getUserMedia
// for the camera and jsQR to decode frames off a canvas, so there is no native
// plugin to compile, and the decode path is unit-testable in Node. iOS WKWebView
// grants the camera to the app when NSCameraUsageDescription is present (see
// Info.plist). If the camera cannot be opened, the sheet says so and the person
// falls back to typing or pasting, never a silent failure.
import { useEffect, useRef, useState } from 'react';
import { decodeQrFromImageData } from '../lib/qrDecode.js';
import { Sheet } from './Sheet.js';
import { SheetTitle } from './SheetHead.js';

/** The scanner as a house sheet: it rises, drags down, answers Escape, and
 *  plays its exit like every other sheet. The camera runs only while the
 *  sheet is on screen. */
export function QrScanner({
  open,
  onDecode,
  onClose,
}: {
  open: boolean;
  /** Called with each QR's text. True when it was a pairing code (the
   *  scanner closes itself); false keeps the camera running and says so in
   *  the sheet, so a wrong QR never ends the scan (CX 2026-10-01). */
  onDecode: (text: string) => boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetTitle>Scan the QR on your computer</SheetTitle>
      <p className="sheet-sub">
        Point the camera at the QR on your computer's Computer screen. It connects by itself.
      </p>
      <Camera onDecode={onDecode} onClose={onClose} />
      <div className="sheet-actions">
        <button className="btn quiet press-fb" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/** Said in the sheet when the camera sees a QR that is not a pairing code. */
export const FOREIGN_QR =
  "That QR is not an OpenShore pairing code. Point the camera at the one on your computer's Computer screen.";
/** Said when the camera cannot be opened. */
export const CAMERA_BLOCKED =
  'Could not open the camera. Allow camera access for OpenShore in Settings, or type the address and pairing code from your computer.';

function Camera({
  onDecode,
  onClose,
}: {
  onDecode: (text: string) => boolean;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | undefined>();
  const [foreign, setForeign] = useState(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let done = false;
    // The last foreign QR, so one held in view is reported once, not every frame.
    let lastForeign: string | undefined;
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
        if (text && text !== lastForeign) {
          if (onDecode(text)) {
            done = true;
            onClose();
            return;
          }
          lastForeign = text;
          setForeign(true);
        }
      }
      raf = requestAnimationFrame(tick);
    };

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError(CAMERA_BLOCKED);
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        // Closed while the camera was still opening: let it go at once.
        if (done) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        raf = requestAnimationFrame(tick);
      } catch {
        setError(CAMERA_BLOCKED);
      }
    })();

    return () => {
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return error ? (
    <p className="hint">{error}</p>
  ) : (
    <>
      <video ref={videoRef} className="qr-scanner-video" playsInline muted />
      {foreign ? (
        <p className="hint" role="status">
          {FOREIGN_QR}
        </p>
      ) : null}
    </>
  );
}
