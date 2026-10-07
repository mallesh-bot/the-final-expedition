# Asset Licenses

Every file shipped under `public/assets/` must have a row in the **Registry** below, added in the same commit as the asset. `npm run assets:check` fails if a file is missing from the registry or a row is missing a required field. Workflow and rules: `PRD.md` §32–§33.

**Rejected outright:** ripped/extracted/leaked game assets · "free for personal use" · NC or ND licences · unclear or missing licences · licences that require assets to be "non-extractable" (a browser game's files can always be downloaded) · AGPL-propagating generator output (e.g. MB-Lab).

## Registry

| Path | Asset | Creator | Source | Licence | Licence URL | Modify | Redistribute (web) | Attribution | Verified |
|---|---|---|---|---|---|---|---|---|---|
| `public/assets/models/characters/ines.glb` | Ines (protagonist) | Quaternius (Universal Base Characters, Modular Character Outfits — Fantasy, Universal Animation Library 1 & 2) + project | `tools/character/build_simple.py` + `tools/character/simple/ines.json` (https://quaternius.itch.io/universal-base-characters, https://quaternius.itch.io/modular-character-outfits-fantasy, https://quaternius.itch.io/universal-animation-library) | CC0 1.0 + project-owned modifications | https://creativecommons.org/publicdomain/zero/1.0/ | Yes | Yes | None (credit given voluntarily) | 2026-10-04 |
| `public/assets/models/characters/toby.glb` | Toby (second lead) | Quaternius (Universal Base Characters, Modular Character Outfits — Fantasy, Universal Animation Library 1 & 2) + project | `tools/character/build_simple.py` + `tools/character/simple/toby.json` (https://quaternius.itch.io/universal-base-characters, https://quaternius.itch.io/modular-character-outfits-fantasy, https://quaternius.itch.io/universal-animation-library) | CC0 1.0 + project-owned modifications | https://creativecommons.org/publicdomain/zero/1.0/ | Yes | Yes | None (credit given voluntarily) | 2026-10-04 |
| `public/assets/models/characters/corwin.glb` | Corwin Aldercott (antagonist) | Quaternius (Universal Base Characters, Modular Character Outfits — Fantasy, Universal Animation Library 1 & 2) + project | `tools/character/build_simple.py` + `tools/character/simple/corwin.json` (https://quaternius.itch.io/universal-base-characters, https://quaternius.itch.io/modular-character-outfits-fantasy, https://quaternius.itch.io/universal-animation-library) | CC0 1.0 + project-owned modifications | https://creativecommons.org/publicdomain/zero/1.0/ | Yes | Yes | None (credit given voluntarily) | 2026-10-06 |
| `public/assets/models/characters/dace.glb` | Dace Holloway (crew foreman) | Quaternius (Universal Base Characters, Modular Character Outfits — Fantasy, Universal Animation Library 1 & 2) + project | `tools/character/build_simple.py` + `tools/character/simple/dace.json` (https://quaternius.itch.io/universal-base-characters, https://quaternius.itch.io/modular-character-outfits-fantasy, https://quaternius.itch.io/universal-animation-library) | CC0 1.0 + project-owned modifications | https://creativecommons.org/publicdomain/zero/1.0/ | Yes | Yes | None (credit given voluntarily) | 2026-10-06 |
| `public/assets/models/characters/elder.glb` | Doña Ayme Anca (epilogue) | Quaternius (Universal Base Characters, Modular Character Outfits — Fantasy, Universal Animation Library 1 & 2) + project | `tools/character/build_simple.py` + `tools/character/simple/elder.json` (https://quaternius.itch.io/universal-base-characters, https://quaternius.itch.io/modular-character-outfits-fantasy, https://quaternius.itch.io/universal-animation-library) | CC0 1.0 + project-owned modifications | https://creativecommons.org/publicdomain/zero/1.0/ | Yes | Yes | None (credit given voluntarily) | 2026-10-06 |
| `public/assets/voice/*.ogg` | Voice acting: every subtitle line (generated) | Project (performances synthesized locally) | `tools/voice/generate.mjs` with Kokoro-82M v1.0 (hexgrad/Kokoro-82M via onnx-community/Kokoro-82M-v1.0-ONNX and kokoro-js; https://huggingface.co/hexgrad/Kokoro-82M) | Apache-2.0 (model and voices; generated audio is project output) | https://www.apache.org/licenses/LICENSE-2.0 | Yes | Yes | None required (credited voluntarily) | 2026-10-07 |
| `public/assets/models/temp/ines_temp.glb` | Legacy procedural Ines (no longer rendered; source of the project-owned traversal clips) | Project | `scripts/gen-temp-character.mjs` | Project-owned | — | Yes | Yes | None | 2026-10-04 |
| `public/assets/models/temp/toby_temp.glb` | Legacy procedural Toby (no longer rendered; source of the project-owned traversal clips) | Project | `scripts/gen-temp-character.mjs` | Project-owned | — | Yes | Yes | None | 2026-10-04 |

## Generated at runtime (no files shipped)

| Asset | Source | Licence |
|---|---|---|
| All textures (stone, cliff, masonry, moss, ground, bark, canvas, wood, rust, water, foliage atlas, glyphs, murals, stencils, particles) | `src/render/textures/ProceduralTextures.ts` | Project-owned |
| All geometry (terrain, rocks, vegetation, ruins, props, gorge city) | `src/world/*`, `src/chapters/ch1/*` | Project-owned |
| All audio (ambience, footsteps, mechanisms, UI, adaptive music) | `src/audio/*` | Project-owned |

## Libraries & tools

| Item | Licence |
|---|---|
| Three.js (runtime, incl. DRACO/Basis decoders copied to `public/decoders`) | MIT |
| Fonts | System fonts only (not bundled) |

## Credits

Assets requiring attribution (CC-BY, CMU mocap) must be listed here and in the in-game credits. *None required yet.* Voluntary thanks: Quaternius (Universal Base Characters, Modular Character Outfits, Universal Animation Library 1 & 2, all CC0).

## Tools used (not shipped)

Blender 4.5 LTS (GPL; output is ours) · MPFB 2 (GPL; exported characters CC0 via the MakeHuman licence exception) · the official MakeHuman system asset pack (CC0). Licence snapshots: re-verify at each milestone (PRD §33).
