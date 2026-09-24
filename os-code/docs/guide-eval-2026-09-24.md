# Guide eval results, 2026-09-24

Harbor Lite guide harness eval, run on the reference box. Two runs, one per model
tag. Each question is scored twice, once with the guide harness in front of the
model and once without it, so the pair shows what the harness is contributing.

## Machine

No NVIDIA GPU is present on this box, `nvidia-smi` is not installed, so both runs
are CPU only.

`lscpu | head -20`:

```
Architecture:                            x86_64
CPU op-mode(s):                          32-bit, 64-bit
Address sizes:                           39 bits physical, 48 bits virtual
Byte Order:                              Little Endian
CPU(s):                                  4
On-line CPU(s) list:                     0-3
Vendor ID:                               GenuineIntel
Model name:                              Intel(R) Core(TM) i5-7300U CPU @ 2.60GHz
CPU family:                              6
Model:                                   142
Thread(s) per core:                      2
Core(s) per socket:                      2
Socket(s):                               1
Stepping:                                9
CPU(s) scaling MHz:                      83%
CPU max MHz:                             3500.0000
CPU min MHz:                             400.0000
BogoMIPS:                                5399.81
Flags:                                   fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush dts acpi mmx fxsr sse sse2 ss ht tm pbe syscall nx pdpe1gb rdtscp lm constant_tsc art arch_perfmon pebs bts rep_good nopl xtopology nonstop_tsc cpuid aperfmperf pni pclmulqdq dtes64 monitor ds_cpl vmx smx est tm2 ssse3 sdbg fma cx16 xtpr pdcm pcid sse4_1 sse4_2 x2apic movbe popcnt tsc_deadline_timer aes xsave avx f16c rdrand lahf_lm abm 3dnowprefetch cpuid_fault epb pti ssbd ibrs ibpb stibp tpr_shadow flexpriority ept vpid ept_ad fsgsbase tsc_adjust bmi1 avx2 smep bmi2 erms invpcid mpx rdseed adx smap clflushopt intel_pt xsaveopt xsavec xgetbv1 xsaves dtherm ida arat pln pts hwp hwp_notify hwp_act_window hwp_epp vnmi md_clear flush_l1d arch_capabilities
Virtualization:                          VT-x
```

`free -g`:

```
               total        used        free      shared  buff/cache   available
Mem:               7           5           1           0           2           2
Swap:             11           5           6
```

## Runs

| Run | Model tag | Questions | Wall time | With the harness | Without |
| --- | --- | --- | --- | --- | --- |
| fp16 | `smollm2:135m` | 49 | 6174s | 94% | 89% |
| q4 | `smollm2:135m-instruct-q4_K_M` | 49 | 5905s | 94% | 90% |

Both runs were invoked with `--search` enabled.

### fp16, model tag `smollm2:135m`

Command: `pnpm --filter oscode-app eval:guide --search`

Result line: smollm2:135m, 49 questions, 6174s: with the harness 94%, without 89%.

Full output of `/tmp/guide-eval-fp16.txt`:

```

> oscode-app@0.1.0 eval:guide /home/openshore/openshore.code.ai/app
> tsx scripts/guide-eval.ts --search

stack          with  67%  without  67%  (missing reasoning)
reasoning-llm  with  67%  without 100%  (missing plan|route|orchestrat)
specialists    with 100%  without  67%
bench          with 100%  without  67%
marketplace    with 100%  without 100%
harbor-lite    with 100%  without  67%
harbor         with 100%  without 100%
deepblue       with 100%  without  67%
pair           with  67%  without  67%  (missing tailscale)
tailscale      with  67%  without  67%  (missing private|network)
cloud-key      with 100%  without 100%
repos          with 100%  without 100%
vault          with 100%  without 100%
crew           with 100%  without 100%
routines       with 100%  without 100%
currents       with 100%  without 100%
wayfinding     with 100%  without 100%
privacy        with 100%  without 100%
offline        with 100%  without 100%
modes          with 100%  without 100%
reach          with 100%  without  67%
switch         with 100%  without 100%
attach         with 100%  without 100%
voice          with 100%  without 100%
byom           with 100%  without 100%
launch         with 100%  without 100%
web-search-set with 100%  without 100%
skipped        with 100%  without 100%
marketplace-soon with  67%  without  67%  (missing coming soon|soon)
fit-8          with  67%  without  67%  (missing 3b)
fit-16         with 100%  without  67%
fit-4090       with  67%  without  67%  (missing 14b)
fit-mac        with  67%  without  67%  (missing 14b)
fit-unknown    with 100%  without  67%
phone-only     with 100%  without  75%
optimize       with 100%  without 100%
web-capital    with 100%  without 100%
web-news       with 100%  without 100%
web-howto      with 100%  without 100%
web-time       with 100%  without 100%
web-units      with 100%  without 100%
web-history    with 100%  without 100%
web-http       with 100%  without 100%
web-weather    with 100%  without 100%
stretch-code   with  67%  without  67%  (missing harbor|deepblue)
stretch-fix    with 100%  without 100%
stretch-essay  with 100%  without 100%
chat-hi        with 100%  without 100%
chat-thanks    with 100%  without 100%

smollm2:135m, 49 questions, 6174s: with the harness 94%, without 89%
```

### q4, model tag `smollm2:135m-instruct-q4_K_M`

Command: `pnpm --filter oscode-app eval:guide smollm2:135m-instruct-q4_K_M --search`

Result line: smollm2:135m-instruct-q4_K_M, 49 questions, 5905s: with the harness 94%, without 90%.

Full output of `/tmp/guide-eval-q4.txt`:

```

> oscode-app@0.1.0 eval:guide /home/openshore/openshore.code.ai/app
> tsx scripts/guide-eval.ts smollm2:135m-instruct-q4_K_M --search

stack          with  67%  without  67%  (missing reasoning)
reasoning-llm  with 100%  without  67%
specialists    with  67%  without 100%  (missing coding|writing|vision)
bench          with  67%  without 100%  (missing stack|place)
marketplace    with 100%  without 100%
harbor-lite    with 100%  without 100%
harbor         with 100%  without  67%
deepblue       with 100%  without  67%
pair           with 100%  without  67%
tailscale      with 100%  without  67%
cloud-key      with 100%  without 100%
repos          with 100%  without 100%
vault          with 100%  without 100%
crew           with 100%  without 100%
routines       with 100%  without 100%
currents       with 100%  without 100%
wayfinding     with 100%  without 100%
privacy        with 100%  without 100%
offline        with 100%  without 100%
modes          with 100%  without 100%
reach          with  67%  without  67%  (missing computer)
switch         with 100%  without 100%
attach         with 100%  without 100%
voice          with 100%  without 100%
byom           with 100%  without 100%
launch         with 100%  without 100%
web-search-set with 100%  without 100%
skipped        with 100%  without 100%
marketplace-soon with 100%  without  67%
fit-8          with  67%  without  67%  (missing 3b)
fit-16         with 100%  without  67%
fit-4090       with  67%  without  67%  (missing 14b)
fit-mac        with  67%  without  67%  (missing 14b)
fit-unknown    with 100%  without  67%
phone-only     with 100%  without  75%
optimize       with 100%  without 100%
web-capital    with 100%  without 100%
web-news       with 100%  without 100%
web-howto      with 100%  without 100%
web-time       with  50%  without 100%  (em dash)
web-units      with 100%  without 100%
web-history    with 100%  without 100%
web-http       with 100%  without 100%
web-weather    with 100%  without 100%
stretch-code   with  67%  without  67%  (missing harbor|deepblue)
stretch-fix    with 100%  without 100%
stretch-essay  with 100%  without 100%
chat-hi        with 100%  without 100%
chat-thanks    with 100%  without 100%

smollm2:135m-instruct-q4_K_M, 49 questions, 5905s: with the harness 94%, without 90%

real	98m26.650s
user	0m3.433s
sys	0m0.408s
```

## Lowest scoring questions with the harness

Lowest single score in either run is `web-time` on q4 at 50%, flagged for an em
dash in the answer. Everything else that fell short scored 67%.

Short on both runs: `stack`, `fit-8`, `fit-4090`, `fit-mac`, `stretch-code`.

Short on fp16 only: `reasoning-llm`, `pair`, `tailscale`, `marketplace-soon`.

Short on q4 only: `specialists`, `bench`, `reach`, `web-time`.

The `fit-*` cluster is the largest single group, three of the five fit questions
(`fit-8`, `fit-4090`, `fit-mac`) miss the expected parameter count on both runs.
