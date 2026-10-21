/** Preserve the long-lens perspective. Reframe only the camera, never the card. */
export function archiveFraming(width: number, height: number, span: number, detail: number) {
  const aspect = width / height;
  const portrait = aspect < 1.05;
  const baseSpan = span + (5.9 - span) * detail;
  const portraitDetailSpan = Math.max(6.3 / aspect, 3.7 * height / Math.max(100, 0.54 * height - 156));
  const viewSpan = portrait
    ? Math.max(baseSpan, 8.4 / aspect + (portraitDetailSpan - 8.4 / aspect) * detail)
    : Math.max(baseSpan, baseSpan * (16 / 9) / aspect);
  return {
    span: viewSpan,
    portrait,
    // Portrait selection is deliberately above its title and navigation.
    previewY: portrait ? 0.36 : 0.5,
    detailX: portrait ? 0.5 : 550 / 1920,
    detailY: portrait ? 0.27 + 34 / height : 560 / 1080,
  };
}
