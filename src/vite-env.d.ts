/// <reference types="vite/client" />

declare module 'jsqr' {
  function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    opts?: { inversionAttempts?: string },
  ): { data: string } | null;
  export default jsQR;
}
