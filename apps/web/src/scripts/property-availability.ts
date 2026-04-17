const availabilityRoots = document.querySelectorAll<HTMLElement>("[data-availability-root]");

const firstVisible = <T extends HTMLElement>(items: T[]) =>
  items.find((item) => !item.hasAttribute("hidden")) ?? items[0] ?? null;

const renderSelection = (panel: HTMLElement, unitId: string | null) => {
  if (!unitId) return;

  panel.querySelectorAll<HTMLElement>("[data-availability-selection]").forEach((selection) => {
    selection.toggleAttribute("hidden", selection.dataset.availabilitySelection !== unitId);
  });
};

const setPreview = (panel: HTMLElement, unitId: string | null) => {
  panel.dataset.previewUnit = unitId ?? "";

  panel.querySelectorAll<SVGElement>("[data-availability-area]").forEach((area) => {
    const isPreview = Boolean(unitId) && area.dataset.unitId === unitId;
    area.classList.toggle("is-preview", isPreview);
  });

  renderSelection(panel, unitId ?? panel.dataset.selectedUnit ?? null);
};

const selectUnit = (panel: HTMLElement, unitId: string | null) => {
  if (!unitId) return;

  panel.dataset.selectedUnit = unitId;

  panel.querySelectorAll<SVGElement>("[data-availability-area]").forEach((area) => {
    const isSelected = area.dataset.unitId === unitId;
    area.classList.toggle("is-selected", isSelected);
  });

  renderSelection(panel, unitId);
  setPreview(panel, null);
};

const findPreferredUnitId = (panel: HTMLElement, preferredUnitId: string | null) => {
  if (preferredUnitId) {
    const explicit = panel.querySelector<HTMLElement>(`[data-availability-selection="${preferredUnitId}"]`);
    if (explicit) return preferredUnitId;
  }

  const selected = panel.dataset.selectedUnit;
  if (selected) {
    const existing = panel.querySelector<HTMLElement>(`[data-availability-selection="${selected}"]`);
    if (existing) return selected;
  }

  const firstAvailableArea = panel.querySelector<HTMLElement>('[data-availability-area][data-status="available"]');
  if (firstAvailableArea?.dataset.unitId) {
    return firstAvailableArea.dataset.unitId;
  }

  const firstArea = panel.querySelector<HTMLElement>("[data-availability-area]");
  if (firstArea?.dataset.unitId) {
    return firstArea.dataset.unitId;
  }

  const firstSelection = panel.querySelector<HTMLElement>("[data-availability-selection]");
  return firstSelection?.dataset.availabilitySelection ?? null;
};

const activateTab = (root: HTMLElement, tabId: string, preferredUnitId: string | null = null) => {
  root.dataset.activeTab = tabId;

  root.querySelectorAll<HTMLElement>("[data-availability-tab]").forEach((tab) => {
    const isActive = tab.dataset.availabilityTab === tabId;
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.setAttribute("tabindex", isActive ? "0" : "-1");
  });

  root.querySelectorAll<HTMLElement>("[data-availability-panel]").forEach((panel) => {
    const isActive = panel.dataset.availabilityPanel === tabId;
    panel.toggleAttribute("hidden", !isActive);
  });

  const panel = root.querySelector<HTMLElement>(`[data-availability-panel="${tabId}"]`);
  if (!panel) return;

  const resolvedUnitId = findPreferredUnitId(
    panel,
    preferredUnitId ?? panel.dataset.initialSelectedUnit ?? null
  );
  selectUnit(panel, resolvedUnitId);
};

for (const root of availabilityRoots) {
  const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-availability-panel]"));
  const initialPanel = firstVisible(panels);
  const initialTabId = root.dataset.initialTab ?? initialPanel?.dataset.availabilityPanel ?? null;

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const tabTrigger = target.closest<HTMLElement>("[data-availability-tab]");
    if (tabTrigger?.dataset.availabilityTab) {
      activateTab(root, tabTrigger.dataset.availabilityTab, null);
      return;
    }

    const areaTrigger = target.closest<HTMLElement>("[data-availability-area]");
    if (areaTrigger?.dataset.unitId) {
      const activePanel = root.querySelector<HTMLElement>('[data-availability-panel]:not([hidden])');
      if (activePanel) selectUnit(activePanel, areaTrigger.dataset.unitId);
      if (areaTrigger instanceof SVGElement) areaTrigger.blur?.();
    }
  });

  root.addEventListener("pointerenter", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const panel = root.querySelector<HTMLElement>('[data-availability-panel]:not([hidden])');
    if (!target || !panel) return;

    const areaTrigger = target.closest<HTMLElement>("[data-availability-area]");
    if (areaTrigger?.dataset.unitId) {
      setPreview(panel, areaTrigger.dataset.unitId);
    }
  }, true);

  root.addEventListener("pointerleave", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    const panel = root.querySelector<HTMLElement>('[data-availability-panel]:not([hidden])');
    if (!target || !panel) return;

    const leavingInteractive = target.closest("[data-availability-area]");
    const stillInsideInteractive = related?.closest?.("[data-availability-area]");
    if (leavingInteractive && !stillInsideInteractive) {
      setPreview(panel, null);
    }
  }, true);

  root.addEventListener("focusin", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const panel = root.querySelector<HTMLElement>('[data-availability-panel]:not([hidden])');
    if (!target || !panel) return;

    const areaTrigger = target.closest<HTMLElement>("[data-availability-area]");
    if (areaTrigger?.dataset.unitId) {
      setPreview(panel, areaTrigger.dataset.unitId);
    }
  });

  root.addEventListener("focusout", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    const panel = root.querySelector<HTMLElement>('[data-availability-panel]:not([hidden])');
    if (!target || !panel) return;

    const leavingInteractive = target.closest("[data-availability-area]");
    const stillInsideInteractive = related?.closest?.("[data-availability-area]");
    if (leavingInteractive && !stillInsideInteractive) {
      setPreview(panel, null);
    }
  });

  root.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const tabTrigger = target.closest<HTMLElement>("[data-availability-tab]");
    if (tabTrigger?.dataset.availabilityTab && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      const tabs = Array.from(root.querySelectorAll<HTMLElement>("[data-availability-tab]"));
      const currentIndex = tabs.findIndex((item) => item.dataset.availabilityTab === tabTrigger.dataset.availabilityTab);
      if (currentIndex < 0) return;
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
      const nextTab = tabs[nextIndex];
      if (!nextTab?.dataset.availabilityTab) return;
      activateTab(root, nextTab.dataset.availabilityTab, null);
      nextTab.focus();
      return;
    }

    const areaTrigger = target.closest<HTMLElement>("[data-availability-area]");
    if (areaTrigger?.dataset.unitId && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      const activePanel = root.querySelector<HTMLElement>('[data-availability-panel]:not([hidden])');
      if (activePanel) selectUnit(activePanel, areaTrigger.dataset.unitId);
    }
  });

  if (initialTabId) {
    activateTab(root, initialTabId, root.dataset.selectedUnit ?? null);
  }
}
