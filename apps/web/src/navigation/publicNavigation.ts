import { getUiCopy } from "@shared/i18n/ui";
import { buildProjectShowcaseCards } from "@shared/properties/public";

export type PublicNavFamily = "home" | "section-landing" | "catalog" | "editorial";

export type PublicNavSection =
  | "home"
  | "properties"
  | "property-detail"
  | "projects"
  | "commercialization"
  | "legal-services"
  | "marketing-3d"
  | "sell-with-us"
  | "about"
  | "contact"
  | "agents"
  | "posts"
  | "legal";

type NavigationLink = {
  href: string;
  label: string;
};

type NavigationSection = {
  title: string;
  items: NavigationLink[];
};

type NavigationGroup = NavigationLink & {
  sections?: NavigationSection[];
};

type SideMenuItem = NavigationLink & {
  description?: string;
  children?: NavigationLink[];
};

type SideMenuSection = {
  title: string;
  items: SideMenuItem[];
};

export type PublicNavigationConfig = {
  headerVariant?: "default" | "landing";
  landingHeaderOverlay?: boolean;
  landingHeaderSolid?: boolean;
  landingNavItems?: NavigationLink[];
  landingNavGroups?: NavigationGroup[];
  headerNavItems?: NavigationLink[];
  sideMenuSections?: SideMenuSection[];
};

const chunkItems = <T>(items: T[], size: number) =>
  items.reduce<T[][]>((groups, item, index) => {
    const groupIndex = Math.floor(index / size);
    if (!groups[groupIndex]) groups[groupIndex] = [];
    groups[groupIndex].push(item);
    return groups;
  }, []);

const marketing3dLabelByLang: Record<string, string> = {
  es: "Marketing 3D",
  en: "3D Marketing",
  de: "3D Marketing",
  fr: "Marketing 3D",
  it: "Marketing 3D",
  nl: "3D Marketing",
};

const navCopyByLang = {
  es: {
    catalog: "Catalogo",
    areas: "Zonas",
    access: "Accesos",
    services: "Servicios",
    support: "Soporte",
    owners: "Propietarios",
    newBuild: "Obra nueva",
    resale: "Segunda mano",
    allProperties: "Todas las propiedades",
    allProjects: "Todos los proyectos",
    latestProjects: "Ultimos proyectos",
    requestLegal: "Solicitar asesoria",
    contractReview: "Revision y contratos",
    dueDiligence: "Due diligence inmobiliaria",
    taxAdvice: "Asesoria fiscal",
    docs: "Tramites y documentacion",
    legalRepresentation: "Representacion legal",
    foreignServices: "Servicios para extranjeros",
    valuation: "Solicitar valoracion",
    company: "Compania",
  },
  en: {
    catalog: "Catalog",
    areas: "Areas",
    access: "Access",
    services: "Services",
    support: "Support",
    owners: "Owners",
    newBuild: "New build",
    resale: "Resale",
    allProperties: "All properties",
    allProjects: "All projects",
    latestProjects: "Latest projects",
    requestLegal: "Request advice",
    contractReview: "Contract review",
    dueDiligence: "Real estate due diligence",
    taxAdvice: "Tax advice",
    docs: "Documentation and formalities",
    legalRepresentation: "Legal representation",
    foreignServices: "Services for foreign clients",
    valuation: "Request valuation",
    company: "Company",
  },
  de: {
    catalog: "Katalog",
    areas: "Gebiete",
    access: "Zugaenge",
    services: "Services",
    support: "Support",
    owners: "Eigentuemer",
    newBuild: "Neubau",
    resale: "Bestand",
    allProperties: "Alle Immobilien",
    allProjects: "Alle Projekte",
    latestProjects: "Aktuelle Projekte",
    requestLegal: "Beratung anfragen",
    contractReview: "Vertragspruefung",
    dueDiligence: "Due Diligence",
    taxAdvice: "Steuerberatung",
    docs: "Unterlagen und Abwicklung",
    legalRepresentation: "Rechtliche Vertretung",
    foreignServices: "Services fuer Auslaender",
    valuation: "Bewertung anfragen",
    company: "Unternehmen",
  },
  fr: {
    catalog: "Catalogue",
    areas: "Zones",
    access: "Acces",
    services: "Services",
    support: "Support",
    owners: "Proprietaires",
    newBuild: "Programme neuf",
    resale: "Revente",
    allProperties: "Toutes les proprietes",
    allProjects: "Tous les programmes",
    latestProjects: "Derniers programmes",
    requestLegal: "Demander un conseil",
    contractReview: "Revision de contrats",
    dueDiligence: "Due diligence immobiliere",
    taxAdvice: "Conseil fiscal",
    docs: "Demarches et documentation",
    legalRepresentation: "Representation juridique",
    foreignServices: "Services pour clients etrangers",
    valuation: "Demander une estimation",
    company: "Entreprise",
  },
  it: {
    catalog: "Catalogo",
    areas: "Aree",
    access: "Accessi",
    services: "Servizi",
    support: "Supporto",
    owners: "Proprietari",
    newBuild: "Nuova costruzione",
    resale: "Usato",
    allProperties: "Tutte le proprieta",
    allProjects: "Tutti i progetti",
    latestProjects: "Ultimi progetti",
    requestLegal: "Richiedi consulenza",
    contractReview: "Revisione contratti",
    dueDiligence: "Due diligence immobiliare",
    taxAdvice: "Consulenza fiscale",
    docs: "Pratiche e documentazione",
    legalRepresentation: "Rappresentanza legale",
    foreignServices: "Servizi per stranieri",
    valuation: "Richiedi valutazione",
    company: "Azienda",
  },
  nl: {
    catalog: "Catalogus",
    areas: "Gebieden",
    access: "Toegangen",
    services: "Diensten",
    support: "Support",
    owners: "Eigenaars",
    newBuild: "Nieuwbouw",
    resale: "Bestaande bouw",
    allProperties: "Alle woningen",
    allProjects: "Alle projecten",
    latestProjects: "Laatste projecten",
    requestLegal: "Advies aanvragen",
    contractReview: "Contractcontrole",
    dueDiligence: "Vastgoed due diligence",
    taxAdvice: "Fiscaal advies",
    docs: "Documentatie en afhandeling",
    legalRepresentation: "Juridische vertegenwoordiging",
    foreignServices: "Diensten voor buitenlandse klanten",
    valuation: "Waardering aanvragen",
    company: "Bedrijf",
  },
} as const;

const getMarketing3dLabel = (lang: string) => marketing3dLabelByLang[lang] ?? marketing3dLabelByLang.es;

const getNavCopy = (lang: string) => navCopyByLang[lang as keyof typeof navCopyByLang] ?? navCopyByLang.es;

const buildCatalogUrl = (
  lang: string,
  params: Record<string, string | string[] | number | null | undefined> = {}
) => {
  const nextParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => nextParams.append(key, String(item)));
      return;
    }

    if (value !== null && value !== undefined && value !== "") {
      nextParams.set(key, String(value));
    }
  });

  const query = nextParams.toString();
  return `/${lang}/properties/${query ? `?${query}` : ""}`;
};

const buildRealEstateGroup = (lang: string): NavigationGroup => {
  const ui = getUiCopy(lang);
  const copy = getNavCopy(lang);
  const projectsPath = `/${lang}/projects/`;
  const contactPath = `/${lang}/contact/`;

  return {
    label: ui.layout.navRealEstate,
    href: `/${lang}/properties/`,
    sections: [
      {
        title: copy.catalog,
        items: [
          { label: copy.allProperties, href: `/${lang}/properties/` },
          { label: copy.newBuild, href: buildCatalogUrl(lang, { market: "obra_nueva" }) },
          { label: copy.resale, href: buildCatalogUrl(lang, { market: "segunda_mano" }) },
        ],
      },
      {
        title: copy.access,
        items: [
          { label: ui.layout.navProjects, href: projectsPath },
          { label: ui.layout.navContact, href: contactPath },
          { label: ui.layout.navSellWithUs, href: `/${lang}/sell-with-us/` },
        ],
      },
    ],
  };
};

const buildLegalGroup = (lang: string): NavigationGroup => {
  const ui = getUiCopy(lang);

  return {
    label: ui.layout.navLegalServices,
    href: `/${lang}/legal-services/`,
  };
};

const buildServiceGroup = (lang: string, section: PublicNavSection): NavigationGroup => {
  const ui = getUiCopy(lang);
  const copy = getNavCopy(lang);
  const marketing3dLabel = getMarketing3dLabel(lang);

  if (section === "legal-services") {
    return buildLegalGroup(lang);
  }

  if (section === "marketing-3d") {
    return {
      label: marketing3dLabel,
      href: `/${lang}/marketing-3d/`,
      sections: [
        {
          title: copy.services,
          items: [
            { label: marketing3dLabel, href: `/${lang}/marketing-3d/` },
            { label: ui.layout.navCommercialization, href: `/${lang}/commercialization/` },
            { label: ui.layout.navSellWithUs, href: `/${lang}/sell-with-us/` },
          ],
        },
        {
          title: copy.access,
          items: [
            { label: ui.layout.navProjects, href: `/${lang}/projects/` },
            { label: ui.layout.navLegalServices, href: `/${lang}/legal-services/` },
            { label: ui.layout.navContact, href: `/${lang}/contact/` },
          ],
        },
      ],
    };
  }

  if (section === "sell-with-us") {
    return {
      label: ui.layout.navSellWithUs,
      href: `/${lang}/sell-with-us/`,
      sections: [
        {
          title: copy.owners,
          items: [
            { label: ui.layout.navSellWithUs, href: `/${lang}/sell-with-us/` },
            { label: copy.valuation, href: `/${lang}/contact/?service=commercialization` },
            { label: ui.layout.navCommercialization, href: `/${lang}/commercialization/` },
          ],
        },
        {
          title: copy.support,
          items: [
            { label: getMarketing3dLabel(lang), href: `/${lang}/marketing-3d/` },
            { label: ui.layout.navLegalServices, href: `/${lang}/legal-services/` },
            { label: ui.layout.navContact, href: `/${lang}/contact/` },
          ],
        },
      ],
    };
  }

  return {
    label: ui.layout.navCommercialization,
    href: `/${lang}/commercialization/`,
  };
};

const buildProjectGroups = (lang: string, properties: unknown[]): NavigationGroup => {
  const ui = getUiCopy(lang);
  const copy = getNavCopy(lang);
  const projectNavItems = buildProjectShowcaseCards(Array.isArray(properties) ? properties : [], lang).map((project) => ({
    label: project.title,
    href: project.href,
  }));
  const projectSections = chunkItems(projectNavItems, 4).map((items, index) => ({
    title: index === 0 ? copy.latestProjects : "",
    items,
  }));

  return {
    label: ui.layout.navProjects,
    href: `/${lang}/projects/`,
    sections:
      projectSections.length > 0
        ? projectSections
        : [
            {
              title: copy.access,
              items: [
                { label: copy.allProjects, href: `/${lang}/projects/` },
                { label: ui.layout.navProperties, href: `/${lang}/properties/` },
                { label: ui.layout.navContact, href: `/${lang}/contact/` },
              ],
            },
          ],
  };
};

const buildHomeNavLinks = (lang: string): NavigationLink[] => {
  const ui = getUiCopy(lang);

  return [
    { href: `/${lang}/properties/`, label: ui.layout.navRealEstate },
    { href: `/${lang}/legal-services/`, label: ui.layout.navLegalServices },
    { href: `/${lang}/commercialization/`, label: ui.layout.navCommercialization },
    { href: `/${lang}/about/`, label: ui.layout.navAbout },
    { href: `/${lang}/contact/`, label: ui.layout.navContact },
  ];
};

const buildHomeNavGroups = (lang: string): NavigationGroup[] => [
  buildRealEstateGroup(lang),
  buildLegalGroup(lang),
  buildServiceGroup(lang, "commercialization"),
];

const buildHomeNavigation = (lang: string): PublicNavigationConfig => ({
  headerVariant: "landing",
  landingHeaderOverlay: true,
  landingHeaderSolid: false,
  landingNavGroups: buildHomeNavGroups(lang),
  landingNavItems: buildHomeNavLinks(lang),
});

const buildHomeAccessNavigation = (lang: string): PublicNavigationConfig => ({
  headerVariant: "landing",
  landingHeaderOverlay: false,
  landingHeaderSolid: true,
  landingNavGroups: buildHomeNavGroups(lang),
  landingNavItems: buildHomeNavLinks(lang),
});

const buildCatalogNavigation = (lang: string, properties: unknown[]): PublicNavigationConfig => ({
  headerVariant: "landing",
  landingHeaderOverlay: false,
  landingHeaderSolid: true,
  landingNavGroups: [buildRealEstateGroup(lang), buildProjectGroups(lang, properties)],
});

const buildSectionLandingNavigation = (lang: string, section: PublicNavSection): PublicNavigationConfig => ({
  headerVariant: "landing",
  landingHeaderOverlay: false,
  landingHeaderSolid: true,
  landingNavGroups: [buildRealEstateGroup(lang), buildServiceGroup(lang, section)],
});

const buildEditorialNavigation = (lang: string): PublicNavigationConfig => {
  const ui = getUiCopy(lang);
  const copy = getNavCopy(lang);

  return {
    headerVariant: "default",
    headerNavItems: [
      { href: `/${lang}/properties/`, label: ui.layout.navRealEstate },
      { href: `/${lang}/commercialization/`, label: ui.layout.navCommercialization },
      { href: `/${lang}/legal-services/`, label: ui.layout.navLegalServices },
      { href: `/${lang}/posts/`, label: ui.layout.navPosts },
      { href: `/${lang}/about/`, label: copy.company || ui.layout.navAbout },
      { href: `/${lang}/contact/`, label: ui.layout.navContact },
    ],
  };
};

export function buildPublicNavigation(input: {
  lang: string;
  family: PublicNavFamily;
  section: PublicNavSection;
  properties?: unknown[];
}): PublicNavigationConfig {
  const { lang, family, section, properties = [] } = input;

  if (family === "home") {
    return buildHomeNavigation(lang);
  }

  if (family === "catalog") {
    return buildCatalogNavigation(lang, properties);
  }

  if (family === "section-landing") {
    return buildSectionLandingNavigation(lang, section);
  }

  if (section === "about" || section === "contact" || section === "posts") {
    return buildHomeAccessNavigation(lang);
  }

  return buildEditorialNavigation(lang);
}
