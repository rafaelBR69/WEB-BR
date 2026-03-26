import type { DealStage } from "../deals/domain.ts";
import type { NotificationPriority } from "./domain.ts";

export const LEAD_OPEN_NOTIFICATION_STATUSES = new Set([
  "new",
  "in_process",
  "qualified",
  "visit_scheduled",
  "offer_sent",
  "negotiation",
]);

export const RESERVATION_ACTIVE_NOTIFICATION_STATUSES = new Set([
  "pre_registered",
  "reservation_sent",
  "reserved",
  "adhesion_paid",
  "contract_signed",
]);

export const getLeadNewUnworkedPriority = (hoursOpen: number | null): NotificationPriority => {
  return (hoursOpen ?? 0) > 72 ? "urgent" : "high";
};

export const getLeadNoContactPriority = (daysWithoutTouch: number): NotificationPriority => {
  return daysWithoutTouch >= 22 ? "urgent" : "high";
};

export const getDealOverduePriority = (daysLate: number): NotificationPriority => {
  return daysLate > 7 ? "urgent" : "high";
};

export const getDealStalledThresholdDays = (stage: DealStage): number => {
  switch (stage) {
    case "qualification":
    case "visit":
      return 5;
    case "offer":
    case "negotiation":
      return 7;
    case "reservation":
    case "contract":
      return 3;
    default:
      return 9999;
  }
};

export const getDealStalledPriority = (stage: DealStage): NotificationPriority => {
  return stage === "qualification" || stage === "visit" ? "normal" : "high";
};

export const getReservationDocsPriority = (status: string | null): NotificationPriority => {
  return status === "reserved" || status === "adhesion_paid" || status === "contract_signed" ? "high" : "normal";
};
