import { DEFAULT_LANG, type SupportedLang } from "@/i18n/languages";

type UiCopy = {
  layout: {
    skipToContent: string;
    navHome: string;
    navRealEstate: string;
    navProperties: string;
    navProjects: string;
    navPromoters: string;
    navLegalServices: string;
    navCommercialization: string;
    navAgents: string;
    navContact: string;
    navMap: string;
    navPosts: string;
    navAbout: string;
    language: string;
    contact: string;
    callNow: string;
    call: string;
    menu: string;
    menuMain: string;
    menuServices: string;
    menuExplore: string;
    openMenu: string;
    closeMenu: string;
  };
  propertyCard: {
    viewDetails: string;
    newBuild: string;
    fromPrice: string;
  };
};

export const UI_COPY: Record<SupportedLang, UiCopy> = {
  es: {
    layout: {
      skipToContent: "Saltar al contenido",
      navHome: "Inicio",
      navRealEstate: "Real Estate",
      navProperties: "Propiedades",
      navProjects: "Proyectos",
      navPromoters: "Promotoras",
      navLegalServices: "Servicios legales",
      navCommercialization: "Comercializacion",
      navAgents: "Agentes",
      navContact: "Contacto",
      navMap: "Mapa",
      navPosts: "Blog",
      navAbout: "Nosotros",
      language: "Idioma",
      contact: "Contactar",
      callNow: "Llamar ahora",
      call: "Llamar",
      menu: "Menu",
      menuMain: "Principal",
      menuServices: "Servicios",
      menuExplore: "Explorar",
      openMenu: "Abrir menu",
      closeMenu: "Cerrar menu",
    },
    propertyCard: {
      viewDetails: "Ver detalles",
      newBuild: "Obra nueva",
      fromPrice: "Desde",
    },
  },
  en: {
    layout: {
      skipToContent: "Skip to content",
      navHome: "Home",
      navRealEstate: "Real Estate",
      navProperties: "Properties",
      navProjects: "Projects",
      navPromoters: "Developers",
      navLegalServices: "Legal services",
      navCommercialization: "Commercialization",
      navAgents: "Agents",
      navContact: "Contact",
      navMap: "Map",
      navPosts: "Blog",
      navAbout: "About us",
      language: "Language",
      contact: "Contact",
      callNow: "Call now",
      call: "Call",
      menu: "Menu",
      menuMain: "Main",
      menuServices: "Services",
      menuExplore: "Explore",
      openMenu: "Open menu",
      closeMenu: "Close menu",
    },
    propertyCard: {
      viewDetails: "View details",
      newBuild: "New build",
      fromPrice: "From",
    },
  },
  de: {
    layout: {
      skipToContent: "Zum Inhalt",
      navHome: "Start",
      navRealEstate: "Real Estate",
      navProperties: "Immobilien",
      navProjects: "Projekte",
      navPromoters: "Bautraeger",
      navLegalServices: "Rechtsservice",
      navCommercialization: "Vermarktung",
      navAgents: "Agenten",
      navContact: "Kontakt",
      navMap: "Karte",
      navPosts: "Blog",
      navAbout: "Ueber uns",
      language: "Sprache",
      contact: "Kontakt",
      callNow: "Jetzt anrufen",
      call: "Anrufen",
      menu: "Menue",
      menuMain: "Hauptbereich",
      menuServices: "Services",
      menuExplore: "Entdecken",
      openMenu: "Menue oeffnen",
      closeMenu: "Menue schliessen",
    },
    propertyCard: {
      viewDetails: "Details ansehen",
      newBuild: "Neubau",
      fromPrice: "Ab",
    },
  },
  fr: {
    layout: {
      skipToContent: "Aller au contenu",
      navHome: "Accueil",
      navRealEstate: "Real Estate",
      navProperties: "Proprietes",
      navProjects: "Projets",
      navPromoters: "Promoteurs",
      navLegalServices: "Services juridiques",
      navCommercialization: "Commercialisation",
      navAgents: "Agents",
      navContact: "Contact",
      navMap: "Carte",
      navPosts: "Blog",
      navAbout: "A propos",
      language: "Langue",
      contact: "Contacter",
      callNow: "Appeler maintenant",
      call: "Appeler",
      menu: "Menu",
      menuMain: "Principal",
      menuServices: "Services",
      menuExplore: "Explorer",
      openMenu: "Ouvrir le menu",
      closeMenu: "Fermer le menu",
    },
    propertyCard: {
      viewDetails: "Voir details",
      newBuild: "Neuf",
      fromPrice: "A partir de",
    },
  },
  it: {
    layout: {
      skipToContent: "Vai al contenuto",
      navHome: "Home",
      navRealEstate: "Real Estate",
      navProperties: "Proprieta",
      navProjects: "Progetti",
      navPromoters: "Promotori",
      navLegalServices: "Servizi legali",
      navCommercialization: "Commercializzazione",
      navAgents: "Agenti",
      navContact: "Contatto",
      navMap: "Mappa",
      navPosts: "Blog",
      navAbout: "Chi siamo",
      language: "Lingua",
      contact: "Contatta",
      callNow: "Chiama ora",
      call: "Chiama",
      menu: "Menu",
      menuMain: "Principale",
      menuServices: "Servizi",
      menuExplore: "Esplora",
      openMenu: "Apri menu",
      closeMenu: "Chiudi menu",
    },
    propertyCard: {
      viewDetails: "Vedi dettagli",
      newBuild: "Nuova costruzione",
      fromPrice: "Da",
    },
  },
  nl: {
    layout: {
      skipToContent: "Ga naar inhoud",
      navHome: "Home",
      navRealEstate: "Real Estate",
      navProperties: "Woningen",
      navProjects: "Projecten",
      navPromoters: "Ontwikkelaars",
      navLegalServices: "Juridische diensten",
      navCommercialization: "Commercialisatie",
      navAgents: "Agenten",
      navContact: "Contact",
      navMap: "Kaart",
      navPosts: "Blog",
      navAbout: "Over ons",
      language: "Taal",
      contact: "Contact",
      callNow: "Bel nu",
      call: "Bellen",
      menu: "Menu",
      menuMain: "Hoofdmenu",
      menuServices: "Diensten",
      menuExplore: "Verkennen",
      openMenu: "Open menu",
      closeMenu: "Sluit menu",
    },
    propertyCard: {
      viewDetails: "Bekijk details",
      newBuild: "Nieuwbouw",
      fromPrice: "Vanaf",
    },
  },
};

export function getUiCopy(lang: string): UiCopy {
  return UI_COPY[(lang as SupportedLang)] ?? UI_COPY[DEFAULT_LANG];
}
