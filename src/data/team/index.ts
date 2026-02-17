import xavierDeHennin from "./xavier-de-hennin.json";
import carlos from "./carlos.json";
import rafa from "./rafa.json";
import cristobal from "./cristobal.json";
import maria from "./maria.json";
import noemi from "./noemi.json";
import natascha from "./natascha.json";
import eva from "./eva.json";
import marcelo from "./marcelo.json";
import yolanda from "./yolanda.json";
import tanis from "./tanis.json";
import cristian from "./cristian.json";
import santiago from "./santiago.json";

export const TEAM_CATEGORY_ORDER = [
  "ceo",
  "commercial",
  "legal",
  "investments",
  "marketing",
] as const;

export type TeamCategory = (typeof TEAM_CATEGORY_ORDER)[number];

const teamMembers = [
  xavierDeHennin,
  natascha,
  eva,
  marcelo,
  yolanda,
  maria,
  noemi,
  tanis,
  cristian,
  carlos,
  rafa,
  cristobal,
  santiago,
];

export default teamMembers;
