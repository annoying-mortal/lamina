import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { renderDimensions, type RenderQuality } from "./render-quality";

export function resizeQuality(
  renderer: THREE.WebGLRenderer,
  composer: EffectComposer,
  host: HTMLElement,
  quality: RenderQuality,
) {
  const width = Math.max(1, host.clientWidth),
    height = Math.max(1, host.clientHeight);
  const dimensions = renderDimensions(
    quality,
    width,
    height,
    host.getBoundingClientRect().width / width,
    devicePixelRatio,
    renderer.capabilities.maxTextureSize,
  );
  renderer.setPixelRatio(dimensions.ratio);
  renderer.setSize(width, height);
  composer.setPixelRatio(dimensions.ratio);
  composer.setSize(width, height);
  renderer.transmissionResolutionScale = quality.transmission;
  return dimensions;
}
