export function getOrderedGallery(media) {
  if (!media || !media.gallery) return [];

  const {
    cover,
    gallery: { exterior = [], interior = [], views = [], floorplan = [] },
  } = media;

  const ordered = [];

  if (cover) ordered.push(cover);

  return ordered.concat(
    exterior,
    interior,
    views,
    floorplan
  );
}
