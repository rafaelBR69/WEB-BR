import post2026VenderCasaBlancarealLegalMarketing from "./post-2026-vender-casa-blancareal-legal-marketing.json";
import post2026WhyBuyHouseMalagaWithAgency from "./post-2026-why-buy-house-malaga-with-agency.json";
import post2026CostaDelSolTaxes from "./post-2026-costa-del-sol-taxes.json";
import post2026AlquilarMiViviendaParaTuristas from "./post-2026-alquilar-mi-vivienda-para-turistas.json";
import post2026InformacionLegalOcupacionIlegalEspana from "./post-2026-informacion-legal-ocupacion-ilegal-espana.json";
import post2026DorronsoroCalahondaSunset from "./post-2026-dorronsoro-calahonda-sunset.json";

export const POST_CATEGORY_ORDER = [
  "market",
  "guide",
  "company",
  "service",
  "legal",
  "news",
  "interview"
] as const;

export type PostCategory = (typeof POST_CATEGORY_ORDER)[number];

export const isPostCategory = (value: string): value is PostCategory =>
  POST_CATEGORY_ORDER.includes(value as PostCategory);

const posts = [
  post2026VenderCasaBlancarealLegalMarketing,
  post2026CostaDelSolTaxes,
  post2026WhyBuyHouseMalagaWithAgency,
  post2026AlquilarMiViviendaParaTuristas,
  post2026InformacionLegalOcupacionIlegalEspana,
  post2026DorronsoroCalahondaSunset,
];

export default posts;

