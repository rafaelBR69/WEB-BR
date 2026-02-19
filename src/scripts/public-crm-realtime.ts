import { createClient } from "@supabase/supabase-js";

type PublicRealtimeConfig = {
  enabled?: boolean;
  supabaseUrl?: string;
  anonKey?: string;
  organizationId?: string | null;
  debounceMs?: number;
  refreshTimeoutMs?: number;
};

declare global {
  interface Window {
    __blancarealPublicRealtime?: PublicRealtimeConfig;
    __blancarealPublicRealtimeStarted?: boolean;
  }
}

const config = window.__blancarealPublicRealtime;
if (!config || config.enabled === false || window.__blancarealPublicRealtimeStarted) {
  // no-op when config is missing or script already initialized
} else {
  window.__blancarealPublicRealtimeStarted = true;

  const pathname = window.location.pathname.toLowerCase();
  const isCatalogRoute = /\/(properties|property|projects)(\/|$)/.test(pathname);
  const supabaseUrl = String(config.supabaseUrl ?? "").trim();
  const anonKey = String(config.anonKey ?? "").trim();
  const organizationId =
    typeof config.organizationId === "string" && config.organizationId.trim().length > 0
      ? config.organizationId.trim()
      : null;
  const debounceMs = Math.max(300, Number(config.debounceMs) || 900);
  const refreshTimeoutMs = Math.max(3000, Number(config.refreshTimeoutMs) || 10000);

  if (!isCatalogRoute || !supabaseUrl || !anonKey) {
    // no-op for non catalog routes or missing credentials
  } else {
    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let refreshTimer: number | null = null;
    let refreshInFlight = false;
    let refreshQueued = false;

    const hydrateReadMore = () => {
      const button = document.getElementById("readMoreBtn");
      const container = document.getElementById("descContainer");
      if (!(button instanceof HTMLButtonElement) || !(container instanceof HTMLElement)) return;
      if (button.dataset.bound === "1") return;
      button.dataset.bound = "1";
      button.addEventListener("click", () => {
        const isExpanded = container.classList.toggle("is-expanded");
        button.setAttribute("aria-expanded", String(isExpanded));
        const readMore = button.getAttribute("data-read-more") || "Read more";
        const readLess = button.getAttribute("data-read-less") || "Read less";
        button.textContent = isExpanded ? readLess : readMore;
      });
    };

    const syncFiltersDisclosure = () => {
      const disclosure = document.getElementById("filtersDisclosure");
      if (!(disclosure instanceof HTMLDetailsElement)) return;
      const mql = window.matchMedia("(min-width: 1024px)");
      if (mql.matches) disclosure.setAttribute("open", "");
      else disclosure.removeAttribute("open");
    };

    const hydrateUpdatedContent = () => {
      hydrateReadMore();
      syncFiltersDisclosure();
      window.dispatchEvent(new CustomEvent("blancareal:public-content-refreshed"));
    };

    const fetchWithTimeout = async (requestUrl: string) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), refreshTimeoutMs);
      try {
        return await fetch(requestUrl, {
          headers: { "X-Requested-With": "fetch" },
          cache: "no-store",
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeout);
      }
    };

    const refreshMainContent = async () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }

      refreshInFlight = true;
      try {
        const response = await fetchWithTimeout(window.location.href);
        if (!response.ok) {
          window.location.reload();
          return;
        }

        const html = await response.text();
        const parser = new DOMParser();
        const nextDocument = parser.parseFromString(html, "text/html");
        const nextMain = nextDocument.getElementById("mainContent");
        const currentMain = document.getElementById("mainContent");

        if (!nextMain || !currentMain) {
          window.location.reload();
          return;
        }

        currentMain.innerHTML = nextMain.innerHTML;
        if (nextDocument.title) document.title = nextDocument.title;
        hydrateUpdatedContent();
      } catch {
        // keep current view if refresh fails
      } finally {
        refreshInFlight = false;
        if (refreshQueued) {
          refreshQueued = false;
          scheduleRefresh();
        }
      }
    };

    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void refreshMainContent();
      }, debounceMs);
    };

    const channelConfig: {
      event: "*";
      schema: "crm";
      table: "properties";
      filter?: string;
    } = {
      event: "*",
      schema: "crm",
      table: "properties",
    };

    if (organizationId) {
      channelConfig.filter = `organization_id=eq.${organizationId}`;
    }

    const channel = supabase
      .channel(`public-crm-properties-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", channelConfig, () => {
        scheduleRefresh();
      })
      .subscribe();

    window.addEventListener("beforeunload", () => {
      void supabase.removeChannel(channel);
    });
  }
}
