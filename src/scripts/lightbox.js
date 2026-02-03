document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-lightbox]");
  if (!link) return;

  e.preventDefault();

  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const altText = link.getAttribute("title") || "Imagen ampliada";

  overlay.innerHTML = `
    <button class="lightbox-close" aria-label="Cerrar imagen">&times;</button>
    <img src="${link.href}" alt="${altText}" />
  `;

  const close = () => {
    overlay.remove();
    if (link && link.focus) link.focus();
    document.removeEventListener("keydown", onKeydown);
  };

  const onKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const btn = overlay.querySelector(".lightbox-close");
      if (btn) btn.focus();
    }
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  overlay.querySelector(".lightbox-close")?.addEventListener("click", close);

  document.body.appendChild(overlay);
  overlay.querySelector(".lightbox-close")?.focus();
  document.addEventListener("keydown", onKeydown);
});
