export type PropertyLandingOverride = {
  intro?: string;
  bodyBlocks?: Array<{
    title: string;
    text: string;
  }>;
  faqItems?: Array<{
    question: string;
    answer: string;
  }>;
};

export const PROPERTY_LANDING_OVERRIDES: Record<string, Record<string, PropertyLandingOverride>> = {
  es: {
    "mijas": {
      intro:
        "Mijas combina costa, campos de golf y urbanizaciones consolidadas. Esta landing agrupa oportunidades activas con una lectura clara del mercado local.",
      bodyBlocks: [
        {
          title: "Por que Mijas sigue captando demanda",
          text:
            "Mijas mantiene demanda por equilibrio entre costa, urbanizaciones consolidadas y acceso comodo a Malaga, Marbella y servicios diarios. La landing prioriza stock visible y util para comprador real.",
        },
        {
          title: "Como interpretar esta seleccion",
          text:
            "Aqui se agrupa producto publico con salida comercial y lectura clara de zona. Si necesita ampliar a otras microzonas o afinar por presupuesto, el catalogo interactivo sigue siendo el siguiente paso.",
        },
      ],
    },
    "marbella": {
      intro:
        "Marbella concentra algunas de las zonas mas demandadas del mercado premium en Costa del Sol. Reunimos propiedades seleccionadas con asesoramiento legal y comercial integrado.",
      faqItems: [
        {
          question: "Que diferencia a Marbella frente a otras zonas de la Costa del Sol?",
          answer:
            "Combina demanda internacional constante, oferta premium y una lectura de mercado muy segmentada por microzonas, por eso priorizamos landings mas precisas y no solo un listado general.",
        },
        {
          question: "Esta landing mezcla reventa y obra nueva?",
          answer:
            "Puede incluir ambas si estan publicadas y visibles. Para intenciones mas concretas, desde aqui puede pasar a landings de tipologia, zona u obra nueva.",
        },
        {
          question: "Como seguir desde aqui si busco producto muy especifico?",
          answer:
            "Lo recomendable es entrar en la zona o tipologia con mayor encaje y luego afinar en el catalogo por precio, dormitorios o referencia.",
        },
      ],
    },
    "mijas/la-cala": {
      intro:
        "La Cala de Mijas destaca por su equilibrio entre vida residencial, playa y servicios diarios. Aqui agrupamos una seleccion activa para compradores que priorizan ubicacion y liquidez.",
      faqItems: [
        {
          question: "Por que La Cala de Mijas tiene una demanda tan recurrente?",
          answer:
            "Porque combina acceso a playa, servicios cotidianos, perfil residencial y buena liquidez tanto para segunda residencia como para comprador patrimonial.",
        },
        {
          question: "Es mejor entrar por esta landing que por un filtro temporal?",
          answer:
            "Si. Esta URL mantiene una intencion clara, copy estable y enlazado interno mas limpio que una URL de filtros efimera.",
        },
        {
          question: "Que hago si quiero una seleccion mas cerrada dentro de La Cala?",
          answer:
            "Desde esta misma landing puede saltar a la combinacion por tipologia o abrir el catalogo con el contexto de zona ya resuelto.",
        },
      ],
    },
    "mijas/la-cala/pisos": {
      intro:
        "Los apartamentos en La Cala de Mijas concentran una parte importante de la demanda internacional por cercania a playa, servicios y facilidad de uso como segunda residencia o activo patrimonial.",
    },
    "mijas/pisos": {
      intro:
        "La demanda de pisos en Mijas combina segunda residencia, comprador patrimonial y busqueda de producto mas liquido en zonas bien conectadas con la costa.",
      faqItems: [
        {
          question: "Que perfil de piso se encuentra en Mijas?",
          answer:
            "Depende del stock activo, pero suele combinar obra nueva, producto residencial consolidado y oportunidades cercanas a costa, golf o servicios diarios.",
        },
        {
          question: "Es mejor empezar por Mijas general o por una microzona?",
          answer:
            "Si todavia no tiene la zona cerrada, esta landing general es un buen punto de entrada. Si ya prioriza Calahonda, La Cala o Las Lagunas, conviene entrar por esa URL mas precisa.",
        },
        {
          question: "Puedo refinar despues por presupuesto o dormitorios?",
          answer:
            "Si. La landing funciona como entrada SEO estable y desde aqui puede continuar al catalogo con filtros tecnicos.",
        },
      ],
    },
    "mijas/calahonda": {
      intro:
        "Calahonda mantiene una demanda estable por su ubicacion intermedia, comunidades consolidadas y una combinacion atractiva entre uso residencial y segunda vivienda.",
    },
    "mijas/las-lagunas": {
      intro:
        "Las Lagunas de Mijas conecta vida diaria, servicios y acceso rapido a Fuengirola y la costa, por eso encaja bien para comprador residencial que prioriza practicidad.",
    },
    "fuengirola": {
      intro:
        "Fuengirola funciona muy bien para comprador que busca conexion diaria, paseo maritimo y stock con lectura urbana clara. Esta landing se centra en producto visible y util para intencion transaccional.",
    },
    "fuengirola/torreblanca": {
      intro:
        "Torreblanca responde a una busqueda muy reconocible dentro de Fuengirola por vistas, pendiente residencial y proximidad a playa y conexiones.",
      faqItems: [
        {
          question: "Por que Torreblanca merece una landing propia?",
          answer:
            "Porque tiene una intencion de busqueda distinta dentro de Fuengirola y un perfil de producto mas concreto que una landing solo por ciudad.",
        },
        {
          question: "Que tipo de propiedades destacan en Torreblanca?",
          answer:
            "Suele aparecer producto con vistas, promociones recientes y vivienda enfocada a comprador que busca tranquilidad sin salir del entorno urbano de Fuengirola.",
        },
        {
          question: "Cuando paso de Torreblanca al catalogo general?",
          answer:
            "Cuando ya necesita afinar por precio, dormitorios, referencia o ampliar el radio a otras zonas de Fuengirola.",
        },
      ],
    },
    "manilva": {
      intro:
        "Manilva gana peso en busquedas transaccionales por su relacion valor-ubicacion, el crecimiento de obra nueva y una oferta que atrae tanto segunda residencia como inversor.",
    },
    "mijas/search/sea-view": {
      intro:
        "Estas propiedades en Mijas priorizan vistas al mar y una lectura mas clara del inventario activo para usuarios que llegan con esa intencion concreta de busqueda.",
    },
    "marbella/search/new-build": {
      intro:
        "Esta landing agrupa obra nueva visible en Marbella para compradores que quieren producto actual, procesos mas claros y comparativa directa desde una URL indexable.",
      bodyBlocks: [
        {
          title: "Que aporta esta landing de obra nueva",
          text:
            "Filtra una intencion muy concreta de mercado y evita que el usuario llegue a una URL de filtros temporal. Aqui solo entra stock visible alineado con esa demanda de producto actual.",
        },
        {
          title: "Cuando conviene pasar al catalogo",
          text:
            "Si ya tiene una preferencia de zona, ticket o numero de dormitorios, lo eficiente es usar esta landing como punto de entrada y terminar la seleccion en el catalogo interactivo.",
        },
      ],
    },
  },
  en: {
    "mijas": {
      intro:
        "Mijas combines coastline, golf communities and established residential areas. This landing groups active opportunities with a clear read of the local market.",
      bodyBlocks: [
        {
          title: "Why Mijas keeps attracting demand",
          text:
            "Mijas balances coastline, established communities and practical access to Malaga and Marbella. This page focuses on visible stock with clear buyer intent rather than temporary filter states.",
        },
        {
          title: "How to use this landing",
          text:
            "Use it as a stable market entry point. If the search becomes more specific, continue into the interactive catalogue with area, price or bedroom filters.",
        },
      ],
    },
    "marbella": {
      intro:
        "Marbella concentrates some of the strongest premium demand on the Costa del Sol. We bring together selected opportunities with legal and commercial guidance.",
      faqItems: [
        {
          question: "What makes Marbella different from other Costa del Sol searches?",
          answer:
            "It combines sustained international demand with highly segmented micro-markets, which is why precise landing pages outperform generic filter states here.",
        },
        {
          question: "Does this landing mix resale and new-build stock?",
          answer:
            "It can include both when they are public and visible. From here you can move into more specific area, type or new-build landings.",
        },
        {
          question: "What is the next step for a tighter shortlist?",
          answer:
            "Move to the closest area or property-type landing first, then refine in the catalogue by price, bedrooms or reference.",
        },
      ],
    },
    "mijas/la-cala/pisos": {
      intro:
        "Apartments in La Cala de Mijas attract recurring international demand thanks to beach access, day-to-day services and strong second-home appeal.",
    },
    "mijas/pisos": {
      intro:
        "Apartments in Mijas attract second-home buyers, relocations and investors looking for a more liquid entry point across established Costa del Sol submarkets.",
    },
    "fuengirola/torreblanca": {
      intro:
        "Torreblanca stands out inside Fuengirola for elevated views, a more residential setting and a recognisable micro-market with clear search intent.",
    },
    "manilva": {
      intro:
        "Manilva is gaining traction for buyers who want stronger value, new-build supply and a quieter Costa del Sol position without losing sea access.",
    },
    "fuengirola": {
      intro:
        "Fuengirola works well for buyers who want practical day-to-day connectivity, a strong seafront setting and urban stock with clearer transaction intent.",
    },
    "mijas/search/sea-view": {
      intro:
        "This landing focuses on active inventory in Mijas with sea views, giving search traffic a stable page aligned with that exact intent.",
    },
    "marbella/search/new-build": {
      intro:
        "This landing groups visible new-build stock in Marbella for buyers who want current product, cleaner purchase processes and a stronger comparison base.",
      bodyBlocks: [
        {
          title: "Why this new-build page matters",
          text:
            "It captures a high-intent market query in a stable URL, using only visible stock that matches the search rather than a temporary filtered catalogue state.",
        },
        {
          title: "When to move deeper into the catalogue",
          text:
            "Once the buyer has a preferred zone, price band or bedroom count, use the full catalogue to finish the shortlist from this stronger entry page.",
        },
      ],
    },
  },
};
