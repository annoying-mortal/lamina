type MotionKey =
  | "selectionWave"
  | "idleWave"
  | "pointerParallax"
  | "dragMomentum"
  | "selectionTransition"
  | "detailTransition";

export type MotionPreferences = Record<MotionKey, boolean>;

export function fullMotion(): MotionPreferences {
  return {
    selectionWave: true,
    idleWave: true,
    pointerParallax: true,
    dragMomentum: true,
    selectionTransition: true,
    detailTransition: true,
  };
}

export function reducedMotion(): MotionPreferences {
  return {
    selectionWave: false,
    idleWave: false,
    pointerParallax: false,
    dragMomentum: false,
    selectionTransition: false,
    detailTransition: false,
  };
}
