document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-lightbox]");
  if (!link) return;

  e.preventDefault();

  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";
  overlay.innerHTML = `
    <img src="${link.href}" />
  `;

  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
});
