import {
  PROPERTY_LANDING_OVERRIDES,
  type PropertyLandingOverride,
} from "@shared/seo/propertyLandingOverrides";
import type { PropertyLandingModel } from "@shared/seo/resolvePropertyLanding";

export type PropertyLandingBodyBlock = {
  title: string;
  text: string;
};

export type PropertyLandingFaqItem = {
  question: string;
  answer: string;
};

export type PropertyLandingContent = {
  title: string;
  description: string;
  h1: string;
  intro: string;
  bodyBlocks: PropertyLandingBodyBlock[];
  faqItems: PropertyLandingFaqItem[];
  breadcrumbs: Array<{ name: string; href: string }>;
  ogImage: string | null;
  noindex: boolean;
};

const fallbackCopy = {
  es: {
    properties: "Propiedades",
    home: "Inicio",
    cityTitle: ({ city }: any) => `Propiedades en venta en ${city} | BlancaReal`,
    cityDescription: ({ city }: any) =>
      `Explore propiedades en venta en ${city}, Costa del Sol. Seleccion curada con asesoramiento comercial, legal y multilingue de BlancaReal.`,
    cityH1: ({ city }: any) => `Propiedades en venta en ${city}`,
    cityIntro: ({ city, count }: any) =>
      `BlancaReal agrupa oportunidades activas en ${city} para compradores e inversores que buscan ubicacion, contexto de mercado y acompanamiento completo. Actualmente mostramos ${count} propiedades visibles en esta landing.`,
    cityAreaTitle: ({ area, city }: any) => `Propiedades en venta en ${area}, ${city} | BlancaReal`,
    cityAreaDescription: ({ area, city }: any) =>
      `Descubra propiedades en venta en ${area}, ${city}. Viviendas seleccionadas con soporte legal y comercial para compradores internacionales.`,
    cityAreaH1: ({ area, city }: any) => `Propiedades en venta en ${area}, ${city}`,
    cityAreaIntro: ({ area, city, count }: any) =>
      `${area} es una de las busquedas mas relevantes dentro de ${city}. Esta landing reune ${count} propiedades visibles con foco en calidad de ubicacion, tipologia y disponibilidad real.`,
    cityTypeTitle: ({ type, city }: any) => `${type} en venta en ${city} | BlancaReal`,
    cityTypeDescription: ({ type, city }: any) =>
      `Explore ${type.toLowerCase()} en venta en ${city}, Costa del Sol. Inventario seleccionado con contexto local y apoyo legal integrado.`,
    cityTypeH1: ({ type, city }: any) => `${type} en venta en ${city}`,
    cityTypeIntro: ({ type, city, count }: any) =>
      `Esta landing agrupa ${count} ${type.toLowerCase()} activas en ${city} con criterios de ubicacion, calidad y encaje para comprador nacional e internacional.`,
    cityAreaTypeTitle: ({ type, area, city }: any) =>
      `${type} en venta en ${area}, ${city} | BlancaReal`,
    cityAreaTypeDescription: ({ type, area, city }: any) =>
      `Descubra ${type.toLowerCase()} en venta en ${area}, ${city}. Una URL mas precisa para intenciones de busqueda locales y transaccionales.`,
    cityAreaTypeH1: ({ type, area, city }: any) => `${type} en venta en ${area}, ${city}`,
    cityAreaTypeIntro: ({ type, area, city, count }: any) =>
      `Combinamos ubicacion y tipologia para mostrar ${count} ${type.toLowerCase()} visibles en ${area}, ${city}, con una lectura mas util que un filtro temporal.`,
    cityPopularTitle: ({ popular, city }: any) =>
      `Propiedades con ${popular.toLowerCase()} en ${city} | BlancaReal`,
    cityPopularDescription: ({ popular, city }: any) =>
      `Explore propiedades con ${popular.toLowerCase()} en ${city}, Costa del Sol. Landing programatica con inventario real, FAQ y enlaces internos.`,
    cityPopularH1: ({ popular, city }: any) =>
      `Propiedades con ${popular.toLowerCase()} en ${city}`,
    cityPopularIntro: ({ popular, city, count }: any) =>
      `Esta landing responde a una busqueda concreta: propiedades con ${popular.toLowerCase()} en ${city}. Actualmente mostramos ${count} activos visibles alineados con esa intencion.`,
    marketTitle: "Que encontrara en esta seleccion",
    marketText: ({ city, type, area, popular }: any) =>
      `La seleccion combina activos visibles, disponibilidad actual y un marco de lectura mas claro que un filtro tecnico. ${type ? `Se centra en ${type.toLowerCase()}` : "Incluye varias tipologias"}${area ? ` en ${area}` : ""}${popular ? ` con foco en ${popular.toLowerCase()}` : ""}${city ? ` dentro de ${city}` : ""}.`,
    approachTitle: "Como trabajamos esta busqueda",
    approachText: ({ city, kind }: any) =>
      kind === "city-popular"
        ? `Convertimos intenciones de alta demanda en URLs estables para que Google y el usuario no dependan de un filtro efimero. Si necesita una busqueda mas amplia en ${city}, puede continuar en el catalogo interactivo.`
        : `Filtramos por ubicacion y tipologia para que Google y el usuario lleguen a una URL estable, indexable y util. Si su objetivo requiere una busqueda mas amplia en ${city}, puede continuar en el catalogo interactivo.`,
    faqCityQuestions: ({ city }: any) => [
      {
        question: `Que tipo de propiedades hay en ${city}?`,
        answer: `La oferta visible combina vivienda habitual, segunda residencia, promociones y producto orientado a comprador internacional, segun disponibilidad actual.`,
      },
      {
        question: `Que zonas destacan dentro de ${city}?`,
        answer: `Priorizamos zonas con demanda recurrente, buena conectividad y stock real para evitar landings vacias o poco utiles.`,
      },
      {
        question: `Como puedo ampliar la busqueda en ${city}?`,
        answer: `Desde esta landing puede pasar al catalogo completo y aplicar filtros tecnicos adicionales como dormitorios, precio o referencia.`,
      },
    ],
    faqAreaQuestions: ({ area, city }: any) => [
      {
        question: `Por que comprar en ${area}?`,
        answer: `${area} concentra interes por ubicacion, estilo de vida y acceso a servicios dentro de ${city}.`,
      },
      {
        question: `Que tipo de vivienda se encuentra en ${area}?`,
        answer: `La composicion depende del stock activo, pero esta landing solo muestra propiedades publicadas y visibles en este momento.`,
      },
      {
        question: `Esta zona encaja con comprador internacional?`,
        answer: `Si. BlancaReal trabaja precisamente con comprador internacional que necesita criterio comercial y soporte legal coordinado.`,
      },
    ],
    faqTypeQuestions: ({ type, city }: any) => [
      {
        question: `Que caracteriza a las ${type.toLowerCase()} en ${city}?`,
        answer: `Suelen responder a una busqueda concreta de estilo de vida, ubicacion o rentabilidad. Esta landing las reune en una URL estable para comparar mejor.`,
      },
      {
        question: `Donde se concentran mas ${type.toLowerCase()} en ${city}?`,
        answer: `La distribucion depende del inventario activo, por eso la landing se actualiza con el stock publico disponible.`,
      },
      {
        question: `Puedo refinar despues la busqueda por precio o dormitorios?`,
        answer: `Si. La landing SEO sirve como punto de entrada indexable y desde aqui puede continuar al catalogo con filtros tecnicos.`,
      },
    ],
    faqAreaTypeQuestions: ({ type, area, city }: any) => [
      {
        question: `Por que buscar ${type.toLowerCase()} en ${area}, ${city}?`,
        answer: `Es una combinacion mas transaccional que una busqueda solo por ciudad y ayuda a comparar inventario con una necesidad mas concreta.`,
      },
      {
        question: `Esta landing muestra solo stock real?`,
        answer: `Si. Solo se muestran propiedades publicadas y visibles en este momento para evitar paginas huecas.`,
      },
      {
        question: `Puedo seguir afinando la busqueda?`,
        answer: `Si. Desde aqui puede pasar al catalogo interactivo y aplicar filtros tecnicos adicionales.`,
      },
    ],
    faqPopularQuestions: ({ popular, city }: any) => [
      {
        question: `Que significa esta busqueda de ${popular.toLowerCase()} en ${city}?`,
        answer: `Agrupa una intencion concreta de mercado en una URL estable para que el usuario encuentre inventario real y no dependa de un filtro efimero.`,
      },
      {
        question: `Todas las propiedades cumplen ese criterio?`,
        answer: `Si. La landing solo incorpora inmuebles que coinciden con ese atributo o senal comercial dentro del stock visible.`,
      },
      {
        question: `Puedo combinar despues esta busqueda con zona o tipologia?`,
        answer: `Si. Puede continuar al catalogo y afinar por ciudad, zona, tipologia, precio o dormitorios.`,
      },
    ],
  },
  en: {
    properties: "Properties",
    home: "Home",
    cityTitle: ({ city }: any) => `Properties for sale in ${city} | BlancaReal`,
    cityDescription: ({ city }: any) =>
      `Explore properties for sale in ${city}, Costa del Sol. Curated opportunities with BlancaReal's multilingual and legal guidance.`,
    cityH1: ({ city }: any) => `Properties for sale in ${city}`,
    cityIntro: ({ city, count }: any) =>
      `BlancaReal groups active opportunities in ${city} for buyers and investors who need context, curation and legal coordination. This landing currently shows ${count} visible properties.`,
    cityAreaTitle: ({ area, city }: any) => `Properties for sale in ${area}, ${city} | BlancaReal`,
    cityAreaDescription: ({ area, city }: any) =>
      `Browse properties for sale in ${area}, ${city} with a clearer entry point than a technical filter page.`,
    cityAreaH1: ({ area, city }: any) => `Properties for sale in ${area}, ${city}`,
    cityAreaIntro: ({ area, city, count }: any) =>
      `${area} is one of the strongest search clusters inside ${city}. This landing brings together ${count} visible properties in a stable, indexable URL.`,
    cityTypeTitle: ({ type, city }: any) => `${type} for sale in ${city} | BlancaReal`,
    cityTypeDescription: ({ type, city }: any) =>
      `Explore ${type.toLowerCase()} for sale in ${city}, Costa del Sol. Selected inventory with local context and legal support.`,
    cityTypeH1: ({ type, city }: any) => `${type} for sale in ${city}`,
    cityTypeIntro: ({ type, city, count }: any) =>
      `This landing groups ${count} active ${type.toLowerCase()} in ${city} so buyers can start from a stable search page rather than a temporary filter state.`,
    cityAreaTypeTitle: ({ type, area, city }: any) =>
      `${type} for sale in ${area}, ${city} | BlancaReal`,
    cityAreaTypeDescription: ({ type, area, city }: any) =>
      `Explore ${type.toLowerCase()} for sale in ${area}, ${city}. A tighter query-to-page match for local transactional intent.`,
    cityAreaTypeH1: ({ type, area, city }: any) => `${type} for sale in ${area}, ${city}`,
    cityAreaTypeIntro: ({ type, area, city, count }: any) =>
      `This page groups ${count} visible ${type.toLowerCase()} in ${area}, ${city}, creating a more specific landing than a temporary filtered state.`,
    cityPopularTitle: ({ popular, city }: any) =>
      `Properties with ${popular.toLowerCase()} in ${city} | BlancaReal`,
    cityPopularDescription: ({ popular, city }: any) =>
      `Explore properties with ${popular.toLowerCase()} in ${city}, Costa del Sol. Programmatic landing with live inventory, FAQs and internal links.`,
    cityPopularH1: ({ popular, city }: any) =>
      `Properties with ${popular.toLowerCase()} in ${city}`,
    cityPopularIntro: ({ popular, city, count }: any) =>
      `This landing targets a specific search intent: properties with ${popular.toLowerCase()} in ${city}. It currently shows ${count} visible matches aligned with that demand.`,
    marketTitle: "What this landing covers",
    marketText: ({ city, type, area, popular }: any) =>
      `${type ? `It focuses on ${type.toLowerCase()}` : "It covers multiple property types"}${area ? ` in ${area}` : ""}${popular ? ` with emphasis on ${popular.toLowerCase()}` : ""}${city ? ` within ${city}` : ""}, using only live public inventory.`,
    approachTitle: "Why this page exists",
    approachText: ({ city, kind }: any) =>
      kind === "city-popular"
        ? `This page turns high-intent search patterns into stable URLs so both users and Google do not depend on temporary filter states. If you need a broader search in ${city}, continue to the interactive catalogue.`
        : `This page is designed as an indexable landing with stable content, FAQs and internal links. If you need a broader search in ${city}, continue to the interactive catalogue.`,
    faqCityQuestions: ({ city }: any) => [
      {
        question: `What types of properties are available in ${city}?`,
        answer: `Visible inventory may include apartments, villas, projects and other active opportunities depending on current stock.`,
      },
      {
        question: `Which areas stand out in ${city}?`,
        answer: `We prioritize areas with recurring demand, real stock and enough depth to justify a dedicated landing.`,
      },
      {
        question: `Can I refine the search beyond this page?`,
        answer: `Yes. This SEO landing is the entry point. From here you can continue to the interactive catalogue and add technical filters.`,
      },
    ],
    faqAreaQuestions: ({ area, city }: any) => [
      {
        question: `Why buy in ${area}?`,
        answer: `${area} attracts demand for location, lifestyle and access to services within ${city}.`,
      },
      {
        question: `What kind of homes are found in ${area}?`,
        answer: `The mix depends on active public inventory, and this landing only shows currently visible stock.`,
      },
      {
        question: `Is this area suitable for international buyers?`,
        answer: `Yes. BlancaReal works with international buyers who need coordinated commercial and legal guidance.`,
      },
    ],
    faqTypeQuestions: ({ type, city }: any) => [
      {
        question: `What defines ${type.toLowerCase()} in ${city}?`,
        answer: `They usually answer a specific lifestyle or location-led search intent, and this page keeps that intent in a stable URL.`,
      },
      {
        question: `Where are most ${type.toLowerCase()} concentrated in ${city}?`,
        answer: `That depends on active stock. The landing updates based on currently published public inventory.`,
      },
      {
        question: `Can I filter later by price or bedrooms?`,
        answer: `Yes. Use this landing as an entry page, then continue to the full catalogue for technical filters.`,
      },
    ],
    faqAreaTypeQuestions: ({ type, area }: any) => [
      {
        question: `Why search for ${type.toLowerCase()} in ${area}?`,
        answer: `Because it reflects a more transactional intent than a city-only search and allows a tighter match between query and available inventory.`,
      },
      {
        question: `Does this page only show live stock?`,
        answer: `Yes. It only shows currently visible public inventory.`,
      },
      {
        question: `Can I refine the search even more?`,
        answer: `Yes. Continue to the full catalogue and add technical filters such as bedrooms, price or reference.`,
      },
    ],
    faqPopularQuestions: ({ popular, city }: any) => [
      {
        question: `What does this ${popular.toLowerCase()} search in ${city} mean?`,
        answer: `It groups a specific search intent into a stable landing so users can find real inventory without relying on temporary filter URLs.`,
      },
      {
        question: `Do all properties match that criterion?`,
        answer: `Yes. This landing only includes stock that matches that feature or market signal within the visible inventory.`,
      },
      {
        question: `Can I combine this later with area or type filters?`,
        answer: `Yes. Continue to the interactive catalogue and refine by area, type, price or bedrooms.`,
      },
    ],
  },
};

const getCopy = (lang: string) => fallbackCopy[lang as keyof typeof fallbackCopy] ?? fallbackCopy.es;

const pickOverride = (lang: string, seoKey: string) =>
  PROPERTY_LANDING_OVERRIDES[
    lang as keyof typeof PROPERTY_LANDING_OVERRIDES
  ]?.[seoKey as never] as PropertyLandingOverride | null;

export function buildPropertyLandingContent({
  lang,
  landing,
  resultCount,
  ogImage = null,
}: {
  lang: string;
  landing: PropertyLandingModel;
  resultCount: number;
  ogImage?: string | null;
}): PropertyLandingContent {
  const copy = getCopy(lang);
  const params = {
    city: landing.city.label,
    area: landing.area?.label ?? "",
    type: landing.type?.label ?? "",
    popular: landing.popular?.label ?? "",
    count: resultCount,
    kind: landing.kind,
  };

  const title =
    landing.kind === "city"
      ? copy.cityTitle(params)
      : landing.kind === "city-area"
        ? copy.cityAreaTitle(params)
        : landing.kind === "city-type"
          ? copy.cityTypeTitle(params)
          : landing.kind === "city-area-type"
            ? copy.cityAreaTypeTitle(params)
            : copy.cityPopularTitle(params);

  const description =
    landing.kind === "city"
      ? copy.cityDescription(params)
      : landing.kind === "city-area"
        ? copy.cityAreaDescription(params)
        : landing.kind === "city-type"
          ? copy.cityTypeDescription(params)
          : landing.kind === "city-area-type"
            ? copy.cityAreaTypeDescription(params)
            : copy.cityPopularDescription(params);

  const h1 =
    landing.kind === "city"
      ? copy.cityH1(params)
      : landing.kind === "city-area"
        ? copy.cityAreaH1(params)
        : landing.kind === "city-type"
          ? copy.cityTypeH1(params)
          : landing.kind === "city-area-type"
            ? copy.cityAreaTypeH1(params)
            : copy.cityPopularH1(params);

  const intro =
    landing.kind === "city"
      ? copy.cityIntro(params)
      : landing.kind === "city-area"
        ? copy.cityAreaIntro(params)
        : landing.kind === "city-type"
          ? copy.cityTypeIntro(params)
          : landing.kind === "city-area-type"
            ? copy.cityAreaTypeIntro(params)
            : copy.cityPopularIntro(params);

  const override = pickOverride(lang, landing.seoKey);

  const bodyBlocks: PropertyLandingBodyBlock[] = [
    {
      title: copy.marketTitle,
      text: copy.marketText(params),
    },
    {
      title: copy.approachTitle,
      text: copy.approachText(params),
    },
  ];

  const faqItems =
    landing.kind === "city"
      ? copy.faqCityQuestions(params)
      : landing.kind === "city-area"
        ? copy.faqAreaQuestions(params)
        : landing.kind === "city-type"
          ? copy.faqTypeQuestions(params)
          : landing.kind === "city-area-type"
        ? copy.faqAreaTypeQuestions(params)
        : copy.faqPopularQuestions(params);

  const breadcrumbs = [
    { name: copy.home, href: `/${lang}/` },
    { name: copy.properties, href: `/${lang}/properties/` },
    { name: landing.city.label, href: `/${lang}/properties/${landing.city.slug}/` },
  ];

  if (landing.area) {
    breadcrumbs.push({
      name: landing.area.label,
      href:
        landing.kind === "city-area-type"
          ? `/${lang}/properties/${landing.city.slug}/${landing.area.slug}/`
          : landing.canonicalPath,
    });
  }

  if (landing.type) {
    breadcrumbs.push({
      name: landing.type.label,
      href: landing.canonicalPath,
    });
  }

  if (landing.popular) {
    breadcrumbs.push({
      name: landing.popular.label,
      href: landing.canonicalPath,
    });
  }

  return {
    title,
    description,
    h1,
    intro: override?.intro ?? intro,
    bodyBlocks: override?.bodyBlocks?.length ? override.bodyBlocks : bodyBlocks,
    faqItems: override?.faqItems?.length ? override.faqItems : faqItems,
    breadcrumbs,
    ogImage,
    noindex: !landing.indexable || resultCount < landing.minResults,
  };
}
