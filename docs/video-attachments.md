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
never uploaded. While a clip is being read, the composer chip shows a
determinate ring that fills as frames land (done/total): real per-frame progress
on the canvas path, a single step to done on the native paths that return the
set in one call. Before a decoder knows the frame count the chip shows a soft
pulse instead of a false-empty ring.

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

## Vision routing (the stack)

Vision is a placeable Stack category ("Image reading"), so a person can put a
model in it the same way they place a coder or a writer. An image-bearing turn
routes by capability, not by the text classifier
(`pickVisionRef`/`stackVisionReady` in `app/src/lib/stack.ts`, wired in
`StackDriver`):

1. a reachable, capable model placed in the vision category, else
2. the reasoning anchor if it can read images, else
3. any reachable capable model already in the stack, else
4. a connected, reachable cloud provider that reads images (Claude out of the
   box), the founder's "if there isn't one available and capable it can go to a
   cloud provider."

An on-device model cannot read images on this build (the local runtime is
text-only), so `visionCapable` returns false for a device ref and a local model
placed in vision falls back to the cloud. Flip the device case in
`visionCapable` when a multimodal on-device runtime lands. `StackDriver` folds
the frames into the current user turn for the Anthropic and OpenAI-compatible
backends (frame labels and header included); the device backend never receives
images. The composer's attach button lights for a "My Stack" chat exactly when
`stackVisionReady()` says a picture would be understood.

### The two Vision slots, in My Stack

The Stack manager shows Image reading (Vision) as a dedicated card with two
slots (`visionSlots` in `stack.ts`, edited in `StackManager.tsx`):

- **On device**: a model on the phone or your own server (device or BYOM). A
  BYOM vision model actually reads images and is preferred over the cloud slot;
  a device model falls back to the cloud until on-device image reading ships.
- **Cloud**: a cloud model that reads images. It defaults to the most capable
  cloud model (`defaultVisionCloudRef`, Claude Opus) until a person assigns
  one, so images are always understood out of the box.

Each slot carries its own **effort** (`Placement.effort`, honored in
`StackDriver.systemFor` over the global composer effort). "My Stack is the
source": a workflow that runs through the stack (a crew routine on the app path)
uses whatever the Vision position holds, so there is one place to set it.
Effort is now settable on any specialist placement, not just Vision.

## Harnessing the model

Frames reach cloud Claude directly through the cloud Claude driver
(`app/src/drivers/cloudClaudeDriver.ts`, `buildVisionContent`), and through the
stack via `StackDriver` (which reuses `buildVisionContent` for its Anthropic
path). For a video turn it:

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
- On-device vision: wire a multimodal runtime into the `oscode-llama` plugin,
  then flip the device case in `visionCapable` so a local vision model placed in
  the stack actually reads the frames instead of falling back to the cloud.
- Direct cloud vision chats: `sourceSupportsVision` already covers a
  vision-capable cloud model on its own driver; the stack path covers "My
  Stack." A direct Gemini/OpenAI vision chat outside the stack is the remaining
  gap.
