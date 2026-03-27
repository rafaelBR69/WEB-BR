import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUnitCoverPlan } from "../lib/unit-cover-mapping.mjs";

const withTempRoot = async (callback) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "unit-cover-map-"));
  try {
    await callback(rootDir);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
};

const touch = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "");
};

const cases = [
  {
    name: "resolves PM0011 operational filenames from block folders",
    run: async () => {
      await withTempRoot(async (rootDir) => {
        touch(path.join(rootDir, "Bloque 1", "30C Disponibilidad.webp"));
        touch(path.join(rootDir, "Bloque 2", "220A Disponibilidad.webp"));
        touch(path.join(rootDir, "Bloque 3", "322C Disponibilidad.webp"));

        const plan = createUnitCoverPlan({
          rootDir,
          requestedProjects: new Set(["PM0011"]),
        });

        const matchesByChild = new Map(plan.report.matched.map((item) => [item.childCode, item]));

        assert.equal(matchesByChild.get("PM0011-B1P3_BC")?.resolverRule, "pm0011_operational_token");
        assert.equal(matchesByChild.get("PM0011-B2P2_BA")?.resolverRule, "pm0011_operational_token");
        assert.equal(matchesByChild.get("PM0011-B3P2_2C")?.resolverRule, "pm0011_operational_token");
        assert.equal(plan.report.summary.unresolvedCount, 0);
      });
    },
  },
  {
    name: "resolves PM0074 attic tokens and leaves generic Nylva sheets unresolved",
    run: async () => {
      await withTempRoot(async (rootDir) => {
        touch(
          path.join(
            rootDir,
            "New WEB BlancaReal  Disponibilidad  Almitak",
            "25A diponibilidad-almitak- WEB BLANCAREAL.webp"
          )
        );
        touch(
          path.join(rootDir, "Edificio 1", "disponibilidad-Nylva-edificio-01 web Blancareal.webp")
        );
        touch(path.join(rootDir, "Edificio 1", "Unit 02-disponibilidad-Nylva-edificio-01.webp"));

        const plan = createUnitCoverPlan({
          rootDir,
          requestedProjects: new Set(["PM0074", "PM0079"]),
        });

        const almitak = plan.report.matched.find((item) => item.childCode === "PM0074-P2_ATA");
        const nylva = plan.report.matched.find((item) => item.childCode === "PM0079-02");
        const genericSheet = plan.report.unresolved.find((item) =>
          item.sourcePath.includes("disponibilidad-Nylva-edificio-01")
        );

        assert.equal(almitak?.resolverRule, "pm0074_operational_token");
        assert.equal(nylva?.resolverRule, "pm0079_operational_unit_token");
        assert.equal(genericSheet?.reason, "pm0079_missing_unit_token");
      });
    },
  },
  {
    name: "marks duplicate matches and removes them from the import queue",
    run: async () => {
      await withTempRoot(async (rootDir) => {
        touch(path.join(rootDir, "Edificio 1", "Unit 02-disponibilidad-Nylva-edificio-01.webp"));
        touch(
          path.join(
            rootDir,
            "PM0079-Nylva-Homes-obra-nueva-en-Manilva",
            "PM0079-02.webp"
          )
        );

        const plan = createUnitCoverPlan({
          rootDir,
          requestedProjects: new Set(["PM0079"]),
        });

        assert.equal(plan.report.summary.duplicateCount, 1);
        assert.equal(plan.report.summary.importableCount, 0);
        assert.equal(plan.report.duplicates[0]?.childCode, "PM0079-02");
        assert.deepEqual(
          plan.report.duplicates[0]?.sources.map((item) => item.resolverRule).sort(),
          ["canonical_exact_filename", "pm0079_operational_unit_token"]
        );
      });
    },
  },
  {
    name: "reports derived children that do not exist",
    run: async () => {
      await withTempRoot(async (rootDir) => {
        touch(path.join(rootDir, "Edificio 2", "Unit 99-disponibilidad-Nylva-edificio-02.webp"));

        const plan = createUnitCoverPlan({
          rootDir,
          requestedProjects: new Set(["PM0079"]),
        });

        assert.equal(plan.report.summary.matchedCount, 0);
        assert.equal(plan.report.summary.unresolvedCount, 1);
        assert.equal(plan.report.unresolved[0]?.attemptedChildCode, "PM0079-99");
        assert.equal(plan.report.unresolved[0]?.reason, "derived_child_not_found");
      });
    },
  },
];

let passed = 0;

for (const testCase of cases) {
  try {
    await testCase.run();
    passed += 1;
    console.log(`PASS ${testCase.name}`);
  } catch (error) {
    console.error(`FAIL ${testCase.name}`);
    throw error;
  }
}

console.log(`All ${passed} unit cover mapping tests passed.`);
