# The model library (founder, 2026-10-12)

The Marketplace is now a library of recommended models, laid out like an app
store and matched to the Stack. Each job has a shelf. Each shelf holds at most
one pick per size of machine. Every pick's license allows commercial use. Media
jobs (photo editing, video, transcription, voices, music and sound) are new
Stack slots, run by free programs on the person's own computer. A model the
library does not carry is one tap from the "Don't see your preferred model?"
sheet: bring your own, or ask support@openshore.ai to add it.

The code is the source of truth. This doc records the shape, the picks as
built, the licenses that need the founder, and what is still unverified.

## The ask and the rulings

The founder, with a screenshot of a chat that recommended small specialist
models for removing people from a photo (LaMa, SAM, an inpainting model, an
instruction editor):

> It needs to feel like the Apple AppStore with different categories that
> match the required categories for the stack. They can get super specific and
> targeted in the type of expertise or skills or abilities it provides.
> Keeping the main models as overall and reasoning categories. But I also want
> to limit the number of models per category we offer folks to download. And
> it needs to expand outside of just hugging face. It's truly the best for the
> parameter size and purpose of the stack, a true library of recommended
> models. There can be a button that says "don't see your preferred model?"

Three rulings followed:

- **The cap: one per device size.** A shelf holds at most one pick for each of
  phone, laptop (16 GB), workstation (48 GB) and server. The cap is in the data
  shape, so a fifth pick cannot exist.
- **Breadth: every kind of work, organized.** "Add photo editing now along with
  all of the other capabilities that ppl may be looking to use (video, voice,
  audio, music, etc). Think broadly about who a user might be and their niche
  use-cases (legal, music, math, science, health, etc). Be very organized and
  thoughtful. Don't overwhelm the marketplace but make it feel complete."
- **Sources: not limited, but commercial.** "Ollama library, GitHub Releases,
  Publisher's own site, Civitai, and others. I don't want it limited. The catch
  is it must have a license that allows for commercialization. I can work thru
  obtaining and maintaining the required licenses."

## The shape

Four layers, all in `os-code/src/market/library.ts` and shared with the app
through `os-code/protocol`:

1. **Sections** group the store front: Main models, Words and code, Pictures
   and video, Sound.
2. **Categories** are Stack slots, named as the Stack names them: Overall and
   Reasoning (the main models), Coding, Writing, Analysis, Retrieval, Fast,
   Image reading, Image creation, Photo editing, Video, Transcription, Voice,
   and Music and sound. Fourteen in all.
3. **Shelves** are jobs inside a category ("Remove objects", "Who said what",
   "Separate stems"). Thirty-three.
4. **Picks** are a shelf's models, keyed by size class. The catalog carries
   them as `library.picks`; the shelves, categories and collections are code,
   so an old catalog borrows them and a new one cannot invent a shelf.

**Made for** collections (Developers, Writers and editors, Lawyers and
paralegals, Health and care, Musicians and producers, and seven more) only
point at shelves that exist. A persona never adds a model of its own, so the
library stays one list.

### Size classes

| Class       | Machine                     | Largest download |
| ----------- | --------------------------- | ---------------- |
| Phone       | an iPhone, on the device    | 3.5 GB           |
| Laptop      | about 16 GB of memory       | 12 GB            |
| Workstation | about 48 GB, or a 24 GB GPU | 30 GB            |
| Server      | a rented or home server     | no cap           |

The builder refuses a pick over its class's cap. On a computer the store's
"Best for this computer" badge goes to the largest class that also passes the
store's own fit check (`fitsHere`), so the badge never marks a model the fit
pill calls too big. A shelf with no honest pick for a size leaves it empty:
video has no laptop pick, and several server picks are the workstation model
at a higher precision.

## The library as built

| Category        | Shelves and picks (phone / laptop / workstation / server)                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall         | Everyday: Qwen3.5 4B / Gemma 4 12B / Qwen3.8 27B / Qwen3.8 27B 8-bit. Long documents: Qwen3.5 4B / Qwen3.5 9B / Qwen3.8 27B / 8-bit. Health and medicine: MedGemma 1.5 4B (laptop), MedGemma 27B (workstation). |
| Reasoning       | Thinks it through: as Everyday. Plans and uses tools: Qwen3.5 4B / Qwen3.5 9B / Qwen3.8 27B / 8-bit.                                                                                                            |
| Coding          | Writes and fixes code: Gemma 4 12B / Qwen3.8 27B / 8-bit.                                                                                                                                                       |
| Writing         | Prose and copy, Translation: Gemma 4 12B / Gemma 4 26B.                                                                                                                                                         |
| Analysis        | Math: Qwen3.5 4B / 9B / Qwen3.8 27B / 8-bit. Science: Intern-S1 mini (laptop).                                                                                                                                  |
| Retrieval       | Search your files: Qwen3 Embedding 0.6B / 8B.                                                                                                                                                                   |
| Fast            | Instant replies: MiniCPM5 1B (phone), MiniCPM5 2B (laptop).                                                                                                                                                     |
| Image reading   | Photos and screenshots: Qwen3.5 9B / Qwen3.8 27B / Qwen3.5 122B. Documents and receipts: GLM-OCR.                                                                                                               |
| Image creation  | Make pictures: FLUX.2 klein 4B / HiDream-O1 Image Dev. Text, posters and screens: Z-Image Turbo / ERNIE-Image Turbo / Ming-Image Design.                                                                        |
| Photo editing   | Find and select: SAM 3.1. Remove objects: LaMa. Remove background: BiRefNet. Upscale and restore: Real-ESRGAN x4plus / SeedVR2 3B / SeedVR2 7B. Edit by asking: FLUX.2 klein 4B / Qwen-Image-Edit 2511.         |
| Video           | Text to video, Animate a picture: Wan 2.2 5B (workstation), Wan 2.2 14B (server).                                                                                                                               |
| Transcription   | Transcribe: Parakeet TDT 0.6B v3 / Granite Speech 4.1 2B. Any language: Whisper large-v3. Who said what: Nemotron Diarization with Parakeet.                                                                    |
| Voice           | Read aloud: Kokoro 82M. Many languages: VoxCPM2 (workstation). Your own voice: Chatterbox.                                                                                                                      |
| Music and sound | Make music: ACE-Step 1.5 Turbo / XL Turbo. Sound effects: Stable Audio 3 Small SFX / Medium. Separate stems: Demucs v4 (fine-tuned). Clean up a voice: DeepFilterNet 3.                                         |

Sixty-eight picks of 43 distinct models; no shelf holds more than four. The
catalog's other models stay for presets and released apps, off the shelves.

### Calls made along the way

- **IOPaint is out.** Its repository was archived on 2025-08-13. LaMa runs in
  ComfyUI through the `comfyui-inpaint-nodes` pack instead.
- **Legal and data analysis shelves are out.** The general models beat every
  legal specialist we found (SaulLM is from 2024; Lawma only classifies), and
  nothing had evidence for spreadsheets. Lawyers get a Made for collection of
  general shelves instead.
- **Art and photo pictures are one shelf** ("Make pictures"). The same models
  win both.
- **Discovery no longer fills shelves.** The builder's live Hugging Face
  discovery writes `candidates.json` for curators to read; only a curated pick
  reaches the library.
- **Civitai and a publisher's own site are allowed sources with no picks
  today.** No Civitai model we checked allows commercial use without strings
  that fail the bar (Juggernaut bars paid APIs; Illustrious and NoobAI are
  share-alike). A publisher's site is added host by host with its first model,
  never a wildcard.
- **Voice cloning needs a watermark.** "Your own voice" holds only Chatterbox,
  whose PerTh watermark marks every output. VoxCPM2 clones too but has none,
  so it sits on "Many languages" only. The rule is code
  (`WATERMARKED_VOICES` in `os-code/src/media/jobs.ts`), so no config file,
  project or catalog can mark another model watermarked. OpenShore has no
  sample or consent flow of its own: the person sets the voice up on their
  speech server, and the shelf says to copy only their own voice or one they
  have permission to use.

## Sources

Every host a download may start at is named once in
`os-code/src/market/sources.ts`, and the What leaves this device list reads it:

| Source                          | Hosts a file may start at              |
| ------------------------------- | -------------------------------------- |
| The Ollama library              | ollama.com, registry.ollama.ai         |
| Hugging Face                    | huggingface.co                         |
| The publisher's GitHub releases | github.com                             |
| Civitai                         | civitai.com                            |
| The publisher's own site        | none yet; one named host per publisher |

Weights go straight from the source to the person's machine. OpenShore never
rehosts or proxies them. Anyone can upload to these hosts, so the host proves
nothing about the bytes, and every file is pinned before it is published
(`scripts/build-catalog/pinFiles.ts`): a Hugging Face file to its repo's
commit and its LFS SHA-256, a GitHub release asset to the digest GitHub
publishes. A model with a file left unpinned is not published, its picks with
it. The downloader refuses a file with no SHA-256, follows only https
addresses off this network on every redirect hop, stops a file that runs past
its stated size, and keeps a file only once its SHA-256 matches.

## Media jobs and where they run

| Program                                        | Runs                                                 | Get does                                                                            |
| ---------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ComfyUI                                        | pictures, photo editing, video, music, sound effects | puts each file in ComfyUI's models folder, checked, and saves the graph for the job |
| A speech server in the OpenAI format (LocalAI) | transcription, who said what, voices                 | asks the server to fetch the model from its own gallery                             |
| audio-separator                                | separate stems                                       | checks the program is installed and says the install line if not                    |
| DeepFilterNet (`deepFilter`)                   | clean up a voice                                     | the same                                                                            |

OpenShore never installs a program, and the line it shows to install one is
fixed in code, never read from the catalog. Where each server is, and
ComfyUI's models folder, are machine config (Stack, Media servers), never a
project file. Get replaces a job's placement whole and fills a job only from
a shelf the model is a pick on. Six agent tools run the jobs
(`os-code/src/core/tools/media.ts`). Every prompt goes through the ethics
layer first (`MediaGuard`); every picture is labeled as AI-made; a video or
sound of an authorized likeness is refused because its format cannot carry
the label here; and a cloned voice runs only on Chatterbox.

A media server off this network (a rented machine, say) gets the file the
agent named, so the loop judges each call by the server its job is placed on
(`MediaHost.target`): it asks first on the amber card, once per task per
model; a vault file the privacy rules keep on this computer is not sent to
it; nothing is, once the chat holds a private note's text from a seat that
stays on this network; and a transcript read from such a file on this
computer comes back marked private. Such a server takes https only (plain
http is fine on this network and the tailnet), and the media clients follow
no redirect.

## Older apps

The library publishes as `catalog.v2.json`. `catalog.json` keeps serving apps
released before it: the builder narrows it to the models and fields they
understand (`scripts/build-catalog/v1.ts`). An app or engine that reads a
catalog without picks borrows the bundled library, and the app falls back to
the bundled catalog until the first library publish.

## Licenses the founder needs to act on

Each pick's conditions show on its product page. These need the founder or
counsel before release:

1. **Gemma 4** (Gemma 4 12B and 26B, and T5Gemma inside Stable Audio 3): the
   model cards say Apache 2.0, but the `gemma_4_license` page was not read.
   Confirm it before Gemma 4 ships as the laptop pick on five shelves.
2. **MedGemma** (Health AI Developer Foundations terms): commercial use is
   allowed, with Google's prohibited use policy passed on to users. Accept the
   terms, and keep the pick's "not for diagnosing or treating anyone" line.
3. **SAM 3.1** (SAM License): royalty-free commercial use, but the license
   travels with the model and bars military use and export violations. Accept
   it and approve the shipped text.
4. **Stable Audio 3** (Stability AI Community License): free under $1M of
   yearly revenue with registration at stability.ai; an Enterprise license
   above that. Register Open Shore LLC, and decide whether the shelf stays
   when revenue nears the line.
5. **Attribution**: Parakeet TDT 0.6B v3 and WeSpeaker are CC BY 4.0, and the
   diarization model is OpenMDW-1.1. The attribution lines are in the catalog;
   add them to `NOTICE` or the app's acknowledgements.
6. **Apache and MIT notices** for every other pick, in the same place.
7. **Files a pick pulls from another repository**: each must now name its own
   license, or the builder holds its model back
   (`scripts/build-catalog/fileLicenses.ts`). Two need you: confirm the FLUX.2
   VAE's Apache 2.0 on its card (named so, as BFL released it), and the
   lightx2v Lightning LoRA's license, which names none yet, so Qwen-Image-Edit
   2511 is not published until it does.
8. **Held for counsel, not in the library**: LTX-2.5 (community license under
   $10M, and a use policy against competing with Lightricks), Qwen3.8-Flash-Next
   (Qwen Community License with an assistant carve-out), and VibeVoice-ASR
   (Microsoft, research and development only).

Excluded outright for non-commercial or territorial terms: FLUX.1 dev, Kontext
and Fill, FLUX.2 dev and klein 9B, MusicGen, YuE, MMAudio, TangoFlux, AudioLDM
2, F5-TTS, Fish, XTTS-v2, Spark-TTS, RMBG, 4x-UltraSharp, GFPGAN, HunyuanVideo
and HunyuanImage, MiniMax H3, SD 3.5 and Krea 2.

## Unverified until a device run

- Each ComfyUI graph on a real ComfyUI 0.39 (the node names come from the
  official templates), the LaMa node pack, and SAM 3.1's text prompt.
- LocalAI's diarization answer shape, and each gallery id.
- DeepFilterNet's package on a current Python (its last release is 2023).
- The phone picks' GGUF files in the iOS llama.cpp build (Qwen3.5 and
  MiniCPM5 architectures).
- BFL's fp8 file for FLUX.2 klein 4B without a gate, and every Ollama tag,
  Qwen3.8's 8-bit tag above all.
- The first `catalog.yml` run that publishes `catalog.v2.json`, and its pins:
  each Hugging Face file's commit and SHA-256, and GitHub's digest for LaMa's
  2022 release asset. If GitHub gives none, LaMa is not published until a
  curator pins its SHA-256 in the seed.

## Follow-ups

- A paired phone's Stack shows the computer's media placements.
- Transcript cards for a media job's output.
- A speech server fetches a model from its own gallery. The model downloads
  entry in What leaves this device says so without naming LocalAI's hosts;
  whether to name them is open.
- A per-pick eval on the reference box before any copy calls a pick faster or
  better (tenet 2). Today the picks rest on published benchmarks.
- From the security review, built 2026-10-13: the published catalog is
  signed in CI and checked against a pinned key
  (`os-code/src/market/catalogSignature.ts`; you run
  `node app/scripts/release-keygen.mjs catalog`, save the private half as the
  `CATALOG_SIGNING_KEY` secret, then pin the public half); every clip and
  sound is labeled AI-made and edits are marked edited
  (`os-code/src/core/ethics/mediaProvenance.ts`); an edit's mask is judged by
  permission rules; a file made from a private one stays private for the
  session; the desktop Stack shows what the media jobs made, with Clear; and
  Remove can delete the files Get wrote for a model, never one you had or
  another model uses. The ethics layer reads text, so an input picture is
  screened by its file name with the words; no classifier looks at the
  picture itself.
