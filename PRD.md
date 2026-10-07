# THE FINAL EXPEDITION — Product Requirements & Production Plan

| | |
|---|---|
| **Document status** | DRAFT **v0.2**, awaiting approval. No implementation starts until this is approved. |
| **Date** | 2026-10-04 |
| **Revision goal (v0.2)** | Reach the highest **AAA-perceived** visual and cinematic quality possible in a **100% browser-based** game built only with **free tools** and **free, legally safe assets**. |
| **Build audited** | `the-final-expedition` v0.1.0 (Chapter 1 vertical slice) |
| **Canonical story source** | `STORY_BIBLE.md` v1.0 (LOCKED). Story, characters, pillars and creative identity are unchanged. Proposed bible changes are listed only in §45, and none take effect until approved. |

### The question this PRD answers

> **"With no paid tools, and a game that must run in a browser, what is the highest visual and cinematic quality we can realistically reach, and exactly how do we build it?"**

**Short answer** (expanded in §1):
- Browsers can render images that *read* as premium: sunset-lit ruins, a believable climber, a waterfall that moves. Budget hardware sets the limit, not the engine.
- The quality gap between this build and the reference games is ~80% **assets, lighting, animation and staging**, all of which can be made with free tools. Only ~20% is **engine features**.
- So the plan:
  1. Fix performance and architecture.
  2. Build a real Ines and a real animation pipeline in Blender.
  3. Rebuild Chapter 1 as a hand-authored, light-baked, art-directed template.
  4. Benchmark four engines on identical assets before locking the engine.
  5. Only then build Chapters 2–5.

---

### Classification tags (used throughout)

Every proposed tool, asset source, feature or technique carries one tag:

| Tag | Meaning |
|---|---|
| 🟢 **FREE + SAFE** | Free, licence verified as compatible with a public browser build, no open conditions |
| 🟡 **FREE + VERIFY** | Free, but the licence has conditions (attribution, per-asset licences, extraction clauses, revenue caps) or wasn't verified from the primary source. **Must be verified and logged in `ASSET_LICENSES.md` before use** |
| 🔴 **NOT FREE** | Requires payment or a paid subscription for our use. **Not used.** |
| ⛔ **NOT BROWSER COMPATIBLE** | Can't run in, or export to, a normal browser. **Not used.** |
| 🐢 **NOT WORTH THE PERFORMANCE COST** | Technically possible in a browser, but the cost per visual gain is too high for our budgets (or allowed only on ULTRA) |

> **Licence verification status:** the licence facts in this document come from web research on **2026-10-04** (sources in Appendix C). They are a *pre-screen*. Before any item is used, its primary licence page must be re-read and logged in `ASSET_LICENSES.md` (§33). Licences change: Unity's 2023 pricing change is a precedent.

---

## Table of contents

**Part I: Vision**
1. Executive Summary
2. Product Vision
3. AAA Perceived Quality ★ new
4. Game Pillars
5. Target Player Experience
6. Creative Direction
7. Visual Direction & Composition
8. Lighting Direction ★ new
9. Material Direction ★ new
10. Character Design Direction
11. Animation Direction
12. Camera Language

**Part II: Gameplay & Presentation**
13. Gameplay Overview
14. Core Gameplay Loop
15. Traversal System
16. Exploration & Environmental Storytelling
17. Puzzle System
18. Cinematic System
19. Combat / Action System
20. Environmental Interaction
21. Water, Foliage & Atmosphere
22. VFX Library ★ new
23. Audio
24. UI / UX
25. Save / Load

**Part III: Technology**
26. Engine Decision ★ new
27. Visual Quality Presets (LOW / MEDIUM / HIGH / ULTRA)
28. Performance Requirements & Budgets
29. Browser / Technical Requirements
30. Architecture

**Part IV: Pipelines**
31. Free AAA-Quality Toolchain ★ new
32. Asset Sources & Licence Pre-Screen ★ new
33. Asset Licensing Workflow ★ new
34. Asset Pipeline
35. Character Pipeline
36. Animation Pipeline
37. Environment & Level Pipeline
38. Lighting Pipeline ★ new
39. Cinematic Pipeline
40. VFX Pipeline ★ new
41. Audio Pipeline
42. Hero Asset Strategy ★ new

**Part V: Content**
43. Chapter Structure
44. Chapter 1 Visual Rebuild Plan ★ new
45. Story Bible Review

**Part VI: Current State**
46. Current Implementation Audit
47. Known Problems
48. Technical Debt
49. Remaining Features

**Part VII: Plan & Quality Gates**
50. Production Phases
51. Implementation Order & Difficulty
52. Milestones
53. Testing / QA Plan
54. Visual Benchmark Scene ★ new
55. AAA Visual Acceptance Test ★ new
56. Performance Validation
57. Definition of Done (incl. AAA-perceived visual quality)
58. Risks & Fallbacks
59. Future Improvements

**Appendices**
- A: Audit evidence log
- B: Decisions required
- C: Licence research log

---

# PART I — VISION

## 1. Executive Summary

**Where the build stands (verified 2026-10-04; Appendix A):**

- **Chapter 1 plays end-to-end.** The build type-checks and bundles cleanly. The automated playtest covers every Chapter 1 system.
- **The "50/50 checks, 60 FPS" claim doesn't hold up.** The suite has **51** checks. Unmodified, it fails on Windows at check 3, because it hard-codes a macOS GPU flag and Chrome falls back to software rendering. With a Windows backend on this Intel UHD laptop it scored **39/51 at 1600×900** and **50/51 at 800×450**. The failures come from the simulation slowing below 20 FPS while the tests wait in wall-clock time.
- **Performance is the main hidden problem:** **12–15 FPS at 1600×900 on every preset**. LOW still draws **1.0–1.2 M triangles in ~270 draw calls**.
- **Visual quality is "procedural prototype":**
  - mannequin characters (17 bones, no fingers or face, one roughness value forced on every material);
  - box-built ruins;
  - a grid-regular city vista;
  - a flat-reading waterfall;
  - climbable walls that look like painted slabs.
- **Collision proxies don't match the visuals.** Some props have none, and traversal moves bypass collision entirely.
- **The architecture is good:** chapters, saves, input, cinematic skip safety and an animation abstraction. Extend it rather than rewrite it, unless the engine benchmark (§54) says otherwise.

**What "AAA-perceived" means here:** see §3. In one line, *visual impact per polygon and per millisecond*, achieved through art direction, lighting, hero assets, animation and staging, not polygon counts.

**Engine recommendation:** **Three.js stays provisionally**, with a planned move to its WebGPU renderer (automatic WebGL 2 fallback). **Babylon.js** is the strongest challenger, and **Unity 6 Web** has the best authoring tools but the heaviest browser runtime. **Godot's web export isn't recommended** for this project: on the web it only has the WebGL 2 "Compatibility" renderer, and no WebGPU. The weighted pre-benchmark scores are close (Three.js 7.8, Babylon.js 7.8, Unity 7.1, Godot 5.8; §26), so **the final lock is decided by the Visual Benchmark Scene (§54)**. A challenger must clearly beat Three.js on measured visuals *and* performance to justify a rewrite.

**Toolchain recommendation (all free):** Blender, MakeHuman, Krita, GIMP, Material Maker, ArmorPaint (built from source), Audacity, LMMS/Surge XT, gltf-transform, KTX-Software, meshoptimizer. **Assets:** Poly Haven, ambientCG, Kenney, Quaternius, CMU mocap and Freesound (CC0/CC-BY only). Details in §31–§32.

**Production order** (as requested, with one recommended adjustment; §50):

1. Performance + architecture.
2. Final Ines.
3. Animation pipeline.
4. Rebuild the Chapter 1 environment.
5. Lighting/material/VFX/audio polish.
6. Cinematic system.
7. Engine benchmark.
8. Lock engine/toolchain.
9. Chapters 2–5.
10. QA.
11. Demo.

**Recommended adjustment:** run the benchmark (Phase 7) **right after Phase 2**. Phases 4–6 are mostly engine-specific *code* (shaders, lighting integration, cinematic runtime), and they would be thrown away if the benchmark picks a different engine. All *assets* (models, textures, animation, audio) are engine-agnostic, so no art is lost either way.

---

## 2. Product Vision

A grounded, human-scale adventure about a woman following her grandmother's impossible letter into a hidden city, and choosing to keep the secret her grandmother kept. It plays in a browser tab with no install. It should feel like a premium *game*, not a tech demo: responsive movement, readable traversal, deliberate camera work, film-like staging, and a story told mostly through places and objects.

- **Format:** a ~2.5–4 h linear-with-pockets cinematic adventure (estimate; validated by the final Chapter 1 playtime) across 5 chapters plus an epilogue.
- **Not:** an open world, a shooter (§19), a physics sandbox, or a reproduction of any existing franchise.

The reference titles benchmark *perceived quality, pacing, traversal readability and camera language* only.

---

## 3. AAA Perceived Quality

### 3.1 Definition

**The game feels premium because:**

| # | Driver | What we do |
|---|---|---|
| 1 | Strong art direction | One visual bible (§7–§9); every location has a palette, key light and landmark |
| 2 | Composition | Every gameplay space is designed from authored camera viewpoints (§7.2) |
| 3 | Believable materials | Full PBR with variation: albedo/roughness/normal/AO/wetness/dirt/edge wear (§9) |
| 4 | High-quality lighting | Baked light + one dynamic sun + per-shot cinematic rigs (§8, §38) |
| 5 | Strong silhouettes | 64-px silhouette test for characters and landmarks |
| 6 | Detailed hero assets | 20% of assets get 80% of art time (§42) |
| 7 | High-quality characters | A real topology/rig/texture pipeline (§35) |
| 8 | Believable animation | Mocap-based clips + IK + secondary motion (§11, §36) |
| 9 | Cinematic camera language | Shot grammar, authored framing (§12) |
| 10 | Environmental storytelling | Every space answers *who was here / what happened / what changed / why care* (§16) |
| 11 | Atmospheric depth | Layered fog, aerial perspective, mist planes (§21) |
| 12 | Foliage density & variation | Multiple species, sizes, tints and LODs; no visible repeats (§21) |
| 13 | Convincing water | Flow maps, depth fade, foam, lip geometry (§21) |
| 14 | Particles & VFX | A pooled, depth-aware library synced to animation and audio (§22) |
| 15 | Environmental interaction | Foliage, water and dust react to characters (§20) |
| 16 | Animation/VFX/audio sync | Animation events drive footstep audio, dust and camera (§36.4) |
| 17 | Polished cinematics | Film-staged scenes with character tracks (§18, §39) |
| 18 | Strong sound design | Recorded/CC0 foley + synthesized beds + adaptive score (§23, §41) |
| 19 | Consistent visual identity | Shared trace kit, material library and grade per chapter |
| 20 | Excellent transitions | No hard snaps: gameplay↔cinematic blends, loading masked by fades |
| 21 | Visual hierarchy | Light and contrast lead the eye to objective → path → detail |

### 3.2 What AAA is **not** for us

- ❌ millions of polygons everywhere;
- ❌ massive open worlds;
- ❌ thousands of unique assets;
- ❌ photorealism at any cost;
- ❌ effects that break the frame budget on HIGH, or make LOW unplayable.

### 3.3 The governing metric

> **Visual impact per polygon and per millisecond of GPU time.**

Every visual feature proposal must state:
- its GPU cost (ms on the mid reference machine, §28);
- its preset availability;
- the visual problem it solves.

Features rejected on this basis are tagged 🐢.

### 3.4 Measurable translation

"Looks AAA" is judged by the **AAA Visual Acceptance Test (§55)**:
- a fail-condition checklist;
- blind panel ratings on fixed frames;
- a screenshot test with no UI;
- automated checks (foot float, pose pops, camera clipping, frame time).

---

## 4. Game Pillars

| # | Pillar | Practice | Measure |
|---|---|---|---|
| P1 | **Read the land** | Routes found by looking: ribbons, pitons, chalk, light | ≥90% of first-time testers find each route without a hint within target times |
| P2 | **Solve by observing** | Clues live in the world | All solutions derivable from in-world clues; median solve 2–8 min |
| P3 | **The past is a place** | 1958 as objects and traces | ≥5 dialogue-free story beats per chapter |
| P4 | **Grounded danger** | Rock, water, gravity, people's choices | No mechanic contradicts bible §2 |
| P5 | **Cinematic but playable** | Authored camera, player in control | Non-interactive time ≤15% of a chapter; all cinematics skippable; no hard snaps |
| P6 | **Runs in a tab** | Integrated GPUs at LOW, premium at HIGH | §28 budgets met |
| P7 | **Premium by craft** *(new)* | Quality comes from art direction, lighting, hero assets, animation and staging | §55 passed for every chapter |

---

## 5. Target Player Experience

**Audience:** players who like story-led adventure games, and demo/hackathon visitors playing 5–15 min on laptops.

**Arc per chapter:** curiosity → unease → effort → revelation. Every chapter ends on a reveal (bible §7).

**Sessions:** chapters of 25–50 min, with checkpoints every 3–7 min. Never lose more than ~5 min of progress.

**Accessibility:**
- subtitles on by default (exists);
- remapping (exists);
- hold/toggle sprint;
- camera shake slider (exists);
- reduce-motion option;
- DOF toggle;
- escalating hints (exists);
- colour-independent puzzle cues;
- no mash QTEs.

---

## 6. Creative Direction

**Tone:** mysterious, adventurous, grounded; dry, character-driven humour (bible §2, §12). **Storytelling hierarchy:**
1. the environment;
2. objects and documents;
3. short radio exchanges;
4. cinematics at turning points.

**Original-IP guardrails** (apply to every asset, line and level):
- Nothing traceable to a commercial game: characters, names, costumes, locations, set-pieces, dialogue, music, UI.
- References set *quality bars*, not content.
- Every third-party asset is logged *before* merge (§33).
- At each milestone, a "look-alike review" compares hero silhouettes, set-pieces and key art against the reference franchises (Risk R12).

---

## 7. Visual Direction & Composition

**Look:** stylised realism: believable materials, light and scale, art-directed rather than photo-real.

### 7.1 Per-location visual language

| Location | Ch. | Key light & time | Palette | Landmark / composition | Atmosphere |
|---|---|---|---|---|---|
| River landing | 1 | Late afternoon after rain, low warm sun | Wet greens, firelight orange, steel-blue water | Fire + boat as a warm pocket against the cold river | River mist, drips |
| Jungle trail | 1 | Dappled shafts | Moss green, ochre litter | Stelae every ~40 m as wayfinders | Height fog, fireflies, pollen |
| Camp Four | 1 | Dusk, cooling | Faded canvas khaki, rust, chalk white | Theodolite aimed at the ridge = the composition arrow | Stillness: insects only |
| Red-rock cliff & falls | 1 | Raking sun on red rock | Red/ochre rock, white water, red ribbons | Ribbons as a dotted line up the cliff | Spray, gusts |
| Gate of the Watching Sun | 1 | Setting sun to the left (puzzle clue) | Pale limestone, gold sun | Gate framed by murals; sun over the left shoulder | Dust, thin air |
| Upper terraces | 2 | **TBD** (bible SB-06: in-world time) | Limestone, emerald overgrowth | Aqueducts lead the eye down | Cloud layers inside the gorge |
| Sun-shafts & mirror chambers | 3 | Shafts of sunlight only | Near-black stone, bronze, gold beams | Light *is* the path | Dust motes in beams |
| Central gorge & great bridge | 4 | Harsh daylight → dust | Bleached stone vs. the crew's orange/hi-vis | The bridge as one readable line | Blast dust, debris |
| Sanctum of the Sunlock | 5 | Noon beam | Bronze, wet stone, crystal light | The Sunlock as a vertical mechanism | Spray, rising water |
| Tamsa Alta | Ep. | Soft overcast | Highland earth tones, textiles | Village square | Quiet, wind, voices |

### 7.2 Composition rules (every gameplay space)

1. **Three planes:**
   - **Foreground:** hero props with full material detail (framing, scale cues).
   - **Midground:** the gameplay space, with clear affordances.
   - **Background:** a landmark silhouette with atmospheric depth (fog/aerial perspective).
2. **An authored "establishing view"** per space: a designer-placed camera hint (exists as `CameraHint`) that frames the space on entry. That frame is reviewed as a screenshot with no UI.
3. **One landmark always visible** for orientation.
4. **Visual hierarchy by light:** the brightest/most contrasted element is the objective or the path. Secondary detail sits in mid-values. Dead space sits in shadow or fog.
5. **No grid-regular placement** of buildings, trees or rocks. Placement uses hand-placement or Poisson-disc scatter with authored exclusion and accent zones.
6. **No identical hero repeats in one frame.** Repeated modular pieces must vary by rotation, scale (±15%), tint, decals and damage.
7. **No generic boxes as hero architecture.** Ruins are modelled with chamfers, erosion and damage.
8. **Traversal affordance language:**
   - climbable rock = chalk-dusted, lighter, with ribbons/pitons, integrated *into* the cliff mesh (no slabs);
   - grabbable ledges = a consistent pale worn lip;
   - jumps = an aligned landing with a visible edge.

   No glowing UI paint.
9. **The 1958 trace kit** recurs across chapters: ALDERCOTT 1958 stencils, DO NOT SHIP chalk, rusted pitons, faded rope, "M.K.", glass plates, film tins.

---

## 8. Lighting Direction

Lighting is a **primary visual system**. It guides traversal, puzzles, landmarks, emotion and reveals.

### 8.1 Lighting model

| Layer | Approach | Tag |
|---|---|---|
| Key (sun/moon) | One dynamic directional light with cascaded or texel-snapped shadows (texel snapping exists). Per-chapter angle/colour | 🟢 |
| Sky / ambient | Image-based lighting from a per-zone environment map (prefiltered, PMREM): CC0 HDRIs from Poly Haven, or captured in-engine | 🟢 |
| Static indirect + AO | **Baked lightmaps and AO in Blender (Cycles)** for hero static geometry (camp, ruins, gate, interiors), stored as KTX2 on a second UV set | 🟢 |
| Indirect on dynamic objects | Small spherical-harmonics probe grid baked offline (Blender bake → JSON); characters sample the nearest probes | 🟢 |
| Contact shadows | GTAO (exists) + baked AO + character "capsule AO" blobs under feet | 🟢 |
| Fill / rim in gameplay | Shader-level rim/fresnel on characters; **remove** the camera-following point lights (current hack) once character materials are real | 🟢 |
| Cinematic rigs | Per-shot key/fill/rim lights as cinematic tracks (§39) | 🟢 |
| Local lights | Firelight, lanterns, the Lens. Max 4 shadowless point lights in view (LOW: 1); max 1 shadowed point light (HIGH+) | 🟢 |
| Atmospheric perspective | Height fog with sun in-scatter (exists) + per-chapter fog colours | 🟢 |
| God rays | Billboarded light shafts (exist) + screen-space radial scatter on HIGH+ | 🟢 |
| Volumetric fog (froxel) | WebGPU ULTRA only, or not at all | 🐢 on LOW/MED/HIGH |
| Real-time GI (SSGI / ray-traced) | — | 🐢 |
| Screen-space reflections | ULTRA only, on water and wet stone | 🐢 below ULTRA |
| Exposure | Auto-exposure (luminance histogram/average, clamped per zone; essential for Ch3 interiors) | 🟢 |
| Tone mapping & grading | ACES or AgX tone mapping (exists: ACES) + a per-chapter **3D LUT** grade, authored in Krita/GIMP on a neutral LUT strip | 🟢 |

### 8.2 Chapter lighting identities

| Ch. | Identity | Guide-light role |
|---|---|---|
| 1 | Golden dusk after rain, warm key / cool shadows | The setting sun *is* the puzzle clue; warm light marks the ribbon route |
| 2 | Morning mist burn-off (pending SB-06) | Sunlit aqueduct water leads downward |
| 3 | Darkness + hard sunbeams | Beams are the puzzle and the path |
| 4 | Harsh overhead → dust-choked orange | Clear sky gaps mark escape routes |
| 5 | Cool sanctum → noon beam climax | The Lens beam is the emotional and puzzle focus |
| Ep. | Overcast softness | No hard light; calm |

### 8.3 Lighting acceptance

- Every hero frame (§55) is judged **with UI off**: a lit-only debug view must show a clear key/fill/rim relationship.
- Characters must keep ≥ 20% luminance separation from the background in gameplay framing (measured on the §55 frames). A silhouette that disappears is a fail.
- No visible shadow acne, peter-panning or cascade seams in hero frames.
- No light leaks at baked seams.

---

## 9. Material Direction

### 9.1 Rules

- **Never** one roughness value across a character or environment. (The current `CharacterAvatar` override of `roughness = 0.78` is removed.)
- Every material has **albedo, normal, roughness and AO**, plus metalness where relevant. Textures are packed (ORM: occlusion/roughness/metalness in R/G/B).
- Variation layers:
  - macro albedo variation (world-space noise);
  - roughness breakup;
  - detail normal at close range;
  - decals (dirt, moss, stains, chalk, stencils);
  - a **wetness mask** (darkens albedo, lowers roughness);
  - a **dirt mask** (cavity/AO-driven);
  - **edge wear** (curvature-baked).
- **Texel density:**
  - hero props 1024 px/m;
  - characters 1024–2048 px/m on the face;
  - environment 512 px/m;
  - background 128–256 px/m.

  Checked with a debug checker view.
- **Wetness system (Ch1 "after rain"):** a global wetness parameter + per-material response + a puddle mask + a rain-streak mask on vertical surfaces. Applied through a shared material function (🟢).

### 9.2 Required material library (v1.0)

| Material | Base source | Variation | Tag |
|---|---|---|---|
| Wet rock / dry rock (red cliff, grey limestone) | ambientCG/Poly Haven CC0 scans + Material Maker blends | Moss mask (up-facing), wetness, streaks, chalk | 🟢 |
| Moss | CC0 scans | Thickness via up-vector + AO | 🟢 |
| Mud | CC0 scans | Puddles, footprint decals | 🟢 |
| Carved limestone (Ysharu) | CC0 base + hand-painted glyph height maps (Krita) | Edge wear, lichen, soot | 🟢 |
| Bronze | Material Maker procedural | Patina (verdigris in cavities), polish on edges/handles | 🟢 |
| Rusted metal (pitons, stove, crates' bands) | CC0 + Material Maker | Rust gradient, flaking | 🟢 |
| Leather (boots, satchel, harness) | Material Maker / CC0 | Creases, scuffs, darkened wear zones | 🟢 |
| Canvas (tents, Ines's jacket) | CC0 fabric + Material Maker weave | Water stains, fade, mud hems | 🟢 |
| Cloth (linen, cotton, wool) | Material Maker weaves | Sheen (MeshPhysicalMaterial `sheen`) | 🟢 |
| Wood (crates, table, boat) | CC0 scans | Stencils, chalk, rot, wet edges | 🟢 |
| Glass (theodolite lens, plates, Toby's glasses) | Physical material | Dust, scratches | 🟢 |
| Skin | Hand-painted + CC0 detail normals | Subsurface approximation (wrap lighting + thickness map), pore detail normal, roughness map (oily T-zone), dirt/sweat masks | 🟢 |
| Water | Custom shader | Flow maps, depth colour, foam, refraction approximation | 🟢 |

---

## 10. Character Design Direction

All characters are original and follow bible §3. **Silhouette first:** each must be identifiable as a 64-px black silhouette.

| Character | Silhouette hook | Bible-locked details | Materials |
|---|---|---|---|
| **Ines Kovač** (36) | Climber's shoulders, low hair knot, satchel on the hip, harness loops | Dark auburn hair; **pale scar through the left eyebrow**; olive-drab field jacket with rolled sleeves; rust-orange base layer; grey-brown cargo trousers; worn leather boots; canvas satchel; waxed envelope inside the jacket | Canvas, leather, nylon webbing, aluminium carabiners, skin |
| **Toby Mensah-Reyes** (38) | Tall, bucket hat, round glasses, banded notebook | Hinge taped, short twists, linen shirt, too many pens | Linen, cotton, plastic/metal |
| **Corwin Aldercott** (52) | Tailored expedition gear, upright posture | Silver temples, neat beard, brass pocket compass | Technical fabrics, brass |
| **Dace Holloway** | Heavy utility, demolitions vest | Ex-contractor look, **no real-world insignia** | Cordura, steel |
| **Crew (2–4)** | Hi-vis/orange modern gear | One shared rig + variants | — |
| **Elderly woman (Tamsa Alta)** | Epilogue | Highland clothing; **cultural-design review** required | Wool, woven textile |
| **Marta** | Photographs only (2D) | 1958 field clothing | — |

**Backpack vs satchel:** the current model wears a large backpack; the bible says satchel. Proposal SB-11: satchel + small daypack, or satchel only.

### 10.1 Ines character specification (target)

| Element | Requirement |
|---|---|
| Proportions | ~1.70 m, ~7.5 heads, climber's shoulders/forearms. Validated against a CC0 MakeHuman base |
| Topology | Clean quad topology with edge loops at the eyes, mouth, shoulders, elbows, knees and knuckles; deformation-tested at the extremes of all clips |
| Face | Readable eyes, brows, nose and mouth at 2.5 m; **eyebrow scar** modelled in the normal map *and* visible in albedo |
| Eyes | Separate eyeballs: sclera, iris and cornea (with specular highlight); eye-look rig; wetness line optional on HIGH+ |
| Teeth/tongue | Included (simple), because close-ups with an open mouth are planned (gate reaction, Ch5 recording) |
| Hair | Hair-card mesh (low knot + flyaways), alpha-to-coverage on MSAA presets, alpha-test fallback; anisotropic-style specular approximation |
| Clothing | Layered: base layer, jacket (rolled sleeves as geometry), trousers with knee wear, harness straps, satchel with strap, boots with laces and sole thickness |
| Equipment | Harness with gear loops, 2–3 carabiners, chalk bag, radio (clips to her shoulder strap; matters for radio gestures) |
| Hands | Full 5-finger rig (3 bones per finger) for ledge grips, mechanism handles and holding the letter/journal |
| Body language | A distinct idle (weight on one leg, scanning look-at), a cautious edge idle, determined climbing |
| Materials | Separate skin / hair / cloth / leather / metal response (§9). **No global roughness** |
| LODs | LOD0 cinematic ≤ 45k tris (face + hair heavy); LOD0 gameplay ≤ 25k; LOD1 ≤ 10k; LOD2 ≤ 3k |
| Textures | Head 2048² (4096² on ULTRA); body 2048²; hair 1024²; gear atlas 2048². KTX2. Max 4 materials |

### 10.2 Character close-up quality gates (cinematic shots)

A character **fails** a close-up review if any of these is true:

- [ ] It reads as a mannequin: no visible pores/skin variation, lifeless eyes, or uniform material.
- [ ] Eyes don't track the scene's look-at target (error > 5°) or never blink (blink interval must be 2–8 s, randomized).
- [ ] The face is static during dialogue (no brow/jaw/eye motion within any 3 s line).
- [ ] Visible mesh stretching at the neck/shoulders/fingers in the shot.
- [ ] Hair cards show hard edges or sorting artefacts.
- [ ] Hands interpenetrate held props by > 1 cm, or float off them by > 1 cm.
- [ ] Specular on skin looks plastic (a uniform highlight across the face).
- [ ] The scar isn't visible in Ines's close-ups.
- [ ] Clothing has no wear/dirt variation.
- [ ] A blind panel scores the "believable human" rating < 4/5 (§55).

---

## 11. Animation Direction

Movement is **animation-driven**. Intent selects and blends clips, and procedural layers fit them to the world.

### 11.1 Ines clip set (v1.0)

| Group | Clips |
|---|---|
| Locomotion | idle (+3 idle breaks), walk, jog, run/sprint, walk/run starts, run stops (L/R foot), turn-in-place 90/180, pivot turns, slope lean (additive), tired breathing (additive) |
| Air | jump start (stand/run), rise, apex, fall loop, land soft/hard, land-to-run, optional roll |
| Climb | climb idle, climb up/down/left/right (+diagonals blended), climb-to-hang, hang idle, shimmy L/R, climb-up (pull/knee/stand), drop-to-hang, hang-drop, corner in/out |
| Narrow ledge | ledge idle, step L/R, enter/exit (orientation must match the design) |
| Contextual | vault low/high, step-up, push/turn mechanism, pick up low/mid/high, examine crouch/stand, look-through (theodolite), squeeze through, push through foliage (upper-body additive), rope traverse/rappel (Ch2) |
| Story | sit, talk gestures ×3, radio-to-mouth (additive), recoil/brace, react-to-reveal, kneel-and-read |
| Facial | blink, eye look, brow up/down/furrow, smile/frown, jaw open, squint, plus 6–8 viseme-like shapes if voiced (§23) |

### 11.2 Procedural & secondary layers

| Layer | Spec | Tag |
|---|---|---|
| Foot IK | Two-bone IK with ground raycasts, pelvis offset, foot locking during stance | 🟢 |
| Hand IK | Hands to ledge grab points, handles, held props | 🟢 |
| Look-at IK | Head/neck/chest weighted, clamped; eye look-at separate | 🟢 |
| Lean | Turn lean (exists) + acceleration lean | 🟢 |
| Breathing | Additive, scaled by exertion; amplified after climbs | 🟢 |
| Blinking | Random 2–8 s; double-blinks; blink on camera cuts | 🟢 |
| Secondary motion | Spring bones for the hair knot, satchel, carabiners, radio, jacket hem (verlet chains, ≤ 12 bones total on Ines) | 🟢 |
| Cloth simulation | **Real-time cloth sim** on whole garments | 🐢 (use authored spring bones + baked folds instead) |
| Hair simulation | Strand hair | 🐢 (spring-bone hair cards instead) |

### 11.3 Measurable animation criteria

| Criterion | Target |
|---|---|
| Pops | No major-bone rotation change > 15° in one frame outside authored hits |
| Foot sliding | Planted-foot drift ≤ 4 cm per stance phase on flat ground |
| Floating feet | Foot-to-ground gap ≤ 3 cm on slopes ≤ 30°; ≤ 6 cm on steps |
| Crossfades | Locomotion 0.15–0.3 s; traversal entries 0.1–0.2 s |
| Latency | First visible motion ≤ 100 ms (ground), ≤ 150 ms (traversal) |
| Hand placement | Hand-to-ledge distance ≤ 5 cm while hanging/shimmying |
| Stops | Foot-phase-matched; never mid-stride freezes |
| Facial liveliness | Blink interval 2–8 s; eye saccades during idles; no static face in dialogue |

---

## 12. Camera Language

The camera is a deliberate operator. It directs attention and never shakes without a cause. Inspired by the *grammar* of premium third-person adventures, not by any specific game's shots.

### 12.1 Gameplay camera modes

| Mode | Framing rule | Exists? |
|---|---|---|
| Exploration | Over-the-shoulder, 3.5–4 m, character on the left or right third, horizon on the upper third | Yes (tune) |
| Traversal (climb/hang) | Pull out to 4.2–5 m, slight side offset to show the next hold; pitch shows the drop | Yes (tune) |
| Narrow ledge | Side-on along the wall, drop visible | Yes |
| Puzzle | Stable wide framing of the mechanism + the clue; reduced sway | New |
| Landmark reveal | When entering a reveal volume: slow yaw/pitch nudge (≤ 15°) toward the landmark + FOV widen ≤ 6°, if the player isn't touching the mouse | New (extends hints) |
| Conversation (in-world) | Soft two-shot bias toward the speaker | New |
| Set-piece chase | Pulled-back chase camera, authored splines, forward look-ahead | New (Ch2/Ch4) |

### 12.2 Cinematic shot grammar (cinematics)

- **Establishing wide** → **medium** → **close-up** escalation for reveals.
- **Over-the-shoulder** and **two-shots** for dialogue.
- **Low angle** for scale and threat (Dace, the Sunlock); **high angle** for vulnerability (Ines alone in Ch4).
- **Reveal shots:** a foreground occluder slides away, or the character turns to camera, then the landmark is revealed.
- **Rack focus** (DOF focus animation, exists via `focus`) between character and clue.
- **Subtle handheld:** low-frequency noise ≤ 0.3° on cinematic cameras (exists as `sway`); none on locked-off establishing shots.
- **Controlled FOV:** 35–50° cinematic; gameplay base FOV is a user setting; changes ≤ 10°/s outside cuts.
- **Transitions:** cut, eased blend (0.3–1.0 s), whip-pan cover, or a fade through black. Never accidental snaps (the current instant cut into cinematics is fixed in Phase 1).

### 12.3 Collision & occlusion

Sphere-cast spring arm; handles a pivot inside geometry (currently ignored by `rayBox`); thin occluders (trunks/vines/foliage) fade or dither instead of pulling the camera in.

### 12.4 Acceptance

- The near plane never intersects collision or terrain in a 10,000-sample sweep.
- The player is never fully occluded > 0.5 s.
- No gameplay frame-to-frame jump > 0.5 m without a cut.
- No shake without a trauma event.

---

# PART II — GAMEPLAY & PRESENTATION

## 13. Gameplay Overview

Third-person, linear chapters with optional pockets. Verbs:
- walk/run/sprint, jump, climb, hang, shimmy, narrow ledge, vault, assisted jump;
- interact (examine, pick up, operate), read, talk (radio and in person).

Chapter-specific verbs are added only where the story requires them: rope traverse/rappel (Ch2), mirror rotation (Ch3), timed escape (Ch4), under-pressure mechanism (Ch5).

There's no inventory beyond collectibles and story items, and no health bar. Failure means a fade and a checkpoint respawn (exists).

## 14. Core Gameplay Loop

```
EXPLORE → TRAVERSE → SOLVE → REVEAL → (next space)
```

- **Micro (30–90 s):** affordance → traversal → feedback (sound, camera, line).
- **Meso (5–10 min):** space → clue → solve → checkpoint.
- **Macro (chapter):** narrative question → pressure → bible §7 reveal.

## 15. Traversal System

**Current (verified):**
- Authored climb rectangles, ledges with climb-up ranges, narrow ledges, vault blocks and jump links.
- Mode state machine in `Player.ts`.
- Climb/hang/shimmy/narrow/assisted jump/vault/fall-respawn all pass the playtest.

**Gaps:**
- Linear-scan queries.
- No collision during traversal.
- Rectangles/segments only (no corners or curves).
- Climb walls look like separate slabs.
- Mounts and climb-ups are position lerps, so hands and feet don't contact geometry.

**Requirements:**

| Feature | Requirement | Phase |
|---|---|---|
| Polyline ledges + corners | Inside/outside corner shimmy; curved ledges | 3–4 |
| Ledge hop / jump-to-ledge | ≤ 1.8 m horizontal, ≤ 1.2 m up, with an arc validation tool | 4 |
| Rope traverse / rappel / rope bridge | Bible Ch2 | 9 (Ch2) |
| Balance beam, collapsing surfaces | Ch2/Ch4 | 9 |
| Spatial index | ≤ 0.1 ms per frame with 300 elements | 1 |
| Motion warping | Clip root motion warped to authored anchors (hands land on ledge points) | 3 |
| Affordance art | Climbable rock integrated into cliff meshes; `CLIMB_` proxies authored in Blender | 4 |
| Validation overlay | Draw all traversal data + reachability | 1 |

Grapple, stamina and swimming aren't in the bible, so they're **not planned**. Swimming vs. wading for Ch5 is decision D10.

## 16. Exploration & Environmental Storytelling

### 16.1 Systems
- Collectibles with locked canon text (registry exists).
- An "observations" journal tab for examined clues.
- 1–3 optional pockets per chapter, never required.
- Wayfinding by landmark, ribbon and light. Minimap optional (D7).

### 16.2 The four questions

**Every major area must answer:** *Who was here? What happened? What changed? Why should the player care?* Each area gets a **story-trace sheet** before art begins:

| Area | Who was here | What happened | What changed | Why care | Trace inventory (min.) |
|---|---|---|---|---|---|
| River landing | Toby (now); 1958 porters (past) | The porters turned back here | A modern boat beside 1958 mooring posts | Ines's safety line, literally the radio | Mooring posts, porters' cut rope, Toby's camp |
| Jungle trail | Someone after 1958 | The trail was recut | Machete-cut stumps of different ages | Someone keeps this secret | Old vs. new cut stumps, stelae, a 1960s-style tin |
| Camp Four | The 1958 team | Abandoned in a hurry (SB-02) | Nature reclaimed it; crates sealed | Marta lived here | Dinner set, chalked crates, roster board, theodolite, Marta's cot with photo tins, footprints in dried mud (cast) |
| Cliff | The route keeper(s) | Route maintained for decades | New knots on old pitons | Someone is still protecting it | Pitons of 3 ages, ribbons of varying fade, a wrapped knot style (reused in the finale) |
| Gate | Ysharu; Marta | The gate was opened, then resealed (SB-03) | Drums set to the water-sign | Marta stood here: "M.K." | Initials, chalk sketch marks, tool scratches on the drums |
| Ch2–5 areas | Defined in each chapter's beat chart | — | — | — | ≥ 8 traces each |

### 16.3 Trace kit (reusable props/decals)
- footprints (1958 hobnail vs. modern lug sole);
- chalk marks and stencils;
- pitons/ribbons;
- photographs, film tins, glass plates;
- crates; tents; tools;
- the crew's survey stakes, cables and drill rigs (Ch3–4);
- weathering decals (moss creep, water stains, soot).

**Density target:** ≥ 1 readable story trace per 15 m of critical path.

## 17. Puzzle System

**Current:** the `Puzzle` base + `RotatingDrumsPuzzle`; persisted; escalating hints. The solution matches the bible (right-to-left Rising / Open Eye / Setting; Serpent decoy).

**Requirements:**
- data-driven puzzle definitions;
- a shared hint ladder (environment → Ines observes → Toby nudges → explicit), with an assist-mode setting;
- resettable, with no dead states;
- validated on restore;
- per-action feedback (animation + sound + camera micro-trauma).

| Ch. | Puzzle | Status |
|---|---|---|
| 1 | Gate drums | Implemented |
| 2 | None in the bible; optional light environmental puzzle | **TBD — DESIGN REQUIRED** |
| 3 | Bronze-mirror light redirection with the sky-houses | **TBD — DESIGN REQUIRED** (rooms) |
| 4 | None (set-piece) | — |
| 5 | Re-seat the Lens; realign the triggers as noon passes, with NPC help | **TBD — DESIGN REQUIRED** |

## 18. Cinematic System

**Current:**
- Camera-path shots (Catmull-Rom, look interpolation, FOV, ease, sway, focus);
- timed events;
- skip that still fires world-state events;
- eased blend-out, letterbox, DOF;
- four sequences.

**Gaps:**
- Camera-only: characters are teleported and loop a single clip.
- Instant cut into cinematics.
- Sequences are code.
- No audio, light or facial tracks.

**Target:** film-staged scenes. Characters move naturally, look at the right things, react, gesture and handle props. Nobody stands and loops. The runtime track list is in §39.

**Major cinematic list (v1.0, staged as film scenes):**

| Ch. | Scene | Characters | Key staging needs |
|---|---|---|---|
| 1 | Opening: valley descent → Toby at the fire | Ines, Toby | Two-shot at the fire, Toby's gestures, Ines checks the radio, envelope prop |
| 1 | Theodolite sighting | Ines | Hand IK on the instrument, eye-to-eyepiece, POV rack focus |
| 1 | Gate opening | Ines | Brace reaction, dust VFX sync, look-at the gate, rumble audio |
| 1 | City reveal | Ines (radio) | Slow push past Ines to the vista, radio-to-mouth, breath |
| 2 | Plate cache discovery | Ines | Kneel, unwrap, hold a plate to the light, rack focus to the image |
| 2 | Aqueduct collapse | Ines | Set-piece camera, brace/fall reactions |
| 3 | Inner-wall decipherment | Ines, Toby | Two-shot, Toby tracing glyphs with a finger, reaction shots |
| 4 | Crew arrival; betrayal; Corwin's argument; the blast; separation | All | Multi-character blocking, emotional close-ups |
| 5 | The 1979 recording; Corwin breaks; Dace's grab; the Sunlock settles | All | Longest performance scene; facial tracks essential |
| Ep. | Tamsa Alta; montage; grave; ribbon | Ines, elder | Quiet staging, the final ribbon shot |

## 19. Combat / Action System

The bible implies no combat: danger is "rock, water, gravity, and other people's choices"; Dace is "the physical threat" (§3).

**Proposed:** **no combat system**. Action comes through set-pieces. The Dace confrontation is an authored struggle/chase with contextual inputs and generous timing, and no mash QTEs. **TBD — DESIGN REQUIRED.** (SB-12.)

## 20. Environmental Interaction

| Interaction | Current | Requirement | Tag |
|---|---|---|---|
| Foliage reaction | Shader push from the player + a trail point | GPU interaction field, multi-actor (§21.2) | 🟢 |
| Footsteps | 8 synthesized surfaces | Recorded/CC0 samples + particles per surface, driven by animation events | 🟢 |
| Water entry | None | Wading, splashes, wet-cloth darkening (30 s dry-off) | 🟢 |
| Mechanisms | Drums, gate | Generic mechanism component with sound/shake/animation hooks | 🟢 |
| Debris/destruction | Gate dust | Pre-fractured, keyframed collapse pieces (Ch4); **no** general rigid-body destruction | 🟢 (full physics destruction 🐢) |
| Footprints | None | Mud decals (≤ 64 pooled); authored crew boot prints | 🟢 |
| Weather | None | Rain (Ch1 optional, the "after rain" drip layer), mist, dust | 🟢 |

## 21. Water, Foliage & Atmosphere

### 21.1 Water

| Feature | Spec | LOW | MED | HIGH | ULTRA | Tag |
|---|---|---|---|---|---|---|
| Flow | Flow-map UV advection (two-phase) on the river, streams and aqueducts | ✓ | ✓ | ✓ | ✓ | 🟢 |
| Normals | 2 scrolling detail normals + flow | 1 layer | ✓ | ✓ | ✓ | 🟢 |
| Reflections | Env-map reflection (zone probe) | ✓ | ✓ | ✓ | + SSR | 🟢 / SSR 🐢 below ULTRA |
| Refraction | Screen-space distortion of the scene colour copy | — | ✓ | ✓ | ✓ | 🟢 |
| Depth fade & colour | Uses the scene depth (available in PostFX) | ✓ | ✓ | ✓ | ✓ | 🟢 |
| Shoreline foam | Depth-difference foam + noise | ✓ | ✓ | ✓ | ✓ | 🟢 |
| Ripples / splash interaction | Ripple decals from actors + a small ripple render target on HIGH | decals | decals | RT | RT | 🟢 |
| Waterfall | 2–3 flow-mapped sheets, noise edge breakup, **lip geometry** (overflow curl), contact strip on rock, impact foam, spray column, mist, pool disturbance | 1 sheet | 2 | 3 | 3 + camera droplets | 🟢 |
| Wet surfaces | Wetness masks near water + spray zones | ✓ | ✓ | ✓ | ✓ | 🟢 |
| Fluid simulation | — | — | — | — | — | 🐢 |

**Waterfall budget:** ≤ 8 draw calls, ≤ 0.8 ms GPU on the mid machine.

**Acceptance:**
- a blind panel rates it "moving water" ≥ 4/5;
- its frame cost is within 1 ms of the same view without it (HIGH, mid machine).

### 21.2 Foliage

| Feature | Spec | Tag |
|---|---|---|
| Species | ≥ 8 understory species in Ch1 (ferns ×2, broadleaf ×2, grass ×2, bromeliads, palms/tree ferns) + ≥ 4 tree species. **Modelled in Blender** from CC0 photo-textures (Poly Haven / ambientCG / own photos) | 🟢 |
| Variation | Random rotation, ±20% scale, hue/value tint, density noise, per-species clumping rules | 🟢 |
| Wind | Hierarchical: trunk sway, branch, leaf flutter (vertex colour masks) | 🟢 |
| Player & NPC interaction | GPU interaction field: a 128² top-down render target around the focus; actors write velocity discs; a spring/damper decay pass; foliage bends by **rotation around its pivot**; strength scales with speed | 🟢 |
| Response | Bends within 100 ms within 1.2 m; recovers in 0.8–2 s, ≤ 2 oscillations | — |
| Audio/particles | Rustle one-shots from the field; leaf bursts on a sprint (MED+) | 🟢 |
| LODs | Per species: LOD0 mesh, LOD1 reduced cards, LOD2 **impostor** (octahedral impostor atlas baked in Blender/in-engine) | 🟢 |
| Per-leaf physics | — | 🐢 |

### 21.3 Atmosphere

| Feature | LOW | MED | HIGH | ULTRA | Tag |
|---|---|---|---|---|---|
| Height fog with sun in-scatter (exists) | ✓ | ✓ | ✓ | ✓ | 🟢 |
| Layered mist planes / cloud sheets (soft, depth-faded) | 1 layer | 2 | 3 | 4 | 🟢 |
| Dust motes / pollen / fireflies (GPU points) | 30% | 60% | 100% | 150% | 🟢 |
| Rain (streak particles + ripple decals + wetness) | streaks only | ✓ | ✓ | ✓ | 🟢 |
| God-ray cards (exist) | ✓ | ✓ | ✓ | ✓ | 🟢 |
| Screen-space radial light scatter | — | — | ✓ | ✓ | 🟢 |
| Froxel volumetric fog (WebGPU compute) | — | — | — | experimental | 🐢 below ULTRA |
| Audio sync | Ambience layers keyed to the same zones (e.g. mist zone = damp, muffled bed) | ✓ | ✓ | ✓ | 🟢 |

## 22. VFX Library

**Rules:**
- every effect is **pooled**;
- particles are simulated on the **GPU** (closed-form or texture-based);
- **soft/depth-faded** where they meet geometry;
- triggered by **animation/audio events**, so all three stay in sync;
- **scaled by preset** (count, resolution, lifetime).

| Effect | Used in | Trigger | LOW/MED/HIGH/ULTRA count scale | Tag |
|---|---|---|---|---|
| Footstep dust / mud splat / leaf kick | All | Anim foot events | 0.3 / 0.6 / 1 / 1.5 | 🟢 |
| Landing impact (dust ring) | All | Land event (height-scaled) | ✓ | 🟢 |
| Climb grab chalk/dust puff | All | Hand grab events | ✓ | 🟢 |
| Rock debris (small) | Ch1–5 | Mechanisms, collapses | ✓ | 🟢 |
| Collapse debris (large, keyframed chunks + particles) | Ch2, Ch4 | Set-piece timeline | ✓ | 🟢 |
| Leaves (falling, burst) | Ch1–2 | Ambient + foliage field | ✓ | 🟢 |
| Water spray / waterfall mist / splash | Ch1–2, 5 | Ambient + actor ripples | ✓ | 🟢 |
| Rain | Ch1 (optional), Ep. | Weather state | ✓ | 🟢 |
| Fire (flipbook flames + emissive + embers) | Ch1 camp | Ambient | ✓ | 🟢 |
| Smoke (soft, lit by the sun direction) | Ch1 fire, Ch4 blasts | Ambient/timeline | ✓ | 🟢 |
| Sparks | Ch4 drills/blast, Ch5 mechanism | Timeline | ✓ | 🟢 |
| Sunlight motes in beams | Ch3, Ch5 | Inside beam volumes | ✓ | 🟢 |
| Explosion (flash + shock dust + debris) | Ch4 | Timeline | ✓ | 🟢 |
| Lens light (bloom-friendly caustic) | Ch5 | Puzzle state | ✓ | 🟢 |
| Fluid/smoke simulation (grid) | — | — | — | 🐢 |

**Flipbook sources:** made in Blender (render smoke/fire sims to flipbooks: 🟢, our own output) or EmberGen/paid tools (🔴, not used).

---

## 23. Audio

**Current:** fully synthesized WebAudio:
- ambience layers and spatial river/falls;
- surface footsteps;
- mechanisms, UI and radio;
- a generative adaptive score (moods `title / explore / tension / wonder`), pause ducking and reverb.

All original. That's the strength.

**Weakness:** synthesized foley (footsteps, cloth, impacts) caps perceived quality.

**Upgrade plan:**

| Area | Requirement | Source | Tag |
|---|---|---|---|
| Footsteps | 4–6 variants per surface × walk/run/land/scuff, pitch/volume jitter, animation-event-driven | Freesound CC0, Sonniss GDC bundle, Kenney, own recordings | 🟢 / 🟡 |
| Cloth & gear | Jacket rustle, harness jingle, satchel thumps on movement | Own recordings (phone + Audacity), CC0 | 🟢 |
| Climbing | Hand grabs on rock, scrapes, exertion breaths (non-verbal) | Own recordings, CC0 | 🟢 |
| Rock contact & debris | Impacts by size, rolling pebbles | CC0 / Sonniss | 🟢 / 🟡 |
| Water | Layered by distance: far roar → mid rush → near splashes; wading | CC0 / Sonniss + synth bed (exists) | 🟢 / 🟡 |
| Foliage | Rustles driven by the interaction field | CC0 / own | 🟢 |
| Mechanisms | Grind/settle/clunk stacks per mechanism | CC0 + synth layering (exists) | 🟢 |
| Ambience | Keep synth beds; add recorded jungle beds (CC0) | CC0 | 🟢 |
| Reverb zones | Convolution IRs per zone: open valley, cliff, gate plaza, gorge, caves, sanctum. IRs generated or recorded | Own / CC0 IRs | 🟢 |
| Distance & occlusion | Distance models (exist); occlusion low-pass via raycast against collision proxies (≤ 4 rays per emitter per 100 ms) | — | 🟢 |
| Stingers | Reveal and discovery stingers (original, composed) | Original | 🟢 |
| Music | Keep the adaptive engine; add per-chapter themes + a "Marta" motif; transitions on musical boundaries (bar-quantized) | Original (LMMS/Surge XT → OGG stems) | 🟢 |
| Dialogue | v1.0 subtitles + radio filter (exists). VO is decision D8 | — | — |
| Mix | Dialogue bus with 6 dB music duck; master at -16 LUFS integrated; no master clipping | — | 🟢 |

**Synchronization rule:** animation events fire audio + VFX + camera micro-shake from one event bus message, so they can't drift apart.

## 24. UI / UX

**Exists:** loading, menu, pause, settings with rebinding, HUD, journal with sketch, minimap, end card, touch controls (`TouchProvider.ts`, undocumented in the README).

**Add:**
- chapter select;
- objective on demand;
- journal tabs (Pages / Relics / Photographs / Observations);
- gamepad UI navigation;
- accessibility options;
- credits (needed for CC-BY attribution).

**Measurable:**
- every menu works by keyboard only and by gamepad only;
- no subtitle overlap at 720p/1080p;
- contrast ≥ 4.5:1.

**UI transitions:** eased 200–400 ms. The chapter card → load → fade-in never shows a frozen frame for > 2 s.

## 25. Save / Load

**Exists (verified):**
- autosave on checkpoint, tab hide and unload;
- manual save;
- Continue = the latest of auto and manual;
- versioned schema, migrations, validation, corrupt-save backup;
- per-system `Persistable` registry;
- exact-position restore when safe.

**Add:**
- a profile store (unlocked chapters, lifetime collectibles, settings) separate from run saves;
- real chapter progression into Ch2+;
- migration fixtures per schema bump;
- a 1,000-cycle save fuzz with 0 corrupt or soft-locked states.

localStorage is enough. IndexedDB is only for the optional asset cache.

---

# PART III — TECHNOLOGY

## 26. Engine Decision

### 26.1 Candidates and verified facts (2026-10-04)

| Engine | Licence | Web rendering | WebGPU | Key facts | Overall tag |
|---|---|---|---|---|---|
| **Three.js** (current, r186) | MIT | WebGL 2 (`WebGLRenderer`) and `WebGPURenderer` with automatic WebGL 2 fallback; TSL node shaders compile to WGSL/GLSL | Production-ready since r171 (per the three.js team and community reports) | Library, not an editor. Our custom GLSL (`onBeforeCompile` patches, EffectComposer passes) would need porting to TSL for WebGPU | 🟢 |
| **Babylon.js** (9.x) | Apache-2.0 | WebGL 2 + WebGPU engines; core shaders in both GLSL and WGSL since 8.0 | Yes; 9.0 (Mar 2026) adds clustered lighting on both backends and WebGPU-compute volumetric lighting | Richer built-ins: Inspector, node material/particle editors, IK controller, GPU particles, physics plugin | 🟢 |
| **Unity 6 (Personal) Web** | Proprietary, free under **$200k annual revenue + funding**; splash screen optional since Unity 6 | URP on WebGL 2; **WebGPU production-ready in 6.6** with WebGL 2 fallback | Yes (6.6) | Best authoring tools (Timeline, Cinemachine, lightmapper, Animation Rigging, Shader Graph). Empty URP web build ≈ 10.7 MB. VFX Graph needs compute (WebGPU only). Asset Store free assets: no raw redistribution | 🟡 (free with conditions; terms changed in 2023) |
| **Godot 4 Web** | MIT | **Compatibility renderer (WebGL 2) only**; Forward+/Mobile unavailable on the web | **No** | C# can't export to the web in Godot 4 (GDScript only). Single-threaded export since 4.3; WASM SIMD by default in 4.7 | 🟢 licence / ⛔ for the high-end renderer on the web |

### 26.2 Evaluation (pre-benchmark estimates, 1–10)

Scores are estimates from documentation and our audit. **They become measured values after §54.** Weights reflect this project's priorities.

| Criterion | Weight | Three.js | Babylon.js | Unity 6 Web | Godot 4 Web |
|---|---|---|---|---|---|
| Visual quality ceiling (browser) | 3 | 8 | 8 | 8 | 5 |
| Browser support (desktop + Safari + mobile) | 2 | 9 | 9 | 7 | 7 |
| WebGL 2 support | 1 | 10 | 10 | 9 | 9 |
| WebGPU support | 1 | 8 | 9 | 8 | 1 |
| Lighting (incl. baking workflow) | 2 | 7 | 8 | 9 | 5 |
| Shadows | 1 | 7 | 8 | 8 | 6 |
| PBR materials | 1 | 9 | 9 | 9 | 7 |
| Post-processing | 1 | 8 | 8 | 8 | 5 |
| Animation system | 2 | 7 | 8 | 9 | 7 |
| IK | 1 | 5 | 7 | 9 | 6 |
| Cinematic tooling | 2 | 4 | 5 | 10 | 6 |
| glTF support | 1 | 9 | 10 | 6 | 8 |
| Terrain tools | 1 | 4 | 5 | 8 | 4 |
| Foliage | 1 | 6 | 7 | 7 | 6 |
| Particles / VFX | 1 | 7 | 8 | 7 | 5 |
| Water | 1 | 6 | 7 | 6 | 5 |
| Character pipeline (Blender → engine) | 1 | 8 | 8 | 8 | 7 |
| Asset streaming | 1 | 7 | 7 | 6 | 5 |
| Memory usage | 1 | 8 | 8 | 5 | 6 |
| Download size | 1 | 9 | 7 | 4 | 5 |
| Browser performance (integrated GPUs) | 2 | 8 | 8 | 6 | 6 |
| Deployment difficulty (higher = easier) | 1 | 9 | 9 | 7 | 6 |
| Debugging | 1 | 8 | 9 | 5 | 5 |
| Free / licensing safety | 2 | 10 | 10 | 7 | 10 |
| Long-term maintainability (for this team/codebase) | 2 | 9 | 7 | 5 | 4 |
| Migration cost from the current build (higher = cheaper) | 2 | 10 | 6 | 3 | 3 |
| **Weighted score (/10)** | 36 | **7.8** | **7.8** | **7.1** | **5.8** |

**Notes on the scores:**
- Three.js particles (7) and collision assume MIT-licensed community libraries (e.g. `three-mesh-bvh` for mesh collision/raycasting, `three.quarks` for particles). 🟡 **Verify licences at adoption.**
- Unity's visual ceiling equals the JS engines *in the browser*: all are limited by WebGL 2/WebGPU and the same GPUs. Unity's advantage is **tooling**, which raises productivity, not the pixel ceiling.
- Godot's low ceiling is specific to its **web** export (Compatibility renderer: no SSAO/SSR/volumetric fog, simpler lighting).

### 26.3 ENGINE DECISION MATRIX: summary

| | Three.js | Babylon.js | Unity 6 Web | Godot 4 Web |
|---|---|---|---|---|
| Weighted score | **7.8** | **7.8** | 7.1 | 5.8 |
| Best at | Small runtime, existing code, glTF, flexibility | Built-in features & tools, WebGPU maturity | Authoring tools (Timeline, Cinemachine, lightmapper, IK) | Licence, editor |
| Worst at | No editor, no cinematic tooling, IK is DIY | Full rewrite of 12k lines | Heavy runtime, memory, load time, C# rewrite, proprietary terms | No WebGPU, low web visual ceiling, no C# on the web |
| Migration cost | None | ~10–14 weeks | ~16–24 weeks | ~16–24 weeks |
| Verdict | **Recommended (provisional)** | **Primary challenger in the benchmark** | Benchmark as the tooling-ceiling reference | **Not recommended**; benchmark only to confirm |

### 26.4 Recommendation

**Recommended engine: Three.js**, moving to `WebGPURenderer` + TSL with automatic WebGL 2 fallback (🟢), **confirmed or overturned by the Visual Benchmark (§54)**.

**Why:**
1. In the browser, the image is limited by GPU budget and content quality, not by engine features. Our gap is assets, lighting, animation and staging, which are **engine-agnostic** work in Blender.
2. Three.js has the smallest runtime (≈ 248 KB gz today) and the best fit for the existing, well-architected 12k-line TypeScript codebase.
3. Its weaknesses (cinematic tooling, IK, editor) are buildable in a few weeks each, and we need custom gameplay-specific versions anyway: traversal motion warping, ledge hand IK, film-style tracks.
4. Babylon.js scores equal on paper. Its advantages (Inspector, node editors, built-in IK/particles) don't clearly outweigh a full rewrite. **That's exactly what the benchmark must test.**

**Switch rule:**
- **Switch to Babylon.js** if, on the benchmark scene with identical assets, it scores ≥ 1.0 higher on the blind visual rating **or** ≥ 20% better p95 frame time on the low *and* mid machines, at equal or better visuals.
- **Switch to Unity** only if it scores ≥ 1.5 higher on visuals *and* meets the LOW budget on the integrated GPU *and* first load ≤ 15 s on 50 Mbps. Then follow the §26.5 migration plan.
- **Godot** is not selected unless its web renderer gains WebGPU/Forward+ before Phase 8.

### 26.5 Migration plan (only if the benchmark selects another engine)

1. Freeze gameplay features in the Three.js build; it stays the playable reference.
2. Port in this order:
   1. asset loading (glTF/KTX2: unchanged assets);
   2. player motor/collision (logic port, same tests);
   3. camera;
   4. animation graph (re-implemented on the engine's system);
   5. traversal;
   6. save/state (pure TS: copy for Babylon, C# port for Unity);
   7. UI (DOM UI is reusable with Babylon; Unity needs uGUI/UI Toolkit or a DOM overlay via a JS bridge);
   8. audio (WebAudio code reusable with Babylon; Unity uses its own audio).
3. Re-run the deterministic playtest spec (ported) until parity: all checks green.
4. Only then continue content.

**Cost:** Babylon ~10–14 dev-weeks; Unity ~16–24 dev-weeks.

---

## 27. Visual Quality Presets

| Setting | LOW (gameplay first) | MEDIUM (balanced) | HIGH (premium browser) | ULTRA (experimental, powerful GPUs) |
|---|---|---|---|---|
| Target hardware | Integrated GPU (Intel UHD/Iris Xe) | M1/M2, GTX 1650, Radeon 680M | RTX 3060-class, M3 Pro+ | RTX 4070+/M3 Max+ |
| Render scale (dynamic, floor) | 0.75 (0.6) | 0.9 (0.7) | 1.0 (0.8) | 1.0–1.25 (0.9) |
| Pixel ratio cap | 1 | 1.5 | 2 | 2 |
| Anti-aliasing | FXAA | SMAA | MSAA 4× (+SMAA in cinematics) | MSAA 4× + TAA (if WebGPU path) |
| Shadows | 1024², 1 cascade, characters + large rocks only | 2048², 2 cascades | 2048–4096², 3 cascades, foliage casters near | 4096², 4 cascades, contact shadows |
| Baked lightmaps / AO | ✓ (1/2 res) | ✓ | ✓ | ✓ (full res) |
| GTAO | — | half-res | full | full + bent normals |
| Bloom | — | ✓ | ✓ | ✓ |
| DOF | cinematics only (cheap) | cinematics | cinematics + gameplay subtle | bokeh |
| SSR | — | — | — | water/wet stone |
| Volumetric-looking light | god-ray cards | cards | cards + radial scatter | + froxel fog (WebGPU) |
| Texture tier | 1K max (hero 2K) | 2K | 2K (hero 4K faces) | 4K hero |
| Foliage density / distance | 40% / 50 m (grass 18 m) | 70% / 90 m (grass 30 m) | 100% / 150 m (grass 50 m) | 130% / 200 m (grass 70 m) |
| Foliage LOD | aggressive impostors | standard | standard | late LOD switch |
| Particles | 30% | 60% | 100% | 150% |
| Water | 1 normal layer, no refraction | + refraction | + ripple RT | + SSR, camera droplets |
| Character | LOD1 in gameplay, LOD0 in cinematics | LOD0 | LOD0 + spring bones | + higher-res hair/face |
| Shader LOD | simplified foliage/terrain shaders | full | full | full + detail normals far |
| Adaptive controller | on | on | on | on (steps down to HIGH) |

**ULTRA rules:**
- opt-in and never auto-selected;
- shows an "experimental" label;
- must pass the same stability tests (no crash or GPU-memory exhaustion in a 30-min run);
- if memory or frame-time watchdogs trip twice, it falls back to HIGH automatically.

---

## 28. Performance Requirements & Budgets

**Reference machines** (D5 to confirm):

| Tier | Machine | Preset | Resolution | Target |
|---|---|---|---|---|
| Low | This audit laptop (Intel UHD, 0xA78B) | LOW | 1280×720 | ≥ 30 FPS, p95 ≤ 40 ms |
| Mid | M1/M2 or GTX 1650-class | MEDIUM | 1920×1080 | ≥ 50 FPS, p95 ≤ 22 ms |
| High | RTX 3060-class / M3 Pro | HIGH | 1920×1080–1440p | 60 FPS, p95 ≤ 18 ms |
| Ultra | RTX 4070+ / M3 Max | ULTRA | 1440p | 60 FPS, p95 ≤ 18 ms |

**Budgets (main gameplay views):**

| Budget | LOW | MEDIUM | HIGH | ULTRA |
|---|---|---|---|---|
| Main-pass draw calls | ≤ 150 | ≤ 250 | ≤ 400 | ≤ 600 |
| Main-pass triangles | ≤ 400 k | ≤ 900 k | ≤ 2 M | ≤ 3.5 M |
| Shadow-pass draw calls | ≤ 40 | ≤ 90 | ≤ 160 | ≤ 250 |
| GPU frame (on the tier's machine) | ≤ 28 ms | ≤ 16 ms | ≤ 14 ms | ≤ 14 ms |
| CPU frame (JS) | ≤ 8 ms | ≤ 6 ms | ≤ 6 ms | ≤ 6 ms |
| Transient allocations | ≤ 50 KB/frame | ≤ 50 KB/frame | ≤ 50 KB/frame | ≤ 50 KB/frame |
| GPU memory (est.) | ≤ 400 MB | ≤ 700 MB | ≤ 1.2 GB | ≤ 2 GB |
| Post-processing GPU | ≤ 2 ms | ≤ 3 ms | ≤ 4 ms | ≤ 6 ms |

**Download/load:**
- first boot (engine + UI + Ines + Ch1 core) ≤ 25 MB compressed;
- each later chapter ≤ 20 MB (streamed in sections);
- boot → menu ≤ 10 s on 50 Mbps (mid machine);
- chapter load ≤ 8 s.

**Techniques** (all 🟢 unless noted):
- LOD (meshes via meshoptimizer simplification);
- impostors (foliage, distant ruins);
- instancing (exists);
- static batching/merging (exists);
- texture atlases (exist);
- **KTX2** (Basis ETC1S/UASTC via KTX-Software) for all textures;
- **Meshopt** geometry compression (preferred) and **Draco** where it wins (static meshes);
- frustum culling (exists);
- **occlusion culling**: authored portal/zone visibility (Ch3 caves, sanctum), plus hardware occlusion queries on WebGL 2 for large occluders (🟡, evaluate the latency cost);
- chunk streaming of chapter sections;
- asset streaming by manifest (exists);
- dynamic resolution;
- scalable shadows, post, foliage and particles;
- shader LODs.

**Simulation:** fixed 60 Hz timestep with ≤ 4 substeps, so game time matches real time down to 15 FPS (today it slows below 20 FPS).

---

## 29. Browser / Technical Requirements

- **Chrome/Edge:** latest 2, full support.
- **Firefox:** latest 2, supported.
- **Safari 17+:** supported (manual at milestones).
- **WebGL 2 required.** **WebGPU** is used when available (HIGH/ULTRA benefit most), with automatic WebGL 2 fallback. Every feature has a WebGL 2 path, except ULTRA-only experimental effects.
- **Input:** keyboard+mouse (exists), **gamepad** (stub → implement), touch (best-effort tier).
- **Static hosting:** correct MIME types for wasm/ktx2/glb, Brotli/gzip, hashed filenames. Cross-origin isolation is **not required** unless a threaded WASM component is adopted.
- **Privacy:** no analytics without consent. Local saves only.

## 30. Architecture

**Keep** (production-grade structure): `ChapterManager`, `StateRegistry`/`Persistable`/`SaveManager`, `InputManager`/providers, the `CinematicDirector` skip guarantee, the `AnimationDriver` abstraction, `EventBus`, `GameClock` pause semantics.

**Change:**

| Change | Why | Phase |
|---|---|---|
| Fixed-timestep simulation + render interpolation | Frame-rate independence | 1 |
| Deterministic test clock (`__TFE.advance(s)`) | GPU-independent tests | 1 |
| Collision: capsule vs OBB/convex/heightfield; mesh BVH for static walkables (🟡 `three-mesh-bvh`, MIT: verify); collision during traversal; debug overlay | Clipping fixes | 1 |
| Data-driven entities, triggers, objectives, puzzles | Scale to 5 chapters | 1, 4 |
| `LevelLoader` (glTF + JSON sidecar) | Authored levels | 4 |
| `AnimGraph` (state machines, blend spaces, layers, IK, motion warping, spring bones, facial) behind `AnimationDriver` | Animation quality | 3 |
| Cinematic tracks (camera, character, facial, look-at, IK, props, audio, music, subtitles, VFX, lights/exposure, DOF) | Film staging | 6 |
| Material library (shared PBR functions: wetness, dirt, edge wear, moss) | Material quality | 4–5 |
| Lighting: lightmap + probe support, auto-exposure, LUT grading | Lighting quality | 4–5 |
| Renderer path: `WebGPURenderer` + TSL port of custom shaders | WebGPU benefits with WebGL 2 fallback | After the Phase 8 lock (if Three.js stays) |
| ESLint import boundaries; Vitest; CI | Reliability | 1 |

**Dependency rule:** gameplay never depends on rendering; gameplay never reads quality settings.

---

# PART IV — PIPELINES

## 31. Free AAA-Quality Toolchain

| Purpose | Tool | Licence (pre-screen) | Role | Tag |
|---|---|---|---|---|
| **3D modelling / rigging / animation / baking / rendering flipbooks** | **Blender** (4.x/5.x) | GPL; your output is yours | The hub of the whole pipeline | 🟢 |
| Base human | **MakeHuman** (official, unmodified build, using its export function) | AGPL program; **exported models may be used under CC0** via MakeHuman's licence exception | Ines/Toby/Corwin/Dace base bodies | 🟢 (follow the exception conditions exactly) |
| Base human (Blender plugin) | MPFB2 (MakeHuman for Blender) | GPL code; asset licence terms to check | Convenience | 🟡 |
| Base human (alt.) | CharMorph | Open source; base characters CC0 (Vitruvian) or CC-BY (others) | Alternative base | 🟡 |
| Base human (alt.) | MB-Lab | **AGPL propagates to generated models** | — | 🔴 *(effectively unusable: AGPL output conflicts with a closed/commercial build)* |
| Sculpting | Blender Sculpt (multires, dyntopo) | GPL | Faces, rock/ruin hero sculpts | 🟢 |
| Retopology | Blender (manual, Shrinkwrap, QuadriFlow remesh) | GPL | Game topology | 🟢 |
| Retopology (paid) | Quad Remesher / RetopoFlow | Paid | — | 🔴 |
| UV | Blender UV tools | GPL | — | 🟢 |
| Texture painting (PBR layers) | **ArmorPaint**, compiled from source | zlib (source free; prebuilt binaries are paid) | Character/prop painting | 🟢 if built from source / 🔴 if buying binaries |
| Texture painting (alt.) | Blender texture paint | GPL | Simple painting | 🟢 |
| Procedural materials | **Material Maker** | MIT | Bronze, leather, canvas, weaves, rock blends | 🟢 |
| 2D painting | **Krita** | GPL | Hand-painted maps, glyphs, murals, LUT grading, UI art | 🟢 |
| Image editing | **GIMP** | GPL | Texture cleanup, channel packing | 🟢 |
| Baking (normal/AO/curvature/thickness) | **Blender Cycles bake** | GPL | All bakes, incl. lightmaps | 🟢 |
| Substance 3D / Marmoset / ZBrush | — | Paid | — | 🔴 |
| Mocap data | **CMU Graphics Lab Mocap** | Free for all uses incl. commercial; don't resell the raw data; credit requested | Locomotion, gestures | 🟢 (credit in Credits) |
| Animation library | **Quaternius Universal Animation Library** (Standard) | CC0 | Base locomotion and actions | 🟢 |
| Video → mocap | Rokoko Vision (free plan) | Free plan; FAQ says outputs usable commercially; limited seconds/month | Custom gestures recorded by the team | 🟡 |
| Video → mocap (open source) | FreeMoCap | AGPL software; output-data terms unclear | Custom capture | 🟡 |
| Mocap/animation | Mixamo | Free with an Adobe account; royalty-free in games; **raw-file redistribution prohibited**, and web builds expose GLBs | — | 🟡 **avoid for shipping assets** (prototype only) |
| Animation tool | Cascadeur | **Free plan is non-commercial only** | — | 🔴 for a potentially commercial release |
| Retargeting | Blender (constraints / bake action) + free retarget add-ons (e.g. Expy Kit: verify licence) | GPL | CMU/Quaternius → project rig | 🟢 / 🟡 |
| Rigging | **Rigify** (Blender built-in) → game-rig export | GPL | Control rig + deform rig | 🟢 |
| Rigging (paid) | Auto-Rig Pro | Paid | — | 🔴 |
| glTF processing | **gltf-transform** (CLI/lib) | MIT | Meshopt, Draco, KTX2, prune, dedupe, LOD | 🟢 |
| Texture compression | **KTX-Software** (`toktx`) / Basis Universal | Apache-2.0 | KTX2 ETC1S/UASTC | 🟢 |
| Mesh optimisation | **meshoptimizer** (`gltfpack`) | MIT | Simplification, LODs, compression | 🟢 |
| Impostors | Blender bake script (in-house) | Ours | Octahedral impostor atlases | 🟢 |
| Audio editing | **Audacity** | GPL | Foley editing, loudness | 🟢 |
| Music/DAW | **LMMS** + **Surge XT** synth | GPL | Score stems, stingers | 🟢 |
| Audio (alt.) | Ardour | GPL source; binaries via paid/donation downloads | — | 🟡 |
| Field recording | Any phone + Audacity | — | Footsteps, cloth, gear, rock | 🟢 |
| LUT authoring | Krita/GIMP on a neutral LUT strip | GPL | Per-chapter grades | 🟢 |
| Version control | Git + Git LFS (for binaries) | GPL / MIT | Everything | 🟢 |
| Engine editors (benchmark only) | Babylon.js Sandbox/Inspector/NME (Apache-2.0); Unity 6 Personal (free ≤ $200k); Godot (MIT) | — | Benchmark | 🟢 / 🟡 Unity |

## 32. Asset Sources & Licence Pre-Screen

| Source | Free | Commercial use | Browser redistribution (assets ship as downloadable files) | Licence verification | Recommended |
|---|---|---|---|---|---|
| **Poly Haven** (HDRIs, textures, models) | Yes | Yes | Yes (CC0) | CC0 per site licence page: re-confirm at intake | ✅ 🟢 |
| **ambientCG** (PBR materials, HDRIs) | Yes | Yes | Yes (CC0) | CC0: re-confirm at intake | ✅ 🟢 |
| **Kenney** | Yes | Yes | Yes (CC0) | CC0: re-confirm per pack | ✅ 🟢 (mainly prototyping/UI) |
| **Quaternius** (models, animation library) | Yes (Standard tiers) | Yes | Yes (CC0) | CC0 per pack page: re-confirm per pack | ✅ 🟢 |
| **CMU Mocap** | Yes | Yes | Yes inside the product; no resale of raw data | Terms on mocap.cs.cmu.edu | ✅ 🟢 |
| **MakeHuman exports** | Yes | Yes | Yes (CC0 under the exception) | Must use an official unmodified build + its export function | ✅ 🟢 |
| **Freesound** | Yes | **Only CC0 and CC-BY** sounds; CC-BY-NC is excluded; legacy Sampling+ excluded | CC0/CC-BY yes | **Per sound**: log each one | ✅ 🟡 |
| **Sonniss GDC Game Audio Bundles** | Yes | Yes, royalty-free, no attribution | Allowed as part of a finished game; not as standalone files/libraries; no AI training | Read each year's bundle licence | ✅ 🟡 |
| **OpenGameArt** | Yes | Depends: CC0, CC-BY, CC-BY-SA, OGA-BY, GPL per asset | CC0/CC-BY/OGA-BY yes; **CC-BY-SA / GPL** impose share-alike on the asset | **Per asset**; avoid SA/GPL unless the asset's derivatives can be shared alike | ⚠️ 🟡 (CC0/CC-BY only) |
| **Sketchfab** (downloadable) | Yes | CC-BY / CC0 yes; **NC/ND no** for us | CC-BY yes with credit | **Per model**: check the licence badge + author reputation (risk of re-uploaded ripped content) | ⚠️ 🟡 (CC0/CC-BY from trusted authors only) |
| **BlenderKit** | Free tier | CC0 assets: yes. **Royalty-Free assets: must not be extractable** and the software must not let users export the models | RF: **effectively no** (browser GLBs are extractable) | Per asset | ⚠️ CC0 only 🟡; RF 🔴 for us |
| **Unity Asset Store (free)** | Yes | Yes inside built games | Only "as integrated parts" of a game: unclear for open web formats | EULA | ⚠️ 🟡 (Unity-only, if chosen) |
| **Mixamo** | Yes (Adobe account) | Yes in games | Raw-file redistribution prohibited, and web GLBs are extractable | Adobe additional terms | ❌ for shipping 🟡 |
| **Fab / Quixel Megascans** | Partly | Varies by licence; Megascans no longer broadly free outside specific terms | Varies | Per asset; **verify** | ❌ unless explicitly CC0/CC-BY 🟡 |
| **Pixabay (sound effects)** | Yes | Yes under the Pixabay Content License | No standalone redistribution | Read the current licence | ⚠️ 🟡 |
| **Own work** (Blender models, recordings, photos) | Yes | Yes | Yes | Logged as project-owned | ✅ 🟢 |
| Any "free for personal use", ripped, extracted, leaked or unclear asset | — | — | — | — | ❌ **REJECT** |

**Key browser-specific rule:** in a web game, every GLB, texture and sound can be downloaded through the browser's network tab. **Licences that require assets to be "non-extractable" are treated as incompatible** unless the licensor confirms web use in writing.

## 33. Asset Licensing Workflow

`ASSET_LICENSES.md` becomes a registry. **Every external asset** gets one row:

| Field | Example |
|---|---|
| Asset ID / name | `tex.rock.red_cliff_01` |
| Creator | (author name) |
| Source URL | (page URL) |
| Licence | CC0 1.0 |
| Licence URL | (licence page URL) |
| Allowed use | Commercial, any media |
| Modification rights | Yes |
| Redistribution rights (incl. web) | Yes |
| Attribution required | No / exact credit text |
| Date verified | 2026-10-04 |
| Verified by | (name) |
| Files in repo | `art/source/...`, `public/assets/...` |
| Modified? | Yes: colour-graded, resized |

**Process:**
1. **Intake:** fetch the asset from the original source only (never from mirrors or re-uploads). Save a PDF or text snapshot of the licence page to `licenses/snapshots/`.
2. **Screen** against §32. Anything NC, ND, personal-use, non-extractable, AGPL-output or unclear → **reject**.
3. **Log** the row *in the same commit* as the asset.
4. **Automated check:** `npm run assets:check` fails CI if any file in `public/assets/` or `art/` lacks a registry row (matched by path or ID), or a row lacks a required field.
5. **Credits:** CC-BY/CMU credits are auto-generated into the in-game Credits screen from the registry.
6. **Milestone audit:** re-verify 10% of rows plus all 🟡 rows at each milestone.

**Rejected categories:**
- ripped, extracted or leaked game assets;
- "free for personal use";
- unclear or no licence;
- NC/ND licences;
- licences whose web-redistribution rights can't be established;
- AGPL-propagating outputs.

---

## 34. Asset Pipeline

**Hybrid model:**

| Procedural (code/runtime or offline) | Authored (Blender → glTF) |
|---|---|
| Terrain base heightfield, ground-cover scatter, grass, distant vegetation, rock *variation* (instancing with tint/scale), distant forest, sky, fog, atmospheric particles | Hero ruins, temples, the gate, bridges, traversal surfaces, camps, mechanisms, houses, landmarks, major rocks, cliffs, caves, characters, props |

**Folder structure:**
```
art/source/<chapter>/<asset>.blend   (Git LFS)
art/textures/<asset>/                (source PNG/EXR, Git LFS)
public/assets/<chapter>/<asset>.glb  (built, Meshopt + KTX2)
licenses/snapshots/
```

**Build step** (`npm run assets:build`), using gltf-transform + toktx + gltfpack (all 🟢):
- export glTF from Blender;
- dedupe, prune and weld;
- generate LODs;
- Meshopt-compress;
- encode textures to KTX2 (ETC1S for albedo/ORM, UASTC for normals);
- validate the budgets per asset class.

**Per-asset budgets:**

| Class | Tris (LOD0) | Textures | Materials |
|---|---|---|---|
| Hero character (cinematic) | ≤ 45 k | 2K–4K | ≤ 4 |
| Hero landmark (e.g. the gate) | ≤ 60 k | 2K + tiling detail | ≤ 4 |
| Hero prop (e.g. theodolite) | ≤ 8 k | 1–2K | ≤ 2 |
| Standard prop | ≤ 2 k | atlas | 1 |
| Modular ruin piece | ≤ 3 k | trim sheet | 1–2 |
| Foliage species (LOD0) | ≤ 1.5 k | atlas | 1 |

**Naming conventions:** `COL_`, `CLIMB_`, `LEDGE_`, `NARROW_`, `VAULT_`, `JUMP_`, `TRIG_`, `CP_`, `INT_`, `CAM_`, `SPAWN_`, `LIGHT_`, `PROBE_`, plus `_LOD0/1/2` suffixes.

## 35. Character Pipeline

**Current:** `gen-temp-character.mjs` builds primitive-based characters:
- 17 bones, 19 procedural clips;
- vertex colours, with UVs deleted;
- `CharacterAvatar` forces `roughness = 0.78` on all materials.

**The procedural mannequin is not final.** The code abstraction (`characters.json` mapping) is kept.

**Pipeline (Ines first, then Toby, Corwin, Dace, crew, elder):**

| Step | Tool | Output | Gate |
|---|---|---|---|
| 1. Concept sheet | Krita | Front/side/back turnaround, colour callouts from bible §3, silhouette test | Silhouette readable at 64 px |
| 2. Base body | **MakeHuman** (official build, export) → Blender | CC0 base mesh with good proportions | Proportion review |
| 3. Head sculpt | Blender Sculpt (multires) | High-poly face with Ines's features + scar | Likeness to the concept; not resembling any real person or existing character |
| 4. Clothing & gear | Blender modelling (+ cloth sim for **authored** folds, then sculpt) | High-poly jacket, trousers, boots, harness, satchel, radio | Layered, believable construction |
| 5. Retopology | Blender | Game mesh (§10.1 budgets), deformation loops | Deformation test in extreme poses |
| 6. UVs | Blender | Non-overlapping UV sets; texel-density check | Density within ±15% of target |
| 7. Bakes | Blender Cycles | Normal, AO, curvature, thickness, ID | No artefacts in close-up |
| 8. Texturing | ArmorPaint (from source) / Material Maker / Krita | Albedo, ORM, normal; skin pores, scar, cloth wear, leather scuffs, dirt | Material review (§9) |
| 9. Hair | Blender hair curves → **hair cards** | Card mesh + alpha texture | No sorting artefacts |
| 10. Eyes & teeth | Blender | Eyeballs (sclera/iris/cornea), teeth/tongue | Close-up review |
| 11. Rig | **Rigify** → exported game deform rig (~65–75 bones incl. fingers, twist bones, face jaw/eyes) + **shape keys** for facial expressions (12–20) | GLB with skin + morph targets | Clips play without stretching |
| 12. Spring bones | In-engine config (hair knot, satchel, gear) | JSON | Settles in ≤ 1 s, no jitter |
| 13. LODs | Blender decimate + manual + gltfpack | LOD0c / LOD0 / LOD1 / LOD2 | Silhouette preserved at switch distances |
| 14. Export & build | Blender glTF exporter → `assets:build` | Meshopt + KTX2 GLB | Budget check passes |
| 15. In-engine validation | Character lookdev scene: turntable, 4 lighting presets, close-up camera, IK test poses | Screenshots for review | §10.2 close-up gates pass |

**Effort estimate:** Ines ≈ 6–10 artist-weeks for a competent Blender user (the biggest uncertainty in the project). Supporting characters ≈ 3–5 weeks each, reusing the base, rig and gear kit.

## 36. Animation Pipeline

### 36.1 Sources

| Source | Use | Tag |
|---|---|---|
| Quaternius Universal Animation Library | Starting set: locomotion, jumps, interactions | 🟢 |
| CMU mocap | Natural locomotion variety, gestures, idles | 🟢 |
| Own capture: Rokoko Vision free / FreeMoCap | Specific gestures (radio, kneel and read, examine) | 🟡 |
| **Hand-keyed in Blender** | **All climbing/traversal** (mocap rarely matches our metrics), facial expressions, polish | 🟢 |
| Mixamo | Prototyping only, never shipped | 🟡 (not shipped) |

### 36.2 Pipeline
1. Import → retarget to the project rig (Blender constraints + bake).
2. Clean up: fix foot contacts; loop; trim.
3. **Mark animation events** (foot down L/R, hand grab, cloth rustle, breath, VFX cue) as Blender timeline markers → exported as clip metadata JSON.
4. Extract root motion to a separate track (in-place or root-motion chosen per state).
5. Author traversal clips to **project metrics** (`HANG_DROP 2.02 m`, step 0.42 m, ledge widths), with anchor markers for motion warping.
6. Export clip packs per chapter (locomotion core always loaded; story/traversal packs streamed).
7. Runtime `AnimGraph`:
   - locomotion blend space + phase-matched starts/stops/turns;
   - traversal state machine with motion warping;
   - upper-body and additive layers;
   - IK (feet, hands, look-at, eyes);
   - spring bones;
   - facial layer (blinks, expressions, look).
8. Debug overlay: states, weights, phase, contacts, IK targets.
9. Automated checks: pops, foot slide/float, latency (§11.3).

### 36.3 Facial animation
- Shape keys (12–20): blink L/R, brow raise/lower/furrow, smile, frown, jaw open, squint, cheek raise, lip press, nostril flare + 6–8 viseme-like shapes if VO is adopted.
- Runtime: procedural blink and eye saccades; expression tracks in cinematics; gameplay emotion states (strain while climbing, focus during puzzles).
- **No** automatic lip-sync unless VO is decided (D8); then use a free phoneme approach. 🟡 TBD.

### 36.4 Synchronization
Animation events are the single source of truth: the *same event* triggers footstep audio, a dust puff and camera micro-shake. Nothing is timed by separate timers.

## 37. Environment & Level Pipeline

1. **Beat chart:** story beat → space → mechanic → clue → checkpoint → story traces (§16.2).
2. **Grey-box in Blender** with the naming conventions and the metrics kit:
   - max jump 2.2 m horizontal at equal height;
   - ledge grab 2.0 m above feet;
   - step 0.42 m;
   - narrow ledge 0.3–0.5 m.
3. **Grey-box playtest gate:** the chapter must be playable with all automated route tests passing *before* art.
4. **Composition pass:** place the `CAM_` establishing views; screenshot each with UI off; review against §7.2.
5. **Art pass:**
   - Hero assets (§42) modelled and textured.
   - Modular kits: ruin walls, stairs, terraces, arches, with **trim sheets**, damage variants and decals.
   - Cliffs: hero sculpted rock meshes with tiling triplanar detail and **integrated climbable regions**.
   - Procedural layers: terrain base, scatter with exclusion/accent masks, distant forest.
6. **Lighting pass** (§38): bake lightmaps/AO; probes; per-zone env maps; fog, grade, exposure.
7. **Storytelling pass:** trace kit placement to the density target.
8. **Audio pass:** emitters, reverb zones, ambience layers.
9. **Performance pass** to the §28 budgets; LOD/impostor/occlusion zones.
10. **`LevelLoader`:** builds collision from `COL_`, traversal from `CLIMB_/LEDGE_...`, and entities, triggers, camera hints and light probes from empties + the JSON sidecar.

**No repetitive grid-like buildings, no visibly identical trees, no procedural boxes as hero architecture** (fail conditions in §55).

## 38. Lighting Pipeline

1. **Per-chapter lighting brief:** sun angle and colour, sky HDRI, fog colours, grade reference frames, guide-light plan.
2. **Static lighting:**
   - in Blender, a second UV set (lightmap UVs);
   - bake indirect + AO (Cycles, denoised) per hero cluster;
   - export as KTX2 (UASTC/HDR-encoded RGBM or RGBE).
   - **Bake budget:** ≤ 16 lightmaps of 2048² per chapter section (LOW loads half resolution).
3. **Probes:** a light-probe grid (SH, baked offline) for characters and dynamic props; env-map captures per zone (PMREM).
4. **Dynamic:** one sun with shadows; local lights per §8.1 limits.
5. **Post:** auto-exposure (zone-clamped), tone mapping (ACES/AgX: choose in the benchmark), per-chapter LUT, bloom thresholds, vignette/grain (exist).
6. **Cinematic lighting:** per-shot key/fill/rim light tracks; exposure/LUT overrides per shot.
7. **Validation:** a lit-only view, a luminance-separation check on hero frames, shadow artefact review.

## 39. Cinematic Pipeline

**Runtime tracks** (an extension of `CinematicDirector`):

| Track | Content |
|---|---|
| Camera | Splines or keyed transforms, FOV, roll, focus distance/aperture, handheld noise, cut/blend markers |
| Character animation | Clip, start time, blend, root position/rotation keys, motion warp targets |
| Facial | Expression weights curves, blink overrides, eye targets |
| Look-at | Head/eye targets (objects or points) with weights |
| Hand IK / props | Attach/detach props to hand bones; IK targets (handles, letter, radio) |
| Audio | SFX cues (positional), VO/subtitle lines |
| Music | Mood/stinger cues, bar-quantized |
| Subtitles | Timed lines (exists via dialogue) |
| VFX | Pooled effect spawns with transforms |
| Lighting / post | Light intensities and colours, exposure, LUT blend, DOF, letterbox |
| Events | Gameplay state changes (with the existing skip-safe guarantee) |

**Authoring:**
1. **Storyboard** (Krita): thumbnails per shot.
2. **Blocking in Blender:** characters + cameras animated in the level's glTF context; export the camera and character actions as glTF animations + a markers JSON (🟢, free and visual).
3. **Assemble in a sequence JSON** referencing those clips + audio/VFX/light cues.
4. **Tune in-engine** with a debug scrubber (`?debug&seq=<id>`: play/pause/scrub/shot-jump).

**Gameplay ↔ cinematic:**
- blend-in 0.3–1.0 s or a deliberate cut;
- the character's start pose is matched or blended (≤ 0.4 s);
- the end pose matches the gameplay idle;
- the camera blends back (exists).

**Rule:** no character stands and loops for > 3 s while on screen in a cinematic. They breathe, shift weight, look and react.

**Acceptance:**
- every sequence passes "skip at every 1 s → identical end state";
- no cinematic is a pure flyover (each has ≥ 1 character performance beat), except the opening establishing shot.

## 40. VFX Pipeline

1. **Design:** a VFX list per chapter (§22) with trigger, preset scaling and budget.
2. **Authoring:**
   - flipbooks rendered from Blender smoke/fire/debris simulations (🟢);
   - noise/textures from Material Maker/Krita (🟢);
   - CC0 textures (🟢).
3. **Runtime:**
   - GPU particle system: instanced quads with closed-form motion or texture-driven state;
   - soft particles (depth fade);
   - lit by the sun direction + ambient;
   - pooled emitters;
   - LOD by distance and preset.
   - Evaluate the MIT-licensed `three.quarks` (🟡) versus extending the existing `Particles.ts`.
4. **Triggers:** animation events, timeline tracks, gameplay events (one bus).
5. **Budgets:** particles ≤ 1.5 ms GPU on HIGH (mid machine), ≤ 0.6 ms on LOW; overdraw checked with a debug overdraw view.
6. **Acceptance:** each effect reviewed in context (not isolated); no effect without a matching sound; no hard-edged intersections with geometry.

## 41. Audio Pipeline

1. **Asset list** per chapter (foley, ambience, mechanisms, stingers).
2. **Sourcing:**
   - own recordings first (🟢);
   - then CC0 (Freesound CC0, Kenney) (🟢);
   - then CC-BY/Sonniss (🟡, logged).
3. **Edit in Audacity:** trim, de-noise, normalise to -1 dBFS peak; loudness-match per category.
4. **Encode:** OGG/Opus (with AAC fallback for Safari if needed); variants in round-robin sets.
5. **Runtime:**
   - event-driven playback;
   - spatial panners (exist);
   - reverb zones (convolution);
   - occlusion low-pass;
   - dialogue ducking;
   - the adaptive music engine (exists), extended with bar-quantized transitions and stems.
6. **Music:** composed in LMMS/Surge XT → stems (pads/bells/pulse/motif) → layered by the existing mood system.
7. **QA:** a master-bus loudness meter in debug mode (-16 LUFS integrated target, no clipping); sync test (footstep audio within ±1 frame of the foot event).

## 42. Hero Asset Strategy

**The 20% of assets that produce 80% of perceived quality** get the majority of art time. Everything else is modular, tiled or procedural.

| Ch. | Hero characters | Hero landmark | Hero prop | Hero mechanism | Hero vista | Hero cinematic location | Hero VFX moment |
|---|---|---|---|---|---|---|---|
| **1** | Ines (final), Toby | **Gate of the Watching Sun** (carved gate + murals) | Anselm Roy's **theodolite**; Camp Four dinner table/stove | **Three glyph drums** | **City reveal** over the gorge | Gate plaza at sunset | Gate opening: dust storm + waterfall |
| **2** | Ines, Toby (on rope) | The aqueduct span | **Marta's photographic plate cache** | Aqueduct sluice (if puzzle approved) | First view down the terraced gorge wall | Plate discovery alcove | Aqueduct collapse spray + debris |
| **3** | Ines, Toby | The inner wall of glyphs | Polished **bronze mirror** | Mirror array + sky-house apertures | A sunbeam crossing a dark chamber | Decipherment chamber | Beam ignition with dust motes |
| **4** | Corwin, Dace, crew, Ines, Toby | **The great bridge** | Edmund's diaries; Corwin's brass compass | Dace's blast charges / drill rig | The bridge above the sanctum void | Corwin's camp at the bridge head | Blast + bridge collapse |
| **5** | All principals | **The Sunlock** | Marta's **reel-to-reel recorder**; the **Meridian Lens** | The Sunlock counterweights + triggers | The sanctum at noon | Marta's antechamber | Noon beam through the Lens; water rising |
| **Ep.** | Ines, elder | Tamsa Alta square | Marta's 1979 photograph | — | The valley with the ribbon | The cliff-trail foot | Wind in the ribbon |

**Art-time allocation target:**
- **55%** heroes (characters + the table above);
- **30%** modular kits/trim sheets/foliage species;
- **15%** props, decals, dressing.

---

# PART V — CONTENT

## 43. Chapter Structure

*(Bible-derived. Undefined fields are **TBD — DESIGN REQUIRED**.)*

> **Implementation status (2026-10-06): all chapters are playable.**
> - Chapters 2–5 and the epilogue are built on `ChapterBase` + `LevelKit` (`src/chapters/common/`). The beats, puzzles and collectibles follow STORY_BIBLE §14 (rev 1.2 draft; it resolves SB-01…SB-14 except SB-11).
> - Each chapter has an automated playthrough (`npm run test:chapters`).
> - The "TBD" items below are superseded by §14 of the bible; they stay here for traceability.
> - Visual quality for Ch2–5 is at blockout-plus level (shared kit materials). The §44-style hero-asset rebuild still applies to every chapter.

### Chapter 1: THE DISCOVERY (implemented; full visual rebuild in §44)

| Field | Spec |
|---|---|
| Narrative objective | Follow the 1958 trail; the camp was abandoned not destroyed; DO NOT SHIP; the route is maintained; the city exists |
| Location | River landing → jungle trail → Camp Four → red-rock cliff & falls → ridge → gate → overlook (dusk after rain) |
| Gameplay objective | Reach the ridge; open the gate |
| Exploration | Camp Four (journal pages + Sun Token; page 2 currently at the cliff base: SB-01); watchpost ruin; stelae |
| Traversal | Climb, hang/shimmy/climb-up, narrow ledge, gap jump, vault, falls |
| Puzzle | Three glyph drums |
| Storytelling | Dinner on the stove, chalked crates, theodolite, new knots on old ribbons, "M.K." |
| Collectibles | 4 (journal ×3, Sun Token) |
| Cinematics | Opening, theodolite, gate opening, city reveal |
| Interactions | Toby in person, then by radio |
| Set-piece | Gate opening |
| Antagonist pressure | None (correct per bible) |
| Checkpoints | 5 |
| Ending | "Toby… there's a whole city down there." |
| Target duration | 25–35 min (to be measured) |

### Chapter 2: INTO THE UNKNOWN
- **Objective:** descend the upper terraces; find Marta's developed plates proving the team was alive after the claimed avalanche date (needs SB-09).
- **Traversal:** gorge-wall descent, rope bridges, rappel, aqueduct beams.
- **Puzzle:** **TBD**.
- **Toby** follows on the rope route (needs SB-07).
- **Set-piece:** aqueduct span collapse.
- **Ending:** the mouth of the sun-shafts.
- **Collectible canon text: TBD (bible first).**
- **Checkpoints, exact sequence, shots: TBD.**

### Chapter 3: THE HIDDEN PATH
- **Objective:** route sunlight with bronze mirrors and the sky-houses; Toby deciphers the inner wall ("so the sky would not drown the valley again"); fresh boot prints and a drilled blast-hole.
- **Rooms, collectibles and ending beat: TBD.**
- **Tech:** light-beam gameplay, auto-exposure, companion NPC, interior culling.

### Chapter 4: THE EXPEDITION
- **Story:** Corwin's crew arrives with Edmund's diaries via Toby's shared route (SB-05); betrayal; Corwin's argument; Dace's blast; the gorge collapses; bridge escape; Ines separated.
- **Tech:** 3–4 new characters, multi-character cinematics, keyframed destruction, chase camera, 3-second retry.
- **Exact beats: TBD.**

### Chapter 5: THE FINAL EXPEDITION
- **Story:** the 1979 recording; Corwin breaks; Dace's grab; the Sunlock fails; under-pressure realignment with Toby (roped) and Corwin; exit via the flooded passage.
- **Puzzle design, swim vs. wade, struggle set-piece: TBD.**
- **Recording text:** must be written into the bible first (SB-13).

### Epilogue: TAMSA ALTA
- **Content:** the photograph from the elder; the publication montage; the grave; the final ribbon.
- **Ordering:** SB-10.

## 44. Chapter 1 Visual Rebuild Plan

Chapter 1 becomes the **visual quality template**: every system, kit, material and process proven here is reused for Ch2–5.

| Area | Current | Rebuild | Hero? | Difficulty |
|---|---|---|---|---|
| Ines & Toby | Procedural mannequins | Final characters (§35) | ★ | XL |
| River landing | Procedural terrain, card trees, simple fire | Sculpted riverbank with roots and rocks; Toby's camp hero dressing (boat, crate, lantern, radio, notebook); flipbook fire + embers; wet-rock and mud materials; river with flow map and shoreline foam | | L |
| Jungle trail | Scatter of identical cards | 8+ understory species, 4 tree species with buttress roots, hand-placed hero trees framing the path; stelae as sculpted hero pieces; light-shaft composition | | L |
| Camp Four | Box/cylinder props | **Hero camp**: authored tents (canvas with sag and stains), the dinner table + stove + plates, crates with stencil/chalk decals, the roster board, Marta's cot (photo tins), radio mast; baked lightmaps; footprints in dried mud | ★ | L |
| Theodolite | Primitive model | Hero prop (brass, glass, wood tripod) with an interaction animation | ★ | M |
| Red-rock cliff | Box colliders dressed with rock; climbable "slab" panels | Sculpted hero cliff with **integrated chalked climb zones**, pitons of three ages, ribbons, and `COL_`/`CLIMB_` proxies authored in Blender | ★ | XL |
| Waterfall & pool | Two sheets + particles | Lip geometry, flow-mapped layered sheets, impact foam, spray, mist, pool flow and ripples (§21.1) | ★ | L |
| Gate of the Watching Sun | Flat wall + square blocks | **Hero landmark**: carved gate with relief murals (Krita height maps → baked normals), **round carved drums** (bible says drums), "M.K." scratch, sunset lighting | ★ | XL |
| Gate opening | Door slides + bursts | Sequence with dust volumes, debris, camera staging, Ines's brace and reaction (§39) | ★ | L |
| City reveal vista | Grid of identical boxes and trees, bronze ring (SB-08) | Carved-into-rock terraces with varied silhouettes, aqueducts, hanging gardens, mist layers, impostor-based detail; composed from the overlook camera | ★ | XL |
| Lighting | Dynamic sun + camera-following character lights | Baked lightmaps + probes + sun, per-zone fog, Ch1 LUT; remove the camera lights | ★ | L |
| Audio | Synthesized | Recorded/CC0 foley, reverb zones, Marta motif | | M |

**Ch1 rebuild exit criteria:**
- §55 AAA Visual Acceptance passed for all 12 Ch1 hero frames;
- §28 budgets met on all four tiers;
- all gameplay tests green;
- external playtest ≥ 5 people.

## 45. Story Bible Review

The bible is strong, and Chapter 1 follows it closely: collectible text matches §13 verbatim, and the puzzle logic and sun direction are correct. **None of the items below have been changed.** Each needs approval.

| ID | Existing version | Problem | Proposed change | Reason | Gameplay impact | Narrative impact |
|---|---|---|---|---|---|---|
| SB-01 | §8 Ch1: all three pages + token at Camp Four | Implementation puts page 2 (the sketch) at the cliff base | Amend the bible: page 2 at the foot of the cliff route | Clue placed near its use | None | Better pacing |
| SB-02 | Page 3 dated 2 June (after the inner wall), found at Camp Four | When/why Camp Four was abandoned is unstated | Timeline: Camp Four stays the supply camp until mid-June; abandoned the night Edmund flees | Explains dinner on the stove | None | Strengthens reveal #1 |
| SB-03 | Gate opened in May 1958; closed and scrambled in 2026 | Who resealed it? | Varne and Marta close it and set the drums to the water-sign | Logic hole | Optional Serpent start face | Supports "chose to disappear" |
| SB-04 | The route "collapsed behind" Edmund; he never found the way back | The Ch1 route is intact; Edmund knew Camp Four | The charges collapsed the descent *below* the overlook; Edmund couldn't reopen the gate (never learned the drums); Tamsa Alta guides refused searches | Plot hole | Ch2 starts by finding a new way down | Edmund's failure becomes believable |
| SB-05 | Corwin needs Toby's route despite Edmund's diaries | Why? | The diaries prove the city but can't get past the gate; Toby sold Marta's letter, the route and the radio frequency | Logic fix | The crew arrives after the gate opens | Betrayal of *Marta's* secret |
| SB-06 | No present-day in-world clock | Lighting/puzzles depend on it (Ch1 dusk, Ch5 noon) | Add a present-day timeline (e.g. Day 1 dusk → Day 2 noon) | Required for lighting design | Sets every chapter's lighting | Tightens pacing |
| SB-07 | Toby (afraid of heights) follows via the "rope route" | How does he climb the Ch1 route? | Ines fixes a rope at the end of Ch1/start of Ch2 | Plausibility | Rope-fixing beat | Seeds his Ch5 moment |
| SB-08 | Ch1 vista: a bronze ring atop a sun tower (code only) | Could be mistaken for the Lens | Make it stone, or add the "sun tower" to the bible as a calendar aperture | Protect the Lens reveal | Art change | Protects reveal #5 |
| SB-09 | Plates prove the team alive "after the date Edmund said" | No date stated | Add Edmund's claimed date (e.g. 4 June 1958); plates dated later | Concrete reveal | Ch2 collectible text | Satisfying contradiction |
| SB-10 | Two epilogue versions (§8 vs §10) | Order/locations unclear | Tamsa Alta → montage → grave (V.O.) → ribbon at the cliff trail | Clarity | Cinematic planning | Ines's arc |
| SB-11 | Ines carries a "canvas satchel" | Model has a large backpack | Satchel + small daypack, or satchel only | Accuracy | Character art | None |
| SB-12 | No combat specified | Scope | Record "no player weapons; Dace resolved by set-piece" | Scope | Removes combat | Tone |
| SB-13 | 1979 recording text not written | Emotional centrepiece missing | Write canon text before Ch5 | Lock early | Ch5 timing | Central |
| SB-14 | Canon collectible text only for Ch1 | Ch2–5 have none | Add per chapter before production | Bible authority | Blocks collectibles | — |

**Implementation note:** `CH1.fallRespawn` is unused. Wire it to the first lethal fall.

---

# PART VI — CURRENT STATE

## 46. Current Implementation Audit

**Inspected:**
- docs (bible, README, licences, configs);
- all 12,309 lines of TypeScript across 79 files (core systems read in full, others surveyed);
- test, playtest and generator scripts;
- 13 README screenshots + 17 fresh captures.

**Ran:** `npm ci`, `npm run build`, the playtest (3 configurations) and the collision test (Appendix A).

### Current State Table

Quality: 1 = stub · 2 = placeholder · 3 = functional prototype · 4 = solid, needs polish · 5 = production-ready.

| System | Current state (evidence) | Quality | Problems | Required work | Priority |
|---|---|---|---|---|---|
| Build/tooling | Build passes; 109 modules; three 855 KB (248 KB gz) | 4 | Vite dynamic-import warning; no linter/unit tests/CI | ESLint, Vitest, CI | P1 |
| Game loop/clock | `maxDelta = 1/20` | 3 | Slow motion below 20 FPS | Fixed timestep; deterministic clock | **P0** |
| Chapter framework | Lazy chapters, manifests, checkpoint snapshots | 4 | Triggers/objectives hard-coded | Data-driven | P1 |
| Player controller | Kinematic mode machine, coyote/buffer | 3–4 | Traversal bypasses collision | Collision-aware traversal | P1 |
| Collision | Cylinder vs boxes/cylinders + heightfield | 3 | Missing proxies (small rocks, camp props); mismatched shapes | Authored `COL_` + BVH; sweep test | **P0** |
| Camera | Spring arm (5 rays), framing, hints, shake | 3–4 | Inside-box rays ignored; no occluder fade; instant cut into cinematics; per-frame allocations | §12 | P1 |
| Animation | Phase-synced locomotion, crossfades, lean, head look | 3 | 17 bones; no IK; no starts/stops; lerped traversal | AnimGraph + new rig | **P0** |
| Characters | Primitive-built GLBs; vertex colours; forced roughness | **2** | Mannequins | §35 | **P0** |
| Traversal | All verbs pass the playtest | 4 function / 2 visual | Slabs; no corners; linear queries | §15 | P1 |
| Puzzle | Drums, persisted, hints | 4 | Code-defined | Data-driven | P2 |
| Cinematics | Shots, skip safety, blend-out | 3–4 | Camera-only | §39 | P1 |
| Dialogue/collectibles/journal | Verbatim canon text | 4 | No ducking; unused line | §23 | P2 |
| Save/load | Versioned, migrations, backup, exact restore | 4 | No profile/fixtures | §25 | P1 |
| Settings | Graphics/audio/controls, rebinding | 4 | Limited accessibility | §24 | P2 |
| Quality presets | LOW/MED/HIGH, adaptive HIGH | 3 | LOW ≈ MED in cost; no ULTRA | §27 | **P0** |
| Performance | Instancing, LOD, merging | 2–3 (integrated GPU) | 12–15 FPS at 1600×900 on Intel UHD | §28 | **P0** |
| Terrain | Analytic heightfield, splat, cavity AO | 3–4 | Hard to art-direct | Hybrid | P2 |
| Vegetation | Instanced species, LOD, wind | 3 | Few species; repeats; speckled canopies | §21.2 | P1 |
| Foliage interaction | Shader push (player only) | 3 | Single actor; translation | GPU field | P1 |
| Water | River ribbon, layered waterfall | 3 | Flat-reading sheet; no lip | §21.1 | P1 |
| Lighting/post | HDR, GTAO, bloom, AA, ACES, grade, fog, DOF, shafts | 3–4 | No baking/probes/auto-exposure; camera-light hack | §8, §38 | **P0** |
| Materials | Procedural PBR textures | 2–3 | Limited variation; uniform character roughness | §9 | **P0** |
| Audio | Fully synthesized, adaptive score | 3–4 | Synth foley | §23 | P2 |
| UI | Menus, HUD, journal, minimap | 4 | No chapter select/gamepad nav | §24 | P2 |
| Input | KBM, touch, rebinding | 4 | Gamepad stub | Implement | P1 |
| Chapters 2–5 | Registry stubs | 1 | Not started | Phase 9 | Planned |
| Tests | 51-check playtest, collision test | 3 | macOS-only flag; wall-clock waits; teleports; tautological check | §53 | **P0** |
| Docs | README, bible, licences | 3 | Unqualified perf/test claims | Update | P2 |

**Architecturally production-grade (keep):** `StateRegistry`/`Persistable`/`SaveManager`, `ChapterManager`, `InputManager`, cinematic skip guarantee, `AnimationDriver` interface, `EventBus`, `GameClock` pausing.

**Placeholder technology:** characters, camera-following character lights, gorge vista, synthesized foley, hand-placed collision, code-defined levels.

## 47. Known Problems

| # | Problem | Evidence | Severity |
|---|---|---|---|
| K1 | Simulation slows below 20 FPS | `GameClock.ts` `maxDelta = 1/20` | High |
| K2 | Playtest fails unmodified on Windows/Linux | `--use-angle=metal` → SwiftShader | High |
| K3 | Test results depend on GPU speed | 39/51 vs 50/51 on the same machine | High |
| K4 | LOW isn't low (1.0–1.2 M tris, ~270 calls, 13 FPS) | Appendix A | High |
| K5 | Small rocks (≤ 0.5 scale) have no collider | `Ch1World.ts:293` | Med–High |
| K6 | Stove, cots, campfire, one tent have no colliders | `Ch1World.ts:420–430` | Medium |
| K7 | Cylinder proxies don't match non-uniform rock scale | `Ch1World.ts:292–293` | Medium |
| K8 | Traversal moves bypass collision | `Player.ts` vault/climbUp/mount/narrow | Medium |
| K9 | Camera ray ignores boxes it starts inside | `Colliders.ts` `rayBox` | Medium |
| K10 | Instant cut into cinematics | `CinematicDirector.play` | Low–Med |
| K11 | Mannequin characters; uniform material | Screenshots; `CharacterAvatar.ts` | High |
| K12 | No IK: floating feet, hands miss ledges | `AdditiveLayers.ts` | High |
| K13 | Waterfall reads as a static sheet | `waterfall.jpg` | Medium |
| K14 | City vista is a grid of identical boxes/trees | `city-reveal.jpg` | Medium |
| K15 | Bronze ring may read as the Lens | SB-08 | Medium |
| K16 | Collision test passes trivially | `collision-test.mjs` lines 27–30, 55 | Medium |
| K17 | Playtest teleports; the real route is never walked | `playtest.mjs` | Medium |
| K18 | Gamepad not implemented | `GamepadProvider.ts` | Medium |
| K19 | Per-frame allocations | `CameraRig.compose` etc. | Low |
| K20 | Vite dynamic-import warning | Build log | Low |
| K21 | `fallRespawn` unused | `ch1.ts:78` | Low |
| K22 | Perf/test claims lack hardware context | README | Low |
| K23 | Drums are square blocks; the bible says carved drums | `pt-08-drums.png` | Medium (visual) |
| K24 | Climbable walls read as painted slabs | `cliff-climb.jpg` | Medium (visual) |

## 48. Technical Debt

1. Levels as code (`Ch1World.ts` ~48 KB, `Chapter1.ts` ~35 KB).
2. Hand-placed collision.
3. Variable timestep with a slow-motion cap.
4. Wall-clock tests.
5. No linter, unit tests or CI.
6. Lighting hacks (camera-following lights).
7. Procedural character generator (to retire).
8. Hard-coded narrative ladders (`objective()`, `objectiveTarget()`, `CHECKPOINT_ORDER`).
9. Linear traversal queries.
10. No GPU-memory/allocation profiling.
11. **Not a git repository:** no history, no rollback.

## 49. Remaining Features

★ = v1.0 required; ○ = stretch.

- **Core:** ★ fixed timestep · ★ deterministic tests · ★ CI · ★ profile store · ★ chapter select · ★ gamepad · ★ ULTRA preset · ○ 3 manual slots
- **Characters/animation:** ★ final Ines/Toby/Corwin/Dace/crew/elder · ★ AnimGraph · ★ IK · ★ facial · ★ spring bones · ★ full clip set
- **Traversal:** ★ collision-aware · ★ corners/polylines · ★ ledge hop · ★ rope verbs · ★ beams · ★ collapsing surfaces · ★ wading · ○ swimming (D10)
- **Environment:** ★ level pipeline · ★ Ch1 rebuild · ★ 4 new chapters · ★ material library · ★ lightmaps/probes · ★ occlusion zones
- **VFX/water/foliage:** ★ §21–§22 library
- **Cinematics:** ★ track system · ★ ~14 new sequences
- **Audio:** ★ recorded/CC0 foley · ★ reverb zones · ★ themes · ○ VO (D8)
- **UI:** ★ accessibility · ★ gamepad nav · ★ credits
- **Pipelines:** ★ `assets:build` · ★ `assets:check` (licence + budget) · ★ benchmark scene

---

# PART VII — PLAN & QUALITY GATES

## 50. Production Phases

Order as requested by the project owner, with one **recommended adjustment** (D11).

### Requested order
1. Performance + architecture
2. Final Ines
3. Animation pipeline
4. Rebuild the Chapter 1 environment
5. Lighting/material/VFX/audio polish
6. Cinematic system
7. Engine comparison benchmark
8. Lock the final engine/toolchain
9. Chapters 2–5
10. Full-game QA
11. Demo build

### Recommended adjustment (D11)

**Move Phase 7 (benchmark) to run immediately after Phase 2.**
- **Why:** Phases 4–6 contain substantial *engine-specific code*: material shaders, lightmap/probe integration, the GPU foliage field, VFX runtime, the cinematic runtime. If the benchmark selects a different engine at Phase 8, that code is rewritten.
- **What's safe:** assets from Phases 2–6 (models, textures, mocap, audio, storyboards, Blender-blocked cinematics) are engine-agnostic.
- **What the benchmark needs:** Ines v1 from Phase 2, plus a small asset set built during Phase 2.
- **Cost of the adjustment:** ~0. **Risk avoided:** up to ~10–15 dev-weeks of rework.
- **If you keep the requested order:** Phases 4–6 must keep engine-specific code minimal, isolated behind interfaces, and favour data/asset work.

### Phase details

| Phase | Features | Dependencies | Complexity | Technical risks | Tests | Visual goals | Definition of done |
|---|---|---|---|---|---|---|---|
| **0 Audit** ✅ | Audit, PRD v0.1/v0.2 | — | S | — | Build/playtest/collision runs | — | PRD approved; Appendix B answered |
| **1 Performance + architecture** | `git init`; fixed timestep; deterministic clock; cross-platform route-walking playtest; collision overhaul + sweep tests; real LOW + new ULTRA preset; dynamic resolution; camera fixes (sphere cast, occluder fade, blend-in); spatial index; ESLint/Vitest/CI; gamepad; `assets:build` + `assets:check` scaffolding; licence registry format | Phase 0 | **L** (4–6 dev-wk) | Feel changes from fixed timestep; LOW budget may need visible density cuts | All existing checks green on Intel UHD at 1600×900 and in CI; penetration sweep 0; camera sweep 0 | No regression vs current screenshots | LOW ≥ 30 FPS @720p on Intel UHD; CI green |
| **2 Final Ines** | Concept → MakeHuman base → sculpt → gear → retopo → bakes → textures → hair → eyes/teeth → Rigify rig + shape keys → LODs → lookdev scene; Toby v1 base | Phase 1 (lookdev scene); D1 approved | **XL** (6–10 artist-wk Ines; +3–5 Toby) | Art capacity; likeness/uncanny valley | §10.2 gates; budget check | Ines readable, premium in close-up | Close-up gates pass in the lookdev scene on HIGH and LOW |
| **(7 Benchmark — recommended here)** | §54 | Ines v1 | **M** (3–5 dev-wk) | Uneven effort per engine biases results | §54 metrics | — | Decision recorded with data |
| **3 Animation pipeline** | Retarget pipeline; event markers; AnimGraph; IK (feet/hands/look/eyes); motion warping; spring bones; facial layer; full Ines clip set; debug overlay | Phase 2 rig | **XL** (6–10 wk) | Retarget quality; climbing must be hand-keyed; IK cost on LOW | §11.3 automated checks | No floating feet, hands on ledges, living face | §11.3 passes on the full Ch1 route |
| **4 Rebuild Ch1 environment** | Level pipeline + `LevelLoader`; Blender grey-box parity; hero assets (§42 Ch1); modular kits + trim sheets; foliage species + impostors; sculpted cliff with integrated climb zones; gate + drums; city vista; story traces | Phases 1–3 | **XL** (8–12 wk art + 3–4 dev) | Art throughput; budgets after art | Route playtest; reachability; perf | Every space composed from its establishing view | §44 exit criteria minus final polish |
| **5 Lighting/material/VFX/audio polish** | Material library (wetness/dirt/edge wear); lightmap + probe bake; auto-exposure; LUTs; water rebuild; GPU foliage field; VFX library; recorded foley; reverb zones; occlusion; music themes | Phase 4 | **L** (4–6 wk) | Bake/compression artefacts; overdraw | §21/§22 acceptance; loudness/sync tests | Screenshots beautiful with UI off | §55 frame review ≥ target for Ch1 |
| **6 Cinematic system** | Track system (§39); Blender-blocked sequences; debug scrubber; restage Ch1's 4 cinematics as film scenes | Phases 3–5 | **L** (4–6 wk) | Pose matching between gameplay and cinematics | Skip-at-every-second; no pure flyovers | Film-staged Ch1 cinematics | §39 acceptance for all Ch1 sequences |
| **7 Benchmark** (if not moved) | §54 | Phases 2–6 | **M** | Same as above | §54 | — | Decision recorded |
| **8 Lock engine & toolchain** | Record the decision; if Three.js: plan the `WebGPURenderer`/TSL port; if a switch: §26.5 migration | Phase 7 | **S** (stay) / **XL** (switch: 10–24 wk) | Migration scope | Parity playtest | Parity | Locked decision + parity green |
| **9 Chapters 2–5** | Per §43; each chapter: beat chart → grey-box → playtest gate → art → lighting → story traces → audio → cinematics → perf → §55 | Phase 8; SB items resolved per chapter | **4 × XL** (Ch2 10–14 wk; Ch3 8–12; Ch4 12–16; Ch5+Ep 10–14, team-dependent) | Content scale; Ch4 destruction; Ch5 emotional performance | Full §53 per chapter | §55 per chapter | §57 per chapter |
| **10 Full-game QA** | Full playthroughs, burn-down, browser matrix, accessibility, licence audit | Phase 9 | **L** | Late perf regressions | §53 complete | Consistent identity across chapters | 0 P0/P1 bugs; 3 external full playthroughs |
| **11 Demo / hackathon** | Curated 10–15 min path (Ch1 final + a Ch2 teaser if available), demo menu, auto-LOW on weak GPUs | Whatever is complete; date (D6) | **S–M** | Venue hardware | 20 consecutive demo runs | Best Ch1 frames | Cold boot → play ≤ 15 s on the demo machine |

## 51. Implementation Order & Difficulty

Effort is in person-weeks (one developer with AI assistance + one Blender artist; the owner if applicable). Estimates are ±50%: re-estimate after Phase 1.

| # | Task | Phase | Difficulty | Effort | Tag |
|---|---|---|---|---|---|
| 1 | `git init`, Git LFS, CI skeleton | 1 | S | 0.5 | 🟢 |
| 2 | Fixed timestep + deterministic test clock | 1 | M | 1–1.5 | 🟢 |
| 3 | Cross-platform, route-walking playtest | 1 | M | 1 | 🟢 |
| 4 | Collision overhaul + sweep tests | 1 | L | 2–3 | 🟢 |
| 5 | Real LOW, ULTRA, dynamic resolution, perf pass | 1 | L | 2 | 🟢 |
| 6 | Camera fixes | 1 | M | 1 | 🟢 |
| 7 | Gamepad | 1 | S | 0.5 | 🟢 |
| 8 | Asset build/check scripts + licence registry | 1 | M | 1 | 🟢 |
| 9 | Ines concept → final model + textures | 2 | XL | 6–10 (art) | 🟢 |
| 10 | Ines rig + shape keys + spring-bone config | 2 | L | 2 | 🟢 |
| 11 | Character lookdev scene | 2 | S | 0.5 | 🟢 |
| 12 | Benchmark scene in 4 engines (recommended here) | 7* | M–L | 3–5 | 🟢 / 🟡 Unity |
| 13 | AnimGraph + IK + motion warping + facial layer | 3 | XL | 4–6 | 🟢 |
| 14 | Clip production (retarget + hand-key traversal) | 3 | XL | 4–8 (anim) | 🟢 |
| 15 | Level pipeline + `LevelLoader` | 4 | L | 2–3 | 🟢 |
| 16 | Ch1 hero assets (gate, drums, theodolite, camp, cliff, city) | 4 | XL | 8–12 (art) | 🟢 |
| 17 | Foliage species + impostors | 4 | L | 3 (art) | 🟢 |
| 18 | Material library + wetness system | 5 | M | 1.5 | 🟢 |
| 19 | Lightmap/probe bake pipeline + runtime | 5 | L | 2–3 | 🟢 |
| 20 | Water + waterfall rebuild | 5 | M | 1.5–2 | 🟢 |
| 21 | GPU foliage interaction field | 5 | M | 1 | 🟢 |
| 22 | VFX library | 5 | L | 2–3 | 🟢 |
| 23 | Audio upgrade (foley, reverb zones, occlusion, themes) | 5 | L | 2–3 | 🟢 / 🟡 |
| 24 | Cinematic track system + scrubber | 6 | L | 2–3 | 🟢 |
| 25 | Restage 4 Ch1 cinematics | 6 | L | 2–3 | 🟢 |
| 26 | Engine lock / migration | 8 | S or XL | 0.5 or 10–24 | — |
| 27 | Toby final + Corwin, Dace, crew, elder | 9 | XL | 12–20 (art) | 🟢 |
| 28 | Ch2 | 9 | XL | 10–14 | 🟢 |
| 29 | Ch3 | 9 | XL | 8–12 | 🟢 |
| 30 | Ch4 | 9 | XL | 12–16 | 🟢 |
| 31 | Ch5 + epilogue | 9 | XL | 10–14 | 🟢 |
| 32 | Full-game QA | 10 | L | 4–6 | 🟢 |

**Realistic total** (1 dev + 1 artist, no engine switch): ~**12–18 months** to v1.0. Chapter 1 final alone: ~**5–7 months**. This depends heavily on art capacity (Risk R1).

## 52. Milestones

| Milestone | Contents | Exit gate |
|---|---|---|
| M0 | PRD v0.2 approved | Owner sign-off + Appendix B |
| M1 Reliable Slice | Phase 1 | CI green; LOW ≥ 30 FPS @720p Intel UHD; sweeps 0 |
| M2 Real Ines | Phase 2 | §10.2 gates in lookdev |
| M2b Engine decision (recommended timing) | Benchmark | Recorded decision with data |
| M3 Living Ines | Phase 3 | §11.3 on the Ch1 route |
| M4 Ch1 World | Phase 4 | Composed, authored Ch1 |
| M5 Ch1 Lit & Alive | Phase 5 | §55 Ch1 frame review |
| M6 Ch1 Final (template) | Phase 6 | **§57 AAA-perceived DoD for Ch1** |
| M7 Engine locked | Phase 8 | Parity green |
| M8–M11 | Ch2, Ch3, Ch4, Ch5+Ep | §57 per chapter |
| M12 Release candidate | Phase 10 | 0 P0/P1 |
| M-Demo | Phase 11 | Demo DoD |

## 53. Testing / QA Plan

| Layer | Tool | Scope | Runs |
|---|---|---|---|
| Unit | Vitest | Motor, colliders, traversal queries, puzzles, save schema/migrations, quality resolution, AnimGraph transitions, licence registry parser | Every commit |
| Deterministic integration | Playwright + `?debug` + sim-time `advance()` | Boot, menu, new game, continue, movement, sprint, jump, traversal, climbing, puzzle, cinematics + skip, pause/resume, save/reload/checkpoint, collectibles, settings, presets, chapter completion | Every commit (CI; software GPU acceptable) |
| Route playtest | Playwright, no teleports | Each chapter's critical path | Nightly + milestones |
| Collision/camera sweep | Playwright/Node | 2,000 headings/region; near-plane sweep | Nightly |
| Animation checks | Bone sampling | Pops, foot slide/float, latency, hand-ledge distance | Nightly |
| Visual regression | Fixed-camera screenshots (UI off) vs approved baselines, perceptual diff | Hero frames per chapter | Nightly (flags changes for review, not auto-fail) |
| Performance | Real reference machines | §56 | Milestones |
| Save fuzz | Node + browser | 1,000 cycles | Milestones |
| Browser matrix | Chromium/Firefox/WebKit + manual Safari | Smoke | Milestones |
| Licence check | `assets:check` | Every asset has a complete registry row | Every commit |
| Visual QA | §55 panel + checklist | Hero frames, cinematics | Milestones |
| External playtests | 5–10 people/chapter | Route/puzzle times, confusion, enjoyment | Per chapter |

**Regression policy:** every fix ships with a failing-then-passing test where practical. Flaky tests are fixed or quarantined within 48 h.

## 54. Visual Benchmark Scene

### 54.1 Purpose
An identical scene, built from **the same glTF/KTX2 assets**, in Three.js, Babylon.js, Unity 6 Web and Godot 4 Web, to choose the engine on evidence.

### 54.2 Content (~60 × 60 m: "the waterfall pool below the red cliff at dusk")

| Element | Spec |
|---|---|
| Ines | Final v1 character (Phase 2), idle + walk + climb loop + IK feet on uneven rocks, blink/eye look |
| Foliage | 5 species, ~20k instances incl. grass, wind + player interaction |
| Rocks | 1 sculpted hero cliff section + 30 instanced boulders, wet/dry materials |
| Water | Pool with flow, depth fade, foam, ripples |
| Waterfall | Lip geometry, layered sheets, spray, mist |
| Ruins | Ysharu wall section with a mural (hero material) |
| Fire | Campfire flipbook + embers + firelight (dynamic point light) |
| Fog | Height fog + 2 mist layers |
| Particles | Spray, mist, dust motes, fireflies (≈ 5k) |
| Lighting | Dynamic sunset sun + shadows; baked lightmap/AO on the ruins/cliff; env map |
| Materials | Wet rock, moss, mud, limestone, bronze, leather, canvas, skin, water |
| Camera | 90 s scripted cinematic path (wide → OTS → close-up on Ines → rack focus to the mural) + a 60 s scripted gameplay walk |

### 54.3 Measurements (per engine × per reference machine × LOW/HIGH)

| Metric | How |
|---|---|
| FPS p50/p95/p99 | Over both camera paths, 3 runs |
| GPU time | `EXT_disjoint_timer_query_webgl2` / WebGPU timestamp queries where available; else derived |
| Draw calls, triangles | Engine stats |
| Memory | JS heap + estimated GPU memory; peak and steady |
| Download size | Compressed transfer, cold cache |
| Load time | Navigation → first interactive frame |
| Visual quality | **Blind panel** (≥ 8 people) rates 6 fixed frames per engine (randomized, unlabeled) on 1–5 for lighting, materials, character, water, foliage, overall |
| Effort | Dev-days to build the scene (recorded honestly) |

### 54.4 Fairness rules
- Same assets, same target look (a reference frame painted in advance).
- **Same timebox per engine:** ~5–8 dev-days each, with Three.js limited to the same timebox (no reuse of polish beyond the asset set).
- Engine-native features are allowed (e.g. the Unity lightmapper vs. a Blender bake) when free.
- Results and raw data are committed to `docs/benchmark/`.

### 54.5 Decision rule
Applied as in §26.4.

## 55. AAA Visual Acceptance Test

### 55.1 Hero frames
Each chapter defines **10–15 hero frames** (fixed camera, UI off), drawn from establishing views, traversal highlights, puzzles and cinematics. Chapter 1's 12 frames:

1. landing/fire two-shot;
2. trail with stela;
3. Camp Four wide;
4. dinner-table close;
5. theodolite POV;
6. cliff climb mid-wall;
7. narrow ledge;
8. waterfall pool;
9. gate approach at sunset;
10. drums close;
11. gate opening;
12. city reveal.

### 55.2 Automatic fail conditions (any one fails the scene)

- [ ] Characters look like mannequins (§10.2 gates).
- [ ] Environments look procedurally repeated (identical assets visible in one frame without variation).
- [ ] Materials look flat (no visible roughness/albedo variation at gameplay distance).
- [ ] Lighting looks generic (no deliberate key/fill/rim; fails the §8.3 luminance separation).
- [ ] Water looks like a flat plane (no flow, depth fade or foam).
- [ ] Foliage visibly repeats (same species/rotation/tint pattern noticeable).
- [ ] Traversal surfaces look painted onto terrain.
- [ ] Characters slide (> 4 cm foot drift).
- [ ] Feet float (> 3 cm on normal terrain).
- [ ] Hands miss ledges (> 5 cm).
- [ ] Cinematics feel like camera flyovers (no character performance beat).
- [ ] Props have no material variation.
- [ ] VFX feel disconnected (no matching audio, no lighting response, hard geometry intersections).
- [ ] Shadows visibly break (acne, peter-panning, cascade seams, light leaks).
- [ ] Camera framing feels accidental (subject on a frame edge, tangents, horizon through the head) in hero frames.
- [ ] Any grid-like repeated buildings, or generic boxes used as hero architecture.

### 55.3 Panel rating
- **Who:** ≥ 8 reviewers (incl. ≥ 3 who play premium adventure games).
- **What:** each hero frame rated 1–5 on character, materials, lighting, composition, atmosphere, overall.
- **Pass:** median **≥ 4.0 overall** and **no category median < 3.5**. Cinematics are rated as clips on staging, performance and transitions, with the same thresholds.

### 55.4 Screenshot test
Every hero frame must "work as a screenshot with no UI": it's used as key art without retouching. The project owner signs off.

### 55.5 Preset parity
On LOW, hero frames may lose effects, but must still pass the fail conditions (they may score ≥ 3.5 instead of 4.0).

## 56. Performance Validation

1. Reference camera paths per chapter (hero frames + a route fly-through) on all four reference machines: FPS p50/p95/p99, GPU time, draw calls, triangles, heap.
2. Budgets are gates: exceeding a §28 budget by > 10% fails the milestone.
3. A 30-min soak: heap growth ≤ 20 MB, FPS degradation ≤ 10%, no context loss.
4. Load tests: cold/warm, boot → menu, chapter load.
5. Adaptive controller: under stress it steps down within 3 s and recovers; ULTRA falls back to HIGH on watchdog trips.
6. Every published performance number states GPU, browser, OS, resolution and preset.

**Baseline (this audit, Intel UHD, ANGLE D3D11):**

| Preset | 1600×900 FPS | 800×450 FPS | Calls | Tris |
|---|---|---|---|---|
| LOW | 13 | 25 | ~270 | 1.0–1.2 M |
| MEDIUM | 12 | 21 | ~290 | 1.2–1.4 M |
| HIGH (adaptive "performance") | 15 | 21 | ~313 | 1.7–1.9 M |

## 57. Definition of Done

### 57.1 Feature/chapter DoD (all required)
1. Works in a running browser (Chrome + Firefox; Safari at milestones).
2. Automated coverage per §53 exists and passes in CI **and** on the low reference machine.
3. No new console errors.
4. No soft-locks (forced failure at every checkpoint).
5. No broken saves (+ migration fixture if the schema changed).
6. No inaccessible objectives or collectibles.
7. §28 budgets on all tiers.
8. Collision and camera sweeps = 0.
9. §11.3 animation criteria.
10. Consistent with the approved bible.
11. Every new asset in the licence registry; `assets:check` green.
12. Docs updated honestly (hardware context for performance).
13. Manual checklist signed off.

**"The code exists" is not done.**

### 57.2 AAA-perceived visual quality DoD (per chapter)

A chapter is **visually Done** only when:

1. **§55 passed:** no fail conditions, panel median ≥ 4.0, all category medians ≥ 3.5, on HIGH. LOW passes the fail conditions with median ≥ 3.5.
2. **Characters:** all on-screen characters pass the §10.2 close-up gates in every cinematic.
3. **Animation:** §11.3 metrics pass on the full chapter route; no cinematic has a looping-idle character on screen > 3 s.
4. **Lighting:** chapter lighting identity (§8.2) implemented; lit-only review passed; LUT and exposure approved.
5. **Materials:** no single-value roughness on any hero asset; wetness/dirt/wear present where the story calls for it.
6. **Hero assets:** every §42 hero item for the chapter is final quality and reviewed in context.
7. **Composition:** every space's establishing view approved as a no-UI screenshot.
8. **Storytelling:** each major area's story-trace sheet (§16.2) implemented at density ≥ 1 trace per 15 m of critical path.
9. **Water/foliage/atmosphere/VFX:** §21–§22 acceptance met, including preset variants.
10. **Audio:** sync (±1 frame on footsteps), loudness (-16 LUFS, no clipping), reverb zones, no silent VFX.
11. **Transitions:** no unintended camera snaps; gameplay ↔ cinematic blends verified.
12. **Performance:** all the above achieved **within** §28 budgets. A visual feature that breaks budgets is cut or moved to ULTRA.

## 58. Risks & Fallbacks

| # | Risk | Likelihood | Impact | Mitigation | Fallback |
|---|---|---|---|---|---|
| R1 | **Art capacity** (no dedicated artist) for characters/heroes | High | Very high | MakeHuman base, CC0 materials, hero-only focus (§42), early lookdev | Reduce the cast's on-screen close-ups; stylise faces slightly; prioritise Ines + Toby; use a CC0 Quaternius-style base for crew |
| R2 | **Integrated-GPU performance** | Medium | High | Measure first; impostors; baked light; dynamic resolution | LOW drops grass/shadows further; 30 FPS cap; recommend MEDIUM+ hardware for the full experience |
| R3 | **Scope** (5 chapters, film-staged cinematics) | High | Very high | Ch1 template; data pipelines; cut optional pockets first | Ship Ch1–3 as "Part One" with the bible's mid-point reveal; Ch4–5 later |
| R4 | **Engine benchmark overturns Three.js** after heavy engine-specific work | Medium | High | **Run the benchmark after Phase 2 (D11)** | Stay on Three.js if the gain is below the switch thresholds |
| R5 | **Licence contamination** | Low–Med | Very high | §33 workflow, CI check, snapshots | Replace the asset; audit trail shows good faith |
| R6 | **Unity licence/terms change** (if chosen) | Low–Med | High | Prefer open-source engines | Keep assets engine-agnostic (glTF/KTX2) |
| R7 | **Uncanny-valley faces** | Medium | High | Stylised realism; strong eyes/blinks; avoid extreme close-ups without facial animation | Wider framing for emotional beats; silhouette/body-language staging |
| R8 | **Climbing animation quality** (mocap rarely fits) | High | High | Hand-key traversal to metrics; motion warping | Fewer climb variants, each polished |
| R9 | **Ch4 destruction** cost/readability | Medium | High | Keyframed debris; storyboard; grey-box first | Shorter escape with more cinematic cuts |
| R10 | **Ch5 emotion without VO** | Medium | High | Facial tracks, staging, music | Record VO for the 1979 recording only (D8) |
| R11 | **Download size** growth | Medium | Medium | KTX2/Meshopt; per-chapter streaming; CI size budget | Lower texture tiers on LOW; on-demand chapter packs |
| R12 | **Look-alike risk** vs reference franchises | Medium | High | §6 guardrails; milestone look-alike reviews | Redesign the flagged element |
| R13 | **Browser variance** (Safari, WebGPU differences) | Medium | Medium | WebGL 2 baseline; matrix testing | Disable the offending effect per browser |
| R14 | **Test flakiness** | Medium | Medium | Sim-time tests; quarantine | — |
| R15 | **No version control today** | Certain | High | `git init` + LFS before Phase 1 | — |

## 59. Future Improvements

- Full WebGPU-only effects: froxel volumetrics, GPU-driven culling.
- Voice acting + lip-sync.
- Photo mode (fits Marta's photographer motif).
- New Game+ with Marta commentary.
- The bible-sanctioned sequel hooks (the ninth facet, other sealed cities).
- Localisation.
- Controller haptics.

---

## Appendix A — Audit evidence log (2026-10-04)

**Environment:** Windows 11 Home 10.0.26200 · Node v25.8.1 · Chrome via Playwright · Intel UHD Graphics (0xA78B), ANGLE D3D11.

1. `npm ci` succeeded (`node_modules` was absent).
2. `npm run build`: tsc clean; 109 modules in 943 ms; warning `INEFFECTIVE_DYNAMIC_IMPORT` (Bindings.ts). Chunks: three 855 KB (248 KB gz), index 143 KB (48 KB gz), Chapter1 108 KB (38 KB gz).
3. Dev server on port 5199 (5173 was occupied by another process, left untouched).
4. Playtest unmodified: SwiftShader detected; 2 checks, then a timeout. Exit 1.
5. Playtest with `--use-angle=d3d11` at 1600×900: **39/51**. A cascade from the slowed simulation. LOW 13 FPS/270/1,016k; MED 12/290/1,220k; HIGH-perf 15/313/1,742k. 0 console errors.
6. Same at 800×450: **50/51**. Remaining failure: a race (puzzle solve delay). LOW 25/269/1,202k; MED 21/289/1,406k; HIGH-perf 21/312/1,929k. 0 console errors.
7. Collision test: 5/5 pass, but weak (K16).
8. Debug overlay sample, 1280×720 MEDIUM: 12 FPS · 81 ms · 294 calls · 1,213k tris.
9. Screenshots reviewed: toby-campfire, waterfall, cliff-climb, city-reveal, pt-08-drums, col-rock.
10. The project is **not a git repository**.

No repository file was modified by the tests (scripts were piped with only the GPU flag/viewport substituted).

## Appendix B — Decisions required

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Character sourcing | MakeHuman base + original work (🟢) · fully original sculpt (🟢) · procedural (🔴 quality) | **MakeHuman base + original sculpt/gear in Blender** |
| D2 | Animation sourcing | Quaternius UAL + CMU + hand-keyed traversal (🟢) · own capture (🟡) · Mixamo (🟡, not shipped) | **Quaternius + CMU + hand-keyed traversal** |
| D3 | Story bible SB-01…SB-14 | Approve/modify/reject each | Approve 01–07, 09, 12; discuss 08, 10, 11, 13, 14 |
| D4 | Combat | None · light combat | **None** |
| D5 | Reference hardware | Confirm the §28 tiers | Include this Intel UHD laptop as Low |
| D6 | Demo/hackathon date | — | Needed to schedule Phase 11 |
| D7 | Minimap default | On · off + objective nudge | Off after Ch1 polish |
| D8 | Voice acting | None · Ch5 recording only · full | Ch5 recording only, if feasible |
| D9 | Version control | `git init` + LFS now | **Yes, before Phase 1** |
| D10 | Ch5 flooded passage | Swim verb · scripted wading | Scripted wading |
| D11 | Benchmark timing | As requested (Phase 7) · **after Phase 2** | **After Phase 2** |
| D12 | Commercial intent | Free release · commercial | Needed: it affects 🟡 items (Unity revenue cap, Cascadeur, CC-BY-NC exclusion is already assumed) |
| D13 | Artist resourcing | Owner learns Blender · volunteer/commission (free-tool constraint applies to tools, not people) | Decide before Phase 2 |

## Appendix C — Licence research log (2026-10-04, pre-screen via web research; re-verify on primary pages at intake)

| Item | Finding | Source |
|---|---|---|
| Unity Personal | Free up to $200k annual revenue + funding; splash screen optional since Unity 6 | https://unity.com/products/pricing-updates · https://toolaipilot.com/blog/will-unity-6-be-free-i-looked-at-every-pricing-tier-unity-offers-in-2026-and-here-is-what-you-actually-pay-and-what-you-do-not |
| Unity Web | WebGPU production-ready in 6.6 with WebGL 2 fallback; empty URP web build ≈ 10.7 MB | https://discussions.unity.com/t/webgpu-out-of-experimental-in-unity-6-6/1734694 · https://gist.github.com/aras-p/740c2d4f9977ce92b7de72b1394dd365 |
| Unity Asset Store | Assets distributable only as integrated parts of games; no raw redistribution | https://discussions.unity.com/t/redistribution-of-free-assets-from-the-asset-store/470126 |
| Godot Web | Compatibility (WebGL 2) renderer only; no WebGPU; no C# web export in Godot 4; single-threaded export since 4.3; SIMD default in 4.7 | https://docs.godotengine.org/en/latest/tutorials/export/exporting_for_web.html · https://godotengine.org/article/progress-report-web-export-in-4-3/ · https://app.cinevva.com/guides/godot-vs-unity-web-games |
| Babylon.js | WGSL + GLSL core shaders since 8.0; 9.0 adds clustered lighting and WebGPU volumetric lighting | https://blogs.windows.com/windowsdeveloper/2025/03/27/announcing-babylon-js-8-0/ · https://app.cinevva.com/guides/webgpu-vs-webgl-games |
| Three.js WebGPU | `WebGPURenderer` production-ready since r171 with automatic WebGL 2 fallback; TSL → WGSL/GLSL | https://threejs.org/manual/en/webgpurenderer.html · https://www.utsubo.com/blog/webgpu-threejs-migration-guide |
| MakeHuman | Exported models may be used under CC0 (exception: official unmodified build, export function) | http://www.makehumancommunity.org/content/license.html · http://www.makehumancommunity.org/content/license_explanation.html |
| MB-Lab | Generated models carry AGPL 3 | https://mb-lab-docs.readthedocs.io/en/latest/license.html · https://github.com/animate1978/MB-Lab/wiki/Asset-Licensing |
| CharMorph | Base characters CC0 (Vitruvian) or CC-BY | https://www.cgchannel.com/2025/03/check-out-new-open-source-3d-character-generator-charmorph/ |
| CMU Mocap | Free for all uses incl. commercial; no resale of raw data | https://www.re3data.org/repository/r3d100012183 |
| Quaternius UAL | CC0 | https://quaternius.itch.io/universal-animation-library |
| Mixamo | Royalty-free in games; raw-file redistribution prohibited | https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html |
| Cascadeur | Free plan non-commercial only; Indie plan < $100k revenue is paid | https://cascadeur.com/plans · https://cascadeur.com/help/faq |
| Rokoko Vision | Free starter plan; FAQ says generated data is commercially usable | https://www.rokoko.com/products/vision · https://support.rokoko.com/hc/en-us/articles/29449288418065-Rokoko-Vision-Terms-of-Use |
| FreeMoCap | AGPLv3+ software; commercial licensing negotiable | https://github.com/freemocap/freemocap |
| ArmorPaint | zlib source (free to compile); prebuilt binaries paid | https://github.com/armory3d/armorpaint/blob/main/license.md |
| Material Maker | MIT | https://github.com/RodZill4/material-maker |
| Poly Haven | CC0 | https://polyhaven.com/license |
| ambientCG | CC0 | https://ambientcg.com/ |
| Kenney | CC0 | https://kenney.nl/support |
| OpenGameArt | Per asset: CC0, CC-BY, CC-BY-SA, OGA-BY, GPL | https://en.wikipedia.org/wiki/OpenGameArt.org |
| Sketchfab | Per model CC licences incl. NC/ND | https://sketchfab.com/blogs/community/refine-downloadable-model-searches-with-new-license-filters/ |
| BlenderKit | CC0 or Royalty-Free (RF requires non-extractable use) | https://www.blenderkit.com/articles/our-position-on-cc0-models/ |
| Freesound | CC0 / CC-BY / CC-BY-NC per sound (+ legacy Sampling+) | https://en.wikipedia.org/wiki/Freesound · https://creativecommons.org/2011/09/12/celebrating-freesound-2-0-retiring-sampling-licenses/ |
| Sonniss GDC bundle | Royalty-free, commercial, no attribution; no standalone redistribution; no AI training | https://sonniss.com/gdc-bundle-license/ |

*Not verified in this pass (marked 🟡 where used): `three-mesh-bvh`, `three.quarks`, MPFB2 asset terms, Expy Kit, Pixabay sound licence, Fab/Megascans current terms, Ardour binaries. Verify at adoption.*
