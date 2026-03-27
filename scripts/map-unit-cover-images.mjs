import path from "node:path";
import {
  DEFAULT_ROOT_DIR,
  createUnitCoverPlan,
  normalizeCode,
  readArg,
  splitList,
} from "./lib/unit-cover-mapping.mjs";

const requestedProjects = new Set(
  splitList(readArg("project") ?? readArg("projects")).map((value) => normalizeCode(value))
);

const rootDir = path.resolve(readArg("root-dir") ?? DEFAULT_ROOT_DIR);
const plan = createUnitCoverPlan({ rootDir, requestedProjects });

console.log(JSON.stringify(plan.report, null, 2));
