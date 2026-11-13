# Brief: FINDER GREEN home, image and video assets (2026-11-13)

Not interviewed in full. The user said to go ahead within a 500-credit budget, picked "7 to 8 stills and one background clip", and picked where they go: the first screen and mood shots of the three products. Everything else below is authored from the project (`AGENTS.md`, `MASTER.md`).

## The eight topics
1. **Vibe**: calm, precise, premium, natural. Pine, Sage and Ivory only (the logo kit). Early morning on a course, mist, dew. No people.
2. **Journey**: the page already exists (slogan and the first step of an estimate, five steps, three figures, three ways to ask, closing). The assets serve the first screen only; the rest of the page is typographic and stays so.
3. **Energy curve**: the first screen is the one quiet moment of atmosphere; the rest stays calm.
4. **Feeling and the one moment**: arriving on the course before the day starts. The remembered moment is the slow drift over the misty green while the first step of an estimate waits in front of it.
5. **A thing no other site does**: the estimate itself is the product; the footage only sets the place.
6. **Range**: premium-minimal, editorial.
7. **One world or distinct scenes**: one place (the course at dawn) shown once as footage and as stills; no continuous flight.
8. **Assets owned**: none. Everything below is generated (BAZE gateway, commercial use belongs to the user per BAZE's output-rights page).

## Hard rules for these assets
- No logos, lettering or emblems on any product (the first sunglasses still had an emblem on the temple and was redone).
- The three products are mood only, never a claim about a real product or its quality. No fake clients, reviews or figures.
- The clip plays once and holds its last frame (no loop); with reduced motion the poster frame is shown.
- Every generated file carries a small "AI" badge at the bottom right, added by the gateway. Whether it may be cropped is not settled (see the handoff).

## Assets (all in `assets/`, raw files in `raw/`)
| File | What | Model | Credits |
|---|---|---|---|
| `hero-fairway.mp4` (+ poster `.webp`) | 5 s slow drift over a misty fairway, 1248x704, no audio | `bytedance/seedance-1.0-pro/fast` from the still below | 108.9 |
| `hero-fairway.webp` | the still the clip starts from, 1024x576 | `fal-ai/flux-2-pro` | 30 |
| `product-sunglasses.webp` | plain green-tinted sunglasses on an ivory towel, 4:3 | `fal-ai/flux-2-pro` | 30 (+30 for the first try, unused) |
| `product-shoes.webp` | plain white and sage golf shoe, 4:3 | `fal-ai/flux-2-pro` | 30 |
| `product-tees.webp` | wooden tees and a ball, 4:3 | `fal-ai/flux-2-pro` | 30 |
| (unused) `probe-green.png` | first test still, a tee standing in the cup | `fal-ai/flux-2-pro` | 30 |

Spent 289 of 500; 211 left (2026-11-13).

## Applied (2026-11-13)
The clip and its poster are in `assets/media/` and on the home (hero background, a line in the footer saying the images are AI mood images). The three product photos on the home (rows and order-size cases) are the user's own replacement images (`choice-*.webp`, `moq-*.webp`), not the BAZE stills in `assets/` here, which are unused.

## Process photos (2026-11-13, evening)
Five stills for the five steps of "첫 견적부터 출고까지", one art direction kept in `scrollcraft/art-direction.json` (preamble + one scene each; run `node baze.mjs still <out.png> --art <scene> --model fal-ai/flux-2-pro --ar 4:3`): ivory linen on a pale oak bench, soft north-window daylight, Pine and Sage only, no text, logos or people. Raw files in `raw/process-*.png` (1024x768, the gateway's "AI" badge bottom right, not cropped); the page uses 960x720 webp in `assets/media/process-*.webp`, one per step, inside the step panel.

| Step | Scene key | File |
|---|---|---|
| 견적 요청 | `material` (swatches, lens samples, wood blocks) | `process-material.webp` |
| 사양 협의 | `spec` (sunglasses, blank spec sheet, tape, colour chips) | `process-spec.webp` |
| 샘플 확인 | `sample` (plain white golf shoe, mesh offcut, caliper) | `process-sample.webp` |
| 제품 생산 | `production` (tray of turned wooden tees, shavings, lathe out of focus) | `process-production.webp` |
| 검수·출고 | `dispatch` (plain kraft boxes with tees and sunglasses, blank clipboard) | `process-dispatch.webp` |

5 x 30 credits, no re-rolls. **2.3 credits left** (a still is 30: a top-up is needed for the strip of other goods, the closing image or any re-roll). The numbers on the tape measure of the second still are faintly legible; nothing else carries text.
