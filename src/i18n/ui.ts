import { DEFAULT_LANG, type SupportedLang } from "@/i18n/languages";

type UiCopy = {
  layout: {
    skipToContent: string;
    navHome: string;
    navProperties: string;
    navProjects: string;
    navPosts: string;
    navAbout: string;
    language: string;
    contact: string;
    callNow: string;
    call: string;
    menu: string;
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
      navProperties: "Propiedades",
      navProjects: "Proyectos",
      navPosts: "Blog",
      navAbout: "Nosotros",
      language: "Idioma",
      contact: "Contactar",
      callNow: "Llamar ahora",
      call: "Llamar",
      menu: "Menu",
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
      navProperties: "Properties",
      navProjects: "Projects",
      navPosts: "Blog",
      navAbout: "About us",
      language: "Language",
      contact: "Contact",
      callNow: "Call now",
      call: "Call",
      menu: "Menu",
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
      navProperties: "Immobilien",
      navProjects: "Projekte",
      navPosts: "Blog",
      navAbout: "Ueber uns",
      language: "Sprache",
      contact: "Kontakt",
      callNow: "Jetzt anrufen",
      call: "Anrufen",
      menu: "Menue",
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
      navProperties: "Proprietes",
      navProjects: "Projets",
      navPosts: "Blog",
      navAbout: "A propos",
      language: "Langue",
      contact: "Contacter",
      callNow: "Appeler maintenant",
      call: "Appeler",
      menu: "Menu",
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
      navProperties: "Proprieta",
      navProjects: "Progetti",
      navPosts: "Blog",
      navAbout: "Chi siamo",
      language: "Lingua",
      contact: "Contatta",
      callNow: "Chiama ora",
      call: "Chiama",
      menu: "Menu",
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
      navProperties: "Woningen",
      navProjects: "Projecten",
      navPosts: "Blog",
      navAbout: "Over ons",
      language: "Taal",
      contact: "Contact",
      callNow: "Bel nu",
      call: "Bellen",
      menu: "Menu",
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
