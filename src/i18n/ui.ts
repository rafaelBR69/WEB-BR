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
    navSellWithUs: string;
    navForAgents: string;
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
    menuRelationship: string;
    menuContent: string;
    menuRealEstateHint: string;
    menuPromotersHint: string;
    menuLegalHint: string;
    menuMarketingHint: string;
    menuSellWithUsHint: string;
    menuAgentsHint: string;
    menuContactHint: string;
    menuBlogHint: string;
    menuAboutHint: string;
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
      navRealEstate: "Bienes y Raíces",
      navProperties: "Propiedades",
      navProjects: "Proyectos",
      navPromoters: "Promotoras",
      navLegalServices: "Servicios legales",
      navCommercialization: "Comercialización",
      navSellWithUs: "Vende con nosotros",
      navForAgents: "Para agentes",
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
      menuRelationship: "Relacion",
      menuContent: "Contenido",
      menuRealEstateHint: "Propiedades, proyectos y zonas",
      menuPromotersHint: "Promotoras y comercialización",
      menuLegalHint: "Soporte juridico inmobiliario",
      menuMarketingHint: "Visuales, renders y campanas",
      menuSellWithUsHint: "Captacion, marketing y venta",
      menuAgentsHint: "Acceso para colaboradores",
      menuContactHint: "Hablar con BlancaReal",
      menuBlogHint: "Guias y actualidad",
      menuAboutHint: "Equipo y marca",
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
      navSellWithUs: "Sell with us",
      navForAgents: "For agents",
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
      menuRelationship: "Connect",
      menuContent: "Content",
      menuRealEstateHint: "Properties, developments and areas",
      menuPromotersHint: "Developers and commercialization",
      menuLegalHint: "Real estate legal support",
      menuMarketingHint: "Visuals, renders and campaigns",
      menuSellWithUsHint: "Seller intake, marketing and sale",
      menuAgentsHint: "Partner access",
      menuContactHint: "Speak with BlancaReal",
      menuBlogHint: "Guides and updates",
      menuAboutHint: "Team and brand",
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
      navSellWithUs: "Verkaufen Sie mit uns",
      navForAgents: "Fuer Agenten",
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
      menuRelationship: "Kontakt",
      menuContent: "Inhalte",
      menuRealEstateHint: "Immobilien, Projekte und Gebiete",
      menuPromotersHint: "Bautraeger und Vermarktung",
      menuLegalHint: "Rechtliche Immobilienbetreuung",
      menuMarketingHint: "Visuals, Renderings und Kampagnen",
      menuSellWithUsHint: "Akquise, Marketing und Verkauf",
      menuAgentsHint: "Zugang fuer Partner",
      menuContactHint: "Mit BlancaReal sprechen",
      menuBlogHint: "Ratgeber und Updates",
      menuAboutHint: "Team und Marke",
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
      navSellWithUs: "Vendez avec nous",
      navForAgents: "Pour agents",
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
      menuRelationship: "Relation",
      menuContent: "Contenu",
      menuRealEstateHint: "Biens, programmes et zones",
      menuPromotersHint: "Promoteurs et commercialisation",
      menuLegalHint: "Support juridique immobilier",
      menuMarketingHint: "Visuels, rendus et campagnes",
      menuSellWithUsHint: "Captation, marketing et vente",
      menuAgentsHint: "Acces partenaires",
      menuContactHint: "Parler avec BlancaReal",
      menuBlogHint: "Guides et actualites",
      menuAboutHint: "Equipe et marque",
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
      navSellWithUs: "Vendi con noi",
      navForAgents: "Per agenti",
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
      menuRelationship: "Relazione",
      menuContent: "Contenuti",
      menuRealEstateHint: "Proprieta, progetti e zone",
      menuPromotersHint: "Promotori e commercializzazione",
      menuLegalHint: "Supporto legale immobiliare",
      menuMarketingHint: "Visual, render e campagne",
      menuSellWithUsHint: "Acquisizione, marketing e vendita",
      menuAgentsHint: "Accesso partner",
      menuContactHint: "Parla con BlancaReal",
      menuBlogHint: "Guide e aggiornamenti",
      menuAboutHint: "Team e brand",
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
      navSellWithUs: "Verkoop met ons",
      navForAgents: "Voor agenten",
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
      menuRelationship: "Contact",
      menuContent: "Content",
      menuRealEstateHint: "Woningen, projecten en zones",
      menuPromotersHint: "Ontwikkelaars en commercialisatie",
      menuLegalHint: "Juridische vastgoedondersteuning",
      menuMarketingHint: "Visuals, renders en campagnes",
      menuSellWithUsHint: "Acquisitie, marketing en verkoop",
      menuAgentsHint: "Toegang voor partners",
      menuContactHint: "Spreek met BlancaReal",
      menuBlogHint: "Gidsen en updates",
      menuAboutHint: "Team en merk",
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
