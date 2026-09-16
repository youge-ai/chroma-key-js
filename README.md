# chroma-key-js

Dependency-free chroma keying (green screen removal) in the browser, using YCbCr chroma distance with edge feathering and spill suppression.

This is the algorithm behind [chromakeyremover.com](https://chromakeyremover.com) — extracted as a standalone ES module so you can drop it into your own project.

## Why another chroma key library?

Most background-removal tooling either uploads your image to a server or pulls in a multi-megabyte machine-learning model. For a *solid colour* backdrop you do not need any of that: comparing chrominance in the Cb-Cr plane is a few lines of arithmetic and runs at interactive speed on a phone.

This library is for the case where your background really is a known flat colour — a green screen, a blue screen, or any single key colour you can pick with an eyedropper.

## Install

No build step, no dependencies. Copy `src/chroma-key.js` into your project, or:

```bash
npm install chroma-key-js
```

## Usage

```js
import { chromaKey, removeBackground } from 'chroma-key-js';

// Low level: mutate an ImageData you already have
const imageData = ctx.getImageData(0, 0, w, h);
chromaKey(imageData, '#00b140', 35, 2, 30);
ctx.putImageData(imageData, 0, 0);

// Convenience: File/Blob in, canvas out
const canvas = await removeBackground(file, {
    keyHex: '#00b140',
    threshold: 35,
    feather: 2,
    despill: 30
});
document.body.append(canvas);
```

## Parameters

| Parameter | Range | Default | What it does |
|---|---|---|---|
| `keyHex` | `#rrggbb` | `#00b140` | The background colour to remove. Any colour works, not just green. |
| `threshold` | 0–120 | 35 | Cut-off on Cb-Cr distance. Higher removes more, but starts eating into the subject. |
| `feather` | 0–15 | 2 | Width of the soft edge band. `0` gives a hard, aliased edge. |
| `despill` | 0–100 | 30 | How aggressively to remove colour spill (green bounce light) from the subject's edges. |

## How it works

Three passes over the pixel buffer:

1. **Chroma distance.** Each pixel is converted to YCbCr (BT.601 coefficients). We ignore luma entirely and take the Euclidean distance in the Cb-Cr plane from the key colour. Pixels closer than `threshold - feather` become fully transparent; pixels beyond `threshold + feather` stay opaque; the band between them gets a linear alpha ramp. Working in Cb-Cr rather than raw RGB is what makes this robust to shadows and uneven lighting — a darker patch of the same green screen lands in roughly the same place on the chroma plane.

2. **Edge softening.** The alpha channel is blended 50/50 with a box-blurred copy of itself, which turns the stair-stepped mask edge into a smooth transition. The blur radius is capped at 5 px so large images stay responsive.

3. **Spill suppression.** Real footage bounces green light onto the subject. Wherever the green channel exceeds the average of red and blue, we pull it back proportionally to `despill`. Without this the subject keeps a green halo.

## Caveats

- **Flat backgrounds only.** This does no semantic segmentation. It cannot separate a person from a busy living room — that needs a model, not an arithmetic trick.
- **Soft-edge radius is capped** at 5 px for performance. Very large `feather` values on very large images will not blur proportionally.
- **Third pass mutates colour channels**, not just alpha. If you need the unmodified RGB, keep a copy before calling.

## Demo

Open `demo/index.html` over any static server (ES modules need `http://`, not `file://`):

```bash
npx serve .
```

## License

MIT
