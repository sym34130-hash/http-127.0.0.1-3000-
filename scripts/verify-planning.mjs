import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(rootDir, "src/lib/planning.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
});
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-planning-"));
const compiledPath = path.join(tempDir, "planning.cjs");
fs.writeFileSync(compiledPath, outputText);

const {
  computeAlerts,
  computeKpis,
  computeSlots,
  normalizeRows,
  uniqueFlux
} = require(compiledPath);

function row(code, arrival, duration = "20", extra = {}) {
  return {
    JOUR: "20/04/2026",
    CODETOURNEE: code,
    RAMASSES: `Ramasse ${code}`,
    HEUREDARRIVEE: arrival,
    TDECHARCAMION: duration,
    NBPALETTESMARCHANDISES: "10",
    SEC: "x",
    ...extra
  };
}

function assertScenario(name, run) {
  run();
  console.log(`OK ${name}`);
}

assertScenario("ajout et buffer de 10 minutes", () => {
  const trucks = normalizeRows([row("A1", "13:00", "20")]);

  assert.equal(trucks.length, 1);
  assert.equal(trucks[0].temps_dechargement_minutes, 30);
  assert.equal(trucks[0].temps_attente, 0);
});

assertScenario("arrivees simultanees et saturation des 5 portes", () => {
  const trucks = normalizeRows(Array.from({ length: 6 }, (_, index) => row(`S${index + 1}`, "13:00", "20")));
  const sixthTruck = trucks.find((truck) => truck.code_voyage === "S6");
  const firstSlot = computeSlots(trucks)[0];
  const alerts = computeAlerts(trucks, computeSlots(trucks));

  assert.equal(sixthTruck?.temps_attente, 30);
  assert.equal(Math.round(firstSlot.occupancyRate * 100), 100);
  assert.equal(firstSlot.occupiedMinutes, 150);
  assert.equal(firstSlot.backlogMinutes, 30);
  assert.equal(firstSlot.waitingTrucks, 1);
  assert.ok(alerts.some((alert) => alert.title === "Saturation quai"));
  assert.ok(alerts.some((alert) => alert.title === "Attente quai"));
});

assertScenario("modification d'une ramasse", () => {
  const initial = normalizeRows(Array.from({ length: 6 }, (_, index) => row(`M${index + 1}`, "13:00", "20")));
  const modified = normalizeRows([
    ...Array.from({ length: 5 }, (_, index) => row(`M${index + 1}`, "13:00", "20")),
    row("M6", "14:00", "20")
  ]);

  assert.equal(computeKpis(initial).maxWait, 30);
  assert.equal(computeKpis(modified).maxWait, 0);
});

assertScenario("suppression d'une ramasse", () => {
  const withTruck = normalizeRows(Array.from({ length: 6 }, (_, index) => row(`D${index + 1}`, "13:00", "20")));
  const withoutTruck = normalizeRows(Array.from({ length: 5 }, (_, index) => row(`D${index + 1}`, "13:00", "20")));

  assert.equal(withTruck.length, 6);
  assert.equal(withoutTruck.length, 5);
  assert.equal(computeKpis(withoutTruck).trucksWithWait, 0);
});

assertScenario("donnees incompletes", () => {
  const trucks = normalizeRows([row("I1", "", "20")]);

  assert.equal(trucks[0].statut, "incomplet");
  assert.equal(trucks[0].porte_affectee, null);
  assert.ok(trucks[0].dataIssues.some((issue) => issue.includes("Heure")));
});

assertScenario("journee faible activite", () => {
  const trucks = normalizeRows([row("F1", "13:00", "20"), row("F2", "15:00", "20")]);
  const kpis = computeKpis(trucks);

  assert.equal(kpis.trucksWithWait, 0);
  assert.ok(kpis.globalOccupancyRate < 0.1);
});

assertScenario("journee forte activite", () => {
  const trucks = normalizeRows(Array.from({ length: 10 }, (_, index) => row(`H${index + 1}`, "13:00", "20")));
  const kpis = computeKpis(trucks);

  assert.equal(kpis.totalTrucks, 10);
  assert.ok(kpis.maxWait >= 30);
  assert.ok(computeAlerts(trucks, computeSlots(trucks)).some((alert) => alert.level === "critical"));
});

assertScenario("suppression complete du flux FRC visible", () => {
  const trucks = normalizeRows([row("R1", "13:00", "20", { FRC: "x", SEC: "" })]);

  assert.equal(trucks[0].type_flux, "Standard");
  assert.deepEqual(uniqueFlux(trucks), ["Standard"]);
});

assertScenario("porte forcee depuis Google Sheet", () => {
  const trucks = normalizeRows([row("P1", "13:00", "20", { PORTE_SOUHAITEE: "3" })]);

  assert.equal(trucks[0].porte_affectee, "Porte 3");
  assert.equal(trucks[0].dockIndex, 2);
});

assertScenario("porte tampon hors capacite des 5 portes", () => {
  const trucks = normalizeRows([row("T1", "13:00", "20", { PORTE_SOUHAITEE: "TAMPON" })]);
  const firstSlot = computeSlots(trucks)[0];

  assert.equal(trucks[0].porte_affectee, "Tampon");
  assert.equal(trucks[0].dockIndex, 5);
  assert.equal(firstSlot.occupiedMinutes, 0);
});

assertScenario("priorite quai a horaire identique", () => {
  const trucks = normalizeRows([
    ...Array.from({ length: 5 }, (_, index) => row(`N${index + 1}`, "13:00", "20")),
    row("PRIO", "13:00", "20", { PRIORITE_QUAI: "OUI" })
  ]);
  const priorityTruck = trucks.find((truck) => truck.code_voyage === "PRIO");

  assert.equal(priorityTruck?.prioriteQuai, true);
  assert.equal(priorityTruck?.temps_attente, 0);
});

assertScenario("conflit de porte forcee signale", () => {
  const trucks = normalizeRows([
    row("C1", "13:00", "20", { PORTE_SOUHAITEE: "1" }),
    row("C2", "13:00", "20", { PORTE_SOUHAITEE: "1" })
  ]);
  const secondTruck = trucks.find((truck) => truck.code_voyage === "C2");
  const alerts = computeAlerts(trucks, computeSlots(trucks));

  assert.equal(secondTruck?.temps_attente, 30);
  assert.ok(secondTruck?.dataIssues.some((issue) => issue.includes("Conflit Porte 1")));
  assert.ok(alerts.some((alert) => alert.title === "Conflit porte forcee"));
});

fs.rmSync(tempDir, { force: true, recursive: true });
console.log("Verification planning terminee.");
