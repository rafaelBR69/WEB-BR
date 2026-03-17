import type {
  PropertyLandingContent,
  PropertyLandingFaqItem,
} from "@shared/seo/propertyLandingContent";

const SITE_URL = "https://blancareal.com";

export function buildPropertyLandingSchema({
  lang,
  canonicalPath,
  content,
  cards,
}: {
  lang: string;
  canonicalPath: string;
  content: PropertyLandingContent;
  cards: Array<any>;
}) {
  const canonicalUrl = `${SITE_URL}${canonicalPath}`;
  const itemListElement = cards.slice(0, 12).map((card, index) => ({
    "@type": "ListItem",
    position: index + 1,
    url: `${SITE_URL}/${lang}/property/${card.slug}`,
    name: card.title,
  }));

  const schemas = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: content.h1,
      description: content.description,
      url: canonicalUrl,
      inLanguage: lang,
      image: content.ogImage ?? undefined,
      mainEntity: itemListElement.length
        ? {
            "@type": "ItemList",
            numberOfItems: cards.length,
            itemListElement,
          }
        : undefined,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: content.breadcrumbs.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: crumb.name,
        item: `${SITE_URL}${crumb.href}`,
      })),
    },
    itemListElement.length
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          numberOfItems: cards.length,
          itemListElement,
        }
      : null,
    content.faqItems.length
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: content.faqItems.map((item: PropertyLandingFaqItem) => ({
            "@type": "Question",
            name: item.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: item.answer,
            },
          })),
        }
      : null,
  ];

  return schemas.filter(Boolean);
}
