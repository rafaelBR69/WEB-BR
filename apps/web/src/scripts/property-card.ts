declare global {
  interface Window {
    __advancePropertyCard?: (gallery: Element | null, direction: number) => void;
    __propertyCardSwipeBound?: boolean;
  }
}

if (!window.__advancePropertyCard) {
  window.__advancePropertyCard = (gallery, direction) => {
    if (!(gallery instanceof HTMLElement)) return;

    const track = gallery.querySelector<HTMLElement>(".card-gallery-track");
    const slides = Array.from(gallery.querySelectorAll(".card-gallery-slide"));
    if (!(track instanceof HTMLElement) || slides.length <= 1) return;

    const currentIndex = Number(gallery.dataset.galleryIndex || "0");
    const nextIndex = (currentIndex + direction + slides.length) % slides.length;

    gallery.dataset.galleryIndex = String(nextIndex);
    track.style.transform = `translateX(-${nextIndex * 100}%)`;

    const dots = gallery.querySelectorAll(".card-gallery-dot");
    dots.forEach((dot, index) => {
      dot.classList.toggle("is-active", index === nextIndex);
    });
  };
}

if (!window.__propertyCardSwipeBound) {
  window.__propertyCardSwipeBound = true;

  let startX = 0;
  let startY = 0;
  let activeGallery: HTMLElement | null = null;

  document.addEventListener(
    "touchstart",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const gallery = target.closest(".card-gallery");
      if (!(gallery instanceof HTMLElement)) return;

      const touch = event.changedTouches?.[0];
      if (!touch) return;

      activeGallery = gallery;
      startX = touch.clientX;
      startY = touch.clientY;
    },
    { passive: true }
  );

  document.addEventListener(
    "touchend",
    (event) => {
      if (!activeGallery) return;

      const touch = event.changedTouches?.[0];
      if (!touch) {
        activeGallery = null;
        return;
      }

      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      const isHorizontalGesture = Math.abs(deltaX) > 36 && Math.abs(deltaX) > Math.abs(deltaY);

      if (isHorizontalGesture) {
        window.__advancePropertyCard?.(activeGallery, deltaX < 0 ? 1 : -1);
      }

      activeGallery = null;
    },
    { passive: true }
  );
}

export {};
