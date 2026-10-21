// A feathered clearing front travels from the top to the bottom of the cover.
// Progress endpoints are wholly frosted / wholly clear, including the rim.
const FEATHER = 0.12;
export const FROSTED_ROUGHNESS = 0.42;
const CLEAR_ROUGHNESS = 0.025;
const FROST_SPAN = 0.016;

// Three's default mip rule grows blur relative to an object as the viewport
// shrinks. Bound the frosted footprint to 1.6% of the projected cover height.
export const frostedTransmissionGLSL = `
float archiveTransmissionLod(float roughness, float ior, vec2 samplerSize) {
  float nativeLod = log2(samplerSize.x) * roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
  float strength = clamp((roughness - ${CLEAR_ROUGHNESS}) / ${FROSTED_ROUGHNESS - CLEAR_ROUGHNESS}, 0.0, 1.0);
  float panelPixels = length(vArchiveProjectedAxis * samplerSize);
  float clearLod = log2(samplerSize.x) * ${CLEAR_ROUGHNESS} * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
  float boundedLod = log2(max(exp2(clearLod), panelPixels * ${FROST_SPAN} * pow(strength, 1.15)));
  return mix(nativeLod, min(nativeLod, boundedLod), archiveQuality);
}`;
export const glassRevealGLSL = `
float glassRevealAtHeight(float progress, float height) {
  float edge = 1.0 - ${1 + 2 * FEATHER} * clamp(progress, 0.0, 1.0);
  return smoothstep(edge, edge + ${2 * FEATHER}, clamp(height, 0.0, 1.0));
}`;
