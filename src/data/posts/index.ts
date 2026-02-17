import post2026WhiteHillsUpdate from "./post-2026-white-hills-update.json";
import post2026BuyingNewBuildGuide from "./post-2026-buying-new-build-guide.json";
import post2026MarketSnapshot from "./post-2026-market-snapshot.json";

export const POST_CATEGORY_ORDER = [
  "market",
  "guide",
  "company",
] as const;

export type PostCategory = (typeof POST_CATEGORY_ORDER)[number];

export const isPostCategory = (value: string): value is PostCategory =>
  POST_CATEGORY_ORDER.includes(value as PostCategory);

const posts = [
  post2026WhiteHillsUpdate,
  post2026BuyingNewBuildGuide,
  post2026MarketSnapshot,
];

export default posts;

