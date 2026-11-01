// Colour matrices for the live preview. This mirrors src-tauri/src/edit/color.rs
// exactly: tools describe their colour change as a 3×4 matrix (rows R, G, B;
// columns r, g, b, offset; values 0–1), EditMode composes them and draws the
// image through one SVG <feColorMatrix>. Rust applies the same matrix when
// saving, so what you see is what gets written.

/** Row i = output channel i (R, G, B): [r, g, b, offset]. */
export type ColorMatrix = number[][];

export const IDENTITY: ColorMatrix = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
];

/** `then ∘ first`: the matrix that applies `first`, then `then`. */
export function compose(then: ColorMatrix, first: ColorMatrix): ColorMatrix {
  return then.map((row, i) =>
    [0, 1, 2, 3].map((j) => row[0] * first[0][j] + row[1] * first[1][j] + row[2] * first[2][j] + (j === 3 ? then[i][3] : 0)),
  );
}

/** Multiply each channel, then add `offset` to all three. */
export const scale = (r: number, g: number, b: number, offset: number): ColorMatrix => [
  [r, 0, 0, offset],
  [0, g, 0, offset],
  [0, 0, b, offset],
];

export const isIdentity = (m: ColorMatrix) =>
  m.every((row, i) => row.every((v, j) => Math.abs(v - IDENTITY[i][j]) < 1e-9));

/**
 * The 20 numbers <feColorMatrix type="matrix"> wants: a 4×5 matrix
 * (R, G, B, A rows; r, g, b, a, offset columns). Alpha passes through.
 */
export const toSvgValues = (m: ColorMatrix) =>
  [...m.flatMap(([r, g, b, o]) => [r, g, b, 0, o]), 0, 0, 0, 1, 0].map((v) => +v.toFixed(6)).join(" ");
