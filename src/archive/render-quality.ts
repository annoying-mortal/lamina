/** Rendering controls are independent of lighting, materials and animation. */
export type RenderQuality = {
  scale: number;
  pixelRatio: number;
  aoResolution: number;
  depthOfField: number;
  transmission: number;
};

/** The archive uses the original rendering settings. */
export const archiveQuality: Readonly<RenderQuality> = {
  scale: 100,
  pixelRatio: 1.5,
  aoResolution: 1,
  depthOfField: 100,
  transmission: 1,
};

export function renderDimensions(
  quality: RenderQuality,
  width: number,
  height: number,
  stageScale: number,
  deviceRatio: number,
  maxTextureSize: number,
  pixelBudget = 8_294_400,
) {
  const requested =
    (Math.min(deviceRatio, quality.pixelRatio) * stageScale * quality.scale) /
    100;
  // Bound all full-resolution postprocessing targets to 8.3 MP and device limits.
  const ratio = Math.min(
    requested,
    Math.sqrt(pixelBudget / Math.max(1, width * height)),
    maxTextureSize / Math.max(1, width, height),
  );
  return {
    ratio,
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
  };
}
