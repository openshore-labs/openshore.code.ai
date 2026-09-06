# Video attachments: frame by frame, never the video

A model never receives a video in OpenShore. When a person attaches a clip (a
screen recording, a bug repro, a short demo), the app compresses it natively if
it is large, samples it into a handful of stills, and hands those stills to a
vision model as ordinary image blocks. The model reviews the clip frame by
frame and can say so plainly. This is the same "Add context" flow as photos and
files (Camera, Photos, Files), with video folded in.

## The pipeline

1. **Pick.** The composer's Photos and Files pickers accept video as well as
   images (`app/src/components/Composer.tsx`, `AttachTray.tsx`). Screen
   recordings and screenshots come in the same way. There is no approval step:
   attaching is not a tool call.
2. **Detect.** `isVideoFile` (`app/src/lib/attachments.ts`) routes a video
   (by MIME, or by extension when the picker hands over a blank type, as screen
   recordings do) into the frame pipeline instead of the image path.
3. **Compress if large.** Over 30MB, the video is compressed toward the 25 to
   29MB band before framing (founder spec). The target is met natively:
   `fileLengthLimit` on `AVAssetExportSession` (iPhone) and a rate-capped FFmpeg
   pass (desktop). A clip at or under 30MB is framed as-is.
4. **Frame.** The clip is sampled into up to 12 downscaled JPEG stills (longest
   edge 768px), evenly spaced at slice midpoints so the first and last frames
   are never a black lead-in or tail. `planFrameTimes` in
   `app/src/lib/videoAttach.ts` is the sampling math, mirrored in the native
   backends.
5. **Attach.** Each still becomes an ordinary image `Attachment`
   (`frameAttachment`), tagged with its group, the video name, its order, and
   its timestamp. The composer shows one chip per video ("name . N frames"); the
   frames flow to the model as image blocks like any pasted screenshot.

Only the stills ever leave the device to a model. The video is read locally and
never uploaded.

## Where the pixel work runs

`pickVideoBackend` (`app/src/lib/videoBackends.ts`) chooses by platform, with
the canvas as a universal fallback so a video always yields frames somewhere:

- **iPhone:** the `OscodeMedia` Capacitor plugin
  (`app/plugins/oscode-media`), AVFoundation. `AVAssetExportSession` for the
  size band, `AVAssetImageGenerator` for the frames.
- **Desktop:** FFmpeg over the Electron bridge (`osc:mediaProcess` in
  `app/electron/main.ts`, driver in `app/electron/media.ts`). FFmpeg is invoked
  with an explicit argument array, never a shell string. If FFmpeg is not
  installed, the call fails and the renderer falls back to canvas framing
  (Chromium decodes most clips on its own), so the desktop still reviews the
  video, just without the size-targeted compression.
- **Web (dev and the browser demo):** a canvas over a hidden `<video>`, seeking
  and drawing each frame. No compression (the frames are downscaled regardless).

## Harnessing the model

Frames reach a vision model through the cloud Claude driver
(`app/src/drivers/cloudClaudeDriver.ts`, `buildVisionContent`), which is the
only vision path today (see `sourceSupportsVision`). For a video turn it:

- leads with a one-line context header naming the clip and calling the stills a
  frame-by-frame view, not the video itself;
- precedes each frame's image block with a short label ("Frame 2 of 8, at
  0:04");
- adds a system note (`VIDEO_FRAMES_SYSTEM_NOTE`) telling the model to read the
  stills as one clip in order, and that it may say plainly it reviewed the video
  frame by frame, kept brief.

## Knobs

The size threshold, target band, frame count, frame dimension, and JPEG quality
are constants in `app/src/lib/videoAttach.ts` (`VIDEO_COMPRESS_THRESHOLD_BYTES`,
`VIDEO_TARGET_MIN_BYTES` / `MAX` / `BYTES`, `VIDEO_MAX_FRAMES`,
`VIDEO_FRAME_MAX_DIM`, `VIDEO_FRAME_QUALITY`), passed to every backend through
`defaultFramePlan()`.

## Native verification (not possible in a web session)

The AVFoundation and FFmpeg paths need a device and a desktop to prove out. The
JS orchestration, the sampling and bitrate math, the frame assembly, and the
driver's frame labeling are covered by `app/test/videoAttach.test.ts`,
`app/test/attachments.test.ts`, and `app/test/cloudClaudeDriver.test.ts`. On
TestFlight: attach a screen recording over 30MB, confirm one chip appears with a
frame count, send to Claude, and confirm the reply reasons across the frames in
order. On the desktop with FFmpeg installed, the same with a picked video file;
without FFmpeg, confirm the canvas fallback still produces frames.

## Follow-ups

- A native PHPicker on iOS would avoid staging the video's bytes through the
  WebView (today a large clip is copied into the app cache before the plugin
  opens it). The plugin already reads a path, so this is a picker swap.
- Vision beyond cloud Claude: when a direct BYOM / OpenAI / Gemini vision chat
  or a vision pocket model lands, extend `sourceSupportsVision` and thread the
  frames through that driver too (the frames are already plain image
  attachments).
