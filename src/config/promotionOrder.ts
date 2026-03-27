export const PROMOTION_EDITORIAL_ORDER = [
  "PM0079",
  "PM0074",
  "PM0011",
] as const;

const PROMOTION_EDITORIAL_RANK = new Map(
  PROMOTION_EDITORIAL_ORDER.map((id, index) => [id, index])
);

export function getPromotionEditorialRank(id: string | null | undefined): number {
  if (!id) return Number.POSITIVE_INFINITY;
  return PROMOTION_EDITORIAL_RANK.get(String(id)) ?? Number.POSITIVE_INFINITY;
}

export function comparePromotionEditorialOrder(
  a: { id?: string | null; priority?: number | null },
  b: { id?: string | null; priority?: number | null }
): number {
  const rankA = getPromotionEditorialRank(a.id);
  const rankB = getPromotionEditorialRank(b.id);

  if (rankA !== rankB) {
    return rankA - rankB;
  }

  const priorityA = typeof a.priority === "number" ? a.priority : Number.NEGATIVE_INFINITY;
  const priorityB = typeof b.priority === "number" ? b.priority : Number.NEGATIVE_INFINITY;

  if (priorityA !== priorityB) {
    return priorityB - priorityA;
  }

  return String(a.id ?? "").localeCompare(String(b.id ?? ""), "es");
}
