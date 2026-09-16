/**
 * chroma-key-js — dependency-free chroma keying in the browser
 *
 * Removes a solid-colour background (green screen, blue screen, any key colour)
 * from an image using YCbCr chroma distance, with edge feathering and
 * spill suppression.
 *
 * This is the algorithm that powers https://chromakeyremover.com
 *
 * MIT License
 */

/**
 * Convert an RGB triplet to YCbCr.
 * Standard ITU-R BT.601 coefficients (the same ones used in JPEG).
 *
 * @param {number} r Red channel   0-255
 * @param {number} g Green channel 0-255
 * @param {number} b Blue channel  0-255
 * @returns {{y: number, cb: number, cr: number}}
 */
export function rgbToYCbCr(r, g, b) {
    return {
        y: 0.299 * r + 0.587 * g + 0.114 * b,
        cb: -0.169 * r - 0.331 * g + 0.500 * b + 128,
        cr: 0.500 * r - 0.419 * g - 0.081 * b + 128
    };
}

/**
 * Parse a #rrggbb hex string into an RGB object.
 *
 * @param {string} hex
 * @returns {{r: number, g: number, b: number}}
 */
export function hexToRgb(hex) {
    const clean = String(hex).replace('#', '');
    const full = clean.length === 3
        ? clean.split('').map((c) => c + c).join('')
        : clean;
    const int = parseInt(full, 16);
    return {
        r: (int >> 16) & 255,
        g: (int >> 8) & 255,
        b: int & 255
    };
}

/**
 * Box-blur a Float32Array of alpha values in place (returns a new array).
 * Used for the edge feathering pass.
 *
 * @param {Float32Array} src
 * @param {number} w
 * @param {number} h
 * @param {number} radius
 * @returns {Float32Array}
 */
function boxBlur(src, w, h, radius) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0;
            let count = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        sum += src[ny * w + nx];
                        count++;
                    }
                }
            }
            out[y * w + x] = sum / count;
        }
    }
    return out;
}

/**
 * Remove a key colour from an ImageData object, in place.
 *
 * Three passes:
 *   1. Compute Cb-Cr distance per pixel, build an alpha ramp with a
 *      feather band of +/- `feather` around `threshold`.
 *   2. Blend that alpha with a blurred copy so edges are soft, not stair-stepped.
 *   3. Write the alpha channel and suppress colour spill on the foreground.
 *
 * @param {ImageData} imageData Mutated in place.
 * @param {string} keyHex       Key colour as #rrggbb, e.g. "#00b140".
 * @param {number} threshold    Cb-Cr distance cut-off. 0-120. Higher = more removed.
 * @param {number} feather      Soft-edge width. 0-15. 0 = hard edge.
 * @param {number} despill      Spill suppression strength. 0-100.
 * @returns {ImageData} The same object, for chaining.
 */
export function chromaKey(imageData, keyHex, threshold = 35, feather = 2, despill = 30) {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;

    const key = hexToRgb(keyHex);
    const keyYCbCr = rgbToYCbCr(key.r, key.g, key.b);
    const alphas = new Float32Array(w * h);

    // ---- Pass 1: chroma distance -> alpha ramp ----
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const cb = -0.169 * r - 0.331 * g + 0.500 * b + 128;
        const cr = 0.500 * r - 0.419 * g - 0.081 * b + 128;

        const dcb = cb - keyYCbCr.cb;
        const dcr = cr - keyYCbCr.cr;
        const dist = Math.sqrt(dcb * dcb + dcr * dcr);

        const pixIdx = i / 4;

        if (dist < threshold - feather) {
            alphas[pixIdx] = 0;                      // fully transparent
        } else if (dist > threshold + feather) {
            alphas[pixIdx] = 255;                    // fully opaque
        } else {
            const t = (dist - (threshold - feather)) / (2 * feather);
            alphas[pixIdx] = t * 255;                // feather band
        }
    }

    // ---- Pass 2: soften the edges ----
    if (feather > 0) {
        const radius = Math.min(feather, 5);         // cap for performance
        const blurred = boxBlur(alphas, w, h, radius);
        for (let i = 0; i < alphas.length; i++) {
            alphas[i] = alphas[i] * 0.5 + blurred[i] * 0.5;
        }
    }

    // ---- Pass 3: write alpha + kill green spill ----
    const despillFactor = despill / 100;

    for (let i = 0; i < data.length; i += 4) {
        const pixIdx = i / 4;
        data[i + 3] = Math.round(alphas[pixIdx]);

        if (despillFactor > 0) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const avgRB = (r + b) / 2;
            const greenExcess = g - avgRB;
            if (greenExcess > 0) {
                data[i + 1] = Math.round(Math.max(0, g - greenExcess * despillFactor));
            }
        }
    }

    return imageData;
}

/**
 * Convenience wrapper: load a File/Blob, key it out, return a canvas.
 *
 * @param {Blob|File} file
 * @param {object} options {keyHex, threshold, feather, despill}
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function removeBackground(file, options = {}) {
    const {
        keyHex = '#00b140',
        threshold = 35,
        feather = 2,
        despill = 30
    } = options;

    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    chromaKey(imageData, keyHex, threshold, feather, despill);
    ctx.putImageData(imageData, 0, 0);

    return canvas;
}
