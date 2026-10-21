import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export function createArchiveLighting(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
) {
  renderer.toneMappingExposure = 1.05;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  scene.environmentIntensity = 0.48;
  scene.add(new THREE.HemisphereLight("#fffaf5", "#b4a18c", 0.65));
  const key = new THREE.DirectionalLight("#fff7ed", 1.4);
  key.position.set(-6, 14, -5);
  const fill = new THREE.DirectionalLight("#ffffff", 0.6);
  fill.position.set(7, 8, -10);
  scene.add(key, fill);
  return key;
}
