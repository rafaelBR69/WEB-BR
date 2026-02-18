const getLangCode = () => String(document.documentElement?.lang || "es").toLowerCase();

const LIGHTBOX_COPY = {
  es: {
    dialogLabel: "Galeria de imagenes",
    close: "Cerrar galeria",
    prev: "Imagen anterior",
    next: "Siguiente imagen",
    counter: "Imagen {current} de {total}",
  },
  en: {
    dialogLabel: "Image gallery",
    close: "Close gallery",
    prev: "Previous image",
    next: "Next image",
    counter: "Image {current} of {total}",
  },
  de: {
    dialogLabel: "Bildergalerie",
    close: "Galerie schliessen",
    prev: "Vorheriges Bild",
    next: "Naechstes Bild",
    counter: "Bild {current} von {total}",
  },
  fr: {
    dialogLabel: "Galerie d images",
    close: "Fermer la galerie",
    prev: "Image precedente",
    next: "Image suivante",
    counter: "Image {current} sur {total}",
  },
  it: {
    dialogLabel: "Galleria immagini",
    close: "Chiudi galleria",
    prev: "Immagine precedente",
    next: "Immagine successiva",
    counter: "Immagine {current} di {total}",
  },
  nl: {
    dialogLabel: "Afbeeldingengalerij",
    close: "Galerij sluiten",
    prev: "Vorige afbeelding",
    next: "Volgende afbeelding",
    counter: "Afbeelding {current} van {total}",
  },
};

const renderTemplate = (template, values) =>
  String(template).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));

const resolveCopy = () => {
  const lang = getLangCode();
  if (lang.startsWith("en")) return LIGHTBOX_COPY.en;
  if (lang.startsWith("de")) return LIGHTBOX_COPY.de;
  if (lang.startsWith("fr")) return LIGHTBOX_COPY.fr;
  if (lang.startsWith("it")) return LIGHTBOX_COPY.it;
  if (lang.startsWith("nl")) return LIGHTBOX_COPY.nl;
  return LIGHTBOX_COPY.es;
};

const getGroupSelector = (groupValue) => {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return `[data-lightbox="${window.CSS.escape(groupValue)}"]`;
  }
  return `[data-lightbox="${groupValue.replace(/"/g, '\\"')}"]`;
};

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-lightbox]");
  if (!(trigger instanceof HTMLAnchorElement)) return;

  event.preventDefault();

  const copy = resolveCopy();
  const groupValue = String(trigger.dataset.lightbox || "").trim();
  if (!groupValue) return;

  const groupSelector = getGroupSelector(groupValue);
  const groupNodes = Array.from(document.querySelectorAll(groupSelector)).filter(
    (node) => node instanceof HTMLAnchorElement
  );
  const items = groupNodes.length ? groupNodes : [trigger];
  let currentIndex = Math.max(0, items.indexOf(trigger));

  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", copy.dialogLabel);

  overlay.innerHTML = `
    <div class="lightbox-shell" role="document">
      <button type="button" class="lightbox-close" aria-label="${copy.close}">
        <span aria-hidden="true">&times;</span>
      </button>
      <button type="button" class="lightbox-nav lightbox-prev" aria-label="${copy.prev}">
        <span aria-hidden="true">&#8592;</span>
      </button>
      <figure class="lightbox-figure">
        <img class="lightbox-image" src="" alt="" />
        <figcaption class="lightbox-caption" aria-live="polite"></figcaption>
      </figure>
      <button type="button" class="lightbox-nav lightbox-next" aria-label="${copy.next}">
        <span aria-hidden="true">&#8594;</span>
      </button>
      <p class="lightbox-counter" aria-live="polite"></p>
    </div>
  `;

  const shell = overlay.querySelector(".lightbox-shell");
  const image = overlay.querySelector(".lightbox-image");
  const caption = overlay.querySelector(".lightbox-caption");
  const counter = overlay.querySelector(".lightbox-counter");
  const closeBtn = overlay.querySelector(".lightbox-close");
  const prevBtn = overlay.querySelector(".lightbox-prev");
  const nextBtn = overlay.querySelector(".lightbox-next");
  if (
    !(shell instanceof HTMLDivElement) ||
    !(image instanceof HTMLImageElement) ||
    !(caption instanceof HTMLElement) ||
    !(counter instanceof HTMLElement) ||
    !(closeBtn instanceof HTMLButtonElement) ||
    !(prevBtn instanceof HTMLButtonElement) ||
    !(nextBtn instanceof HTMLButtonElement)
  ) {
    return;
  }

  const hasMultiple = items.length > 1;
  prevBtn.hidden = !hasMultiple;
  nextBtn.hidden = !hasMultiple;

  const body = document.body;
  const previousOverflow = body.style.overflow;
  const previousPaddingRight = body.style.paddingRight;
  const scrollbarGap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
  body.style.overflow = "hidden";
  if (scrollbarGap > 0) {
    body.style.paddingRight = `${scrollbarGap}px`;
  }

  let isOpen = true;

  const readItem = (item) => {
    const href = item.getAttribute("href") || "";
    const alt =
      item.dataset.lightboxAlt ||
      item.getAttribute("title") ||
      item.querySelector("img")?.getAttribute("alt") ||
      "";
    const desc = item.dataset.lightboxCaption || alt;
    return { href, alt, desc };
  };

  const preloadAdjacent = () => {
    if (!hasMultiple) return;
    const nextIndex = (currentIndex + 1) % items.length;
    const prevIndex = (currentIndex - 1 + items.length) % items.length;
    [nextIndex, prevIndex].forEach((index) => {
      const src = items[index].getAttribute("href");
      if (!src) return;
      const preload = new Image();
      preload.decoding = "async";
      preload.src = src;
    });
  };

  const updateView = () => {
    const activeItem = items[currentIndex];
    const { href, alt, desc } = readItem(activeItem);
    image.src = href;
    image.alt = alt;
    caption.textContent = desc || "";
    counter.textContent = renderTemplate(copy.counter, {
      current: currentIndex + 1,
      total: items.length,
    });
    preloadAdjacent();
  };

  const moveBy = (step) => {
    if (!hasMultiple) return;
    currentIndex = (currentIndex + step + items.length) % items.length;
    updateView();
  };

  const getFocusable = () =>
    Array.from(
      overlay.querySelectorAll(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((node) => node instanceof HTMLElement && !node.hasAttribute("hidden"));

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    body.style.overflow = previousOverflow;
    body.style.paddingRight = previousPaddingRight;
    trigger.focus();
  };

  const onKeydown = (keyEvent) => {
    if (!isOpen) return;
    if (keyEvent.key === "Escape") {
      keyEvent.preventDefault();
      close();
      return;
    }
    if (keyEvent.key === "ArrowLeft") {
      keyEvent.preventDefault();
      moveBy(-1);
      return;
    }
    if (keyEvent.key === "ArrowRight") {
      keyEvent.preventDefault();
      moveBy(1);
      return;
    }
    if (keyEvent.key !== "Tab") return;

    const focusable = getFocusable();
    if (!focusable.length) {
      keyEvent.preventDefault();
      return;
    }

    const active = document.activeElement;
    const currentFocusIndex = focusable.indexOf(active);

    if (keyEvent.shiftKey) {
      if (currentFocusIndex <= 0) {
        keyEvent.preventDefault();
        focusable[focusable.length - 1].focus();
      }
      return;
    }

    if (currentFocusIndex === focusable.length - 1) {
      keyEvent.preventDefault();
      focusable[0].focus();
    }
  };

  overlay.addEventListener("click", (clickEvent) => {
    if (clickEvent.target === overlay) close();
  });

  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", () => moveBy(-1));
  nextBtn.addEventListener("click", () => moveBy(1));

  document.body.appendChild(overlay);
  updateView();
  closeBtn.focus();
  document.addEventListener("keydown", onKeydown, true);
});
