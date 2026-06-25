import type {
  ArrivalBand,
  Filters,
  KpiSet,
  OperationAlert,
  SlotAnalysis,
  SlotStatus,
  Truck,
  TruckStatus
} from "@/types";

export const WINDOW_START = 13 * 60;
export const WINDOW_END = 19 * 60;
export const DOCK_NUMBERS = [27, 28, 29, 30, 31];
export const DOCK_COUNT = DOCK_NUMBERS.length;
export const SLOT_MINUTES = 30;
export const SLOT_CAPACITY = DOCK_COUNT * SLOT_MINUTES;
export const DAY_CAPACITY = DOCK_COUNT * (WINDOW_END - WINDOW_START);
export const UNLOAD_BUFFER_MINUTES = 10;

export type OperationWindowId = "morning" | "afternoon" | "day";

export type OperationWindow = {
  id: OperationWindowId;
  label: string;
  shortLabel: string;
  start: number;
  end: number;
};

export const OPERATION_WINDOWS: OperationWindow[] = [
  {
    id: "morning",
    label: "Matin",
    shortLabel: "06h00 - 13h00",
    start: 6 * 60,
    end: 13 * 60
  },
  {
    id: "afternoon",
    label: "Apres-midi",
    shortLabel: "13h00 - 19h00",
    start: WINDOW_START,
    end: WINDOW_END
  },
  {
    id: "day",
    label: "Journee",
    shortLabel: "24h",
    start: 0,
    end: 24 * 60
  }
];

export const DEFAULT_OPERATION_WINDOW = OPERATION_WINDOWS[2];

type SheetRow = Record<string, string | number | null | undefined>;

const FIELD_ALIASES = {
  jour: ["JOUR"],
  cle: ["CLE"],
  compteur: ["COMPTEURLOCAL"],
  code: ["CODETOURNEE"],
  ramasses: ["RAMASSES"],
  arrivee: ["HEUREDARRIVEE", "HEUREARRIVEE"],
  palettes: ["NBPALETTESMARCHANDISES"],
  sec: ["SEC"],
  frais: ["FRAIS"],
  surgele: ["SURGELE"],
  semi: ["SEMI"],
  porteur: ["PORTEUR"],
  decharge: ["TDECHARCAMION"],
  creneau: ["CRENEAUHORAIRE", "CRENAUHORAIRE"],
  porteSouhaitee: ["PORTESOUHAITEE"],
  prioriteQuai: ["PRIORITEQUAI"]
} satisfies Record<string, string[]>;

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) {
    return "-";
  }

  const normalized = Math.max(0, Math.round(minutes));
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;

  return `${String(hours).padStart(2, "0")}h${String(mins).padStart(2, "0")}`;
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) {
    return "-";
  }

  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins === 0 ? `${hours} h` : `${hours} h ${mins}`;
}

export function formatDateFr(date: string): string {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) {
    return date;
  }

  return `${day}/${month}/${year}`;
}

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

export function normalizeRows(rows: SheetRow[]): Truck[] {
  let currentDate = "";
  const trucks: Truck[] = [];

  rows.forEach((row, index) => {
    if (isEmptyRow(row)) {
      return;
    }

    const normalizedRow = normalizeRowKeys(row);
    const rawDate = readField(normalizedRow, FIELD_ALIASES.jour);
    const parsedDate = parseSheetDate(rawDate);

    if (parsedDate) {
      currentDate = parsedDate;
    }

    const code = cleanText(readField(normalizedRow, FIELD_ALIASES.code));
    if (!code) {
      return;
    }

    const arrivalRaw = cleanText(readField(normalizedRow, FIELD_ALIASES.arrivee));
    const arrivalMinutes = parseTimeToMinutes(arrivalRaw);
    const durationRaw = readField(normalizedRow, FIELD_ALIASES.decharge);
    const parsedDuration = parseNumber(durationRaw);
    const durationEstimated = parsedDuration === null || parsedDuration <= 0;
    const baseDuration = durationEstimated ? 15 : Math.max(1, Math.round(parsedDuration));
    const duration = baseDuration + UNLOAD_BUFFER_MINUTES;
    const flux = buildFlux(normalizedRow);
    const porteSouhaitee = cleanText(readField(normalizedRow, FIELD_ALIASES.porteSouhaitee));
    const requestedDoor = parseRequestedDoor(porteSouhaitee);
    const prioriteQuai = isMarked(readField(normalizedRow, FIELD_ALIASES.prioriteQuai));
    const dataIssues: string[] = [];

    if (arrivalMinutes === null) {
      dataIssues.push("Heure d'arrivee manquante");
    }

    if (durationEstimated) {
      dataIssues.push("Temps de dechargement estime");
    }

    if (requestedDoor.issue) {
      dataIssues.push(requestedDoor.issue);
    }

    const date = currentDate || "sans-date";
    const compteur = cleanText(readField(normalizedRow, FIELD_ALIASES.compteur));

    trucks.push({
      id: `${date}-${code}-${compteur || index}-${index}`,
      sourceIndex: index,
      date,
      dateLabel: date === "sans-date" ? "Sans date" : formatDateFr(date),
      cle: cleanText(readField(normalizedRow, FIELD_ALIASES.cle)),
      compteur_local: compteur,
      code_voyage: code,
      nom_ramasse: cleanText(readField(normalizedRow, FIELD_ALIASES.ramasses)),
      heure_arrivee: arrivalRaw,
      arrivalMinutes,
      nb_palettes: parseNumber(readField(normalizedRow, FIELD_ALIASES.palettes)),
      type_flux: flux.join(" + ") || "Standard",
      flux,
      type_vehicule: buildVehicle(normalizedRow),
      temps_dechargement_minutes: duration,
      durationEstimated,
      creneau_horaire: cleanText(readField(normalizedRow, FIELD_ALIASES.creneau)),
      porte_souhaitee: porteSouhaitee,
      porteForcee: requestedDoor.dockIndex,
      porteTampon: requestedDoor.isTampon,
      prioriteQuai,
      porte_affectee: null,
      dockIndex: null,
      heure_mise_a_quai: null,
      miseAQuaiMinutes: null,
      heure_fin_dechargement: null,
      finDechargementMinutes: null,
      temps_attente: null,
      statut: arrivalMinutes === null ? "incomplet" : "sans_attente",
      arrivalBand: getArrivalBand(arrivalMinutes),
      dataIssues
    });
  });

  return assignDoorsByDate(trucks);
}

export function assignDoorsByDate(trucks: Truck[]): Truck[] {
  const byDate = new Map<string, Truck[]>();
  trucks.forEach((truck) => {
    const group = byDate.get(truck.date) ?? [];
    group.push({ ...truck });
    byDate.set(truck.date, group);
  });

  const planned: Truck[] = [];

  Array.from(byDate.entries()).forEach(([, dateTrucks]) => {
    const valid = dateTrucks
      .filter((truck) => truck.arrivalMinutes !== null)
      .sort((a, b) => {
        const arrivalDelta = (a.arrivalMinutes ?? 0) - (b.arrivalMinutes ?? 0);
        if (arrivalDelta !== 0) {
          return arrivalDelta;
        }

        if (a.prioriteQuai !== b.prioriteQuai) {
          return a.prioriteQuai ? -1 : 1;
        }

        return a.sourceIndex - b.sourceIndex;
      });

    const dockAvailableAt = Array.from({ length: DOCK_COUNT }, () => 0);
    const plannedById = new Map<string, Truck>();

    valid.forEach((truck) => {
      const arrival = truck.arrivalMinutes ?? 0;
      const immediateDockIndex = dockAvailableAt.findIndex((availableAt) => availableAt <= arrival);
      const dockIndex = truck.porteTampon
        ? DOCK_COUNT
        : truck.porteForcee !== null
          ? truck.porteForcee
          : immediateDockIndex >= 0
            ? immediateDockIndex
            : indexOfEarliestDock(dockAvailableAt);
      const miseAQuai = truck.porteTampon ? arrival : Math.max(arrival, dockAvailableAt[dockIndex]);
      const fin = miseAQuai + truck.temps_dechargement_minutes;
      const wait = miseAQuai - arrival;
      const dataIssues = [...truck.dataIssues];

      if (truck.porteForcee !== null && wait > 0) {
        dataIssues.push(`Conflit ${formatDoorLabel(dockIndex)} indisponible a l'arrivee`);
      }

      if (!truck.porteTampon) {
        dockAvailableAt[dockIndex] = fin;
      }

      plannedById.set(truck.id, {
        ...truck,
        dataIssues,
        porte_affectee: formatDoorLabel(dockIndex),
        dockIndex,
        heure_mise_a_quai: formatMinutes(miseAQuai),
        miseAQuaiMinutes: miseAQuai,
        heure_fin_dechargement: formatMinutes(fin),
        finDechargementMinutes: fin,
        temps_attente: wait,
        statut: getTruckStatus(truck.arrivalBand, wait, truck.dataIssues)
      });
    });

    dateTrucks.forEach((truck) => {
      planned.push(plannedById.get(truck.id) ?? truck);
    });
  });

  return planned.sort((a, b) => {
    const dateDelta = a.date.localeCompare(b.date);
    if (dateDelta !== 0) {
      return dateDelta;
    }

    return a.sourceIndex - b.sourceIndex;
  });
}

export function applyFilters(trucks: Truck[], filters: Filters): Truck[] {
  return trucks.filter((truck) => {
    if (filters.date && truck.date !== filters.date) {
      return false;
    }

    if (filters.code && !truck.code_voyage.toLowerCase().includes(filters.code.toLowerCase())) {
      return false;
    }

    if (
      filters.ramasse &&
      !truck.nom_ramasse.toLowerCase().includes(filters.ramasse.toLowerCase())
    ) {
      return false;
    }

    if (filters.status !== "all" && truck.statut !== filters.status) {
      return false;
    }

    if (filters.flux !== "all" && !truck.flux.includes(filters.flux)) {
      return false;
    }

    return true;
  });
}

export function getOperationWindow(id: OperationWindowId): OperationWindow {
  return OPERATION_WINDOWS.find((window) => window.id === id) ?? DEFAULT_OPERATION_WINDOW;
}

export function formatOperationWindow(window: OperationWindow): string {
  return window.id === "day" ? "00h00 - 24h00" : `${formatMinutes(window.start)} - ${formatMinutes(window.end)}`;
}

export function isMinuteInWindow(minute: number, window: OperationWindow): boolean {
  return minute >= window.start && minute < window.end;
}

export function isTruckInOperationWindow(truck: Truck, window: OperationWindow): boolean {
  if (window.id === "day") {
    return true;
  }

  if (truck.arrivalMinutes !== null && isMinuteInWindow(truck.arrivalMinutes, window)) {
    return true;
  }

  if (
    truck.miseAQuaiMinutes !== null &&
    truck.finDechargementMinutes !== null &&
    overlapMinutes(truck.miseAQuaiMinutes, truck.finDechargementMinutes, window.start, window.end) > 0
  ) {
    return true;
  }

  if (
    truck.arrivalMinutes !== null &&
    truck.miseAQuaiMinutes !== null &&
    truck.miseAQuaiMinutes > truck.arrivalMinutes &&
    overlapMinutes(truck.arrivalMinutes, truck.miseAQuaiMinutes, window.start, window.end) > 0
  ) {
    return true;
  }

  return false;
}

export function filterTrucksByOperationWindow(trucks: Truck[], window: OperationWindow): Truck[] {
  return trucks.filter((truck) => isTruckInOperationWindow(truck, window));
}

export function computeSlots(trucks: Truck[], window: OperationWindow = DEFAULT_OPERATION_WINDOW): SlotAnalysis[] {
  const slotCount = Math.ceil((window.end - window.start) / SLOT_MINUTES);

  return Array.from({ length: slotCount }, (_, index) => {
    const start = window.start + index * SLOT_MINUTES;
    const end = Math.min(window.end, start + SLOT_MINUTES);
    const isLastSlot = index === slotCount - 1;
    const arrivals = trucks.filter(
      (truck) =>
        truck.arrivalMinutes !== null &&
        truck.arrivalMinutes >= start &&
        (isLastSlot ? truck.arrivalMinutes <= end : truck.arrivalMinutes < end)
    );
    const doorTrucks = trucks.filter((truck) => !truck.porteTampon);
    const totalUnloadMinutes = arrivals
      .filter((truck) => !truck.porteTampon)
      .reduce((sum, truck) => sum + truck.temps_dechargement_minutes, 0);
    const occupiedMinutes = doorTrucks.reduce((sum, truck) => {
      if (truck.miseAQuaiMinutes === null || truck.finDechargementMinutes === null) {
        return sum;
      }

      return sum + overlapMinutes(truck.miseAQuaiMinutes, truck.finDechargementMinutes, start, end);
    }, 0);
    const backlogMinutes = doorTrucks.reduce((sum, truck) => {
      if (
        truck.arrivalMinutes === null ||
        truck.miseAQuaiMinutes === null ||
        truck.miseAQuaiMinutes <= truck.arrivalMinutes
      ) {
        return sum;
      }

      return sum + overlapMinutes(truck.arrivalMinutes, truck.miseAQuaiMinutes, start, end);
    }, 0);
    const waitingTrucks = doorTrucks.filter(
      (truck) =>
        truck.arrivalMinutes !== null &&
        truck.miseAQuaiMinutes !== null &&
        truck.arrivalMinutes < end &&
        truck.miseAQuaiMinutes > start
    ).length;
    const occupancyRate = occupiedMinutes / SLOT_CAPACITY;
    const status = getSlotStatus(occupancyRate, backlogMinutes);

    return {
      label: `${formatMinutes(start)} - ${formatMinutes(end)}`,
      start,
      end,
      arrivals: arrivals.length,
      totalUnloadMinutes,
      occupiedMinutes,
      capacityMinutes: SLOT_CAPACITY,
      occupancyRate,
      backlogMinutes,
      waitingTrucks,
      status
    };
  });
}

export function computeKpis(trucks: Truck[], window: OperationWindow = DEFAULT_OPERATION_WINDOW): KpiSet {
  const assigned = trucks.filter((truck) => truck.arrivalMinutes !== null);
  const waits = assigned
    .map((truck) => truck.temps_attente)
    .filter((wait): wait is number => wait !== null);
  const slots = computeSlots(trucks, window);
  const busiest = slots
    .slice()
    .sort((a, b) => b.occupancyRate - a.occupancyRate || b.arrivals - a.arrivals)[0];
  const occupiedMinutes = trucks.reduce((sum, truck) => {
    if (truck.porteTampon || truck.miseAQuaiMinutes === null || truck.finDechargementMinutes === null) {
      return sum;
    }

    return sum + overlapMinutes(truck.miseAQuaiMinutes, truck.finDechargementMinutes, window.start, window.end);
  }, 0);
  const windowCapacity = DOCK_COUNT * (window.end - window.start);

  return {
    totalTrucks: trucks.length,
    trucksInWindow: trucks.filter(
      (truck) => truck.arrivalMinutes !== null && isMinuteInWindow(truck.arrivalMinutes, window)
    ).length,
    trucksBefore: trucks.filter((truck) => truck.arrivalMinutes !== null && truck.arrivalMinutes < window.start).length,
    trucksAfter: trucks.filter((truck) => truck.arrivalMinutes !== null && truck.arrivalMinutes >= window.end).length,
    trucksWithoutWait: assigned.filter((truck) => (truck.temps_attente ?? 0) === 0).length,
    trucksWithWait: assigned.filter((truck) => (truck.temps_attente ?? 0) > 0).length,
    averageWait: waits.length ? waits.reduce((sum, wait) => sum + wait, 0) / waits.length : 0,
    maxWait: waits.length ? Math.max(...waits) : 0,
    globalOccupancyRate: windowCapacity > 0 ? occupiedMinutes / windowCapacity : 0,
    busiestSlot: busiest ? busiest.label : "-",
    incompleteData: trucks.filter((truck) => truck.dataIssues.length > 0 || truck.statut === "incomplet").length,
    estimatedDurations: trucks.filter((truck) => truck.durationEstimated).length
  };
}

export function computeAlerts(trucks: Truck[], slots: SlotAnalysis[]): OperationAlert[] {
  const alerts: OperationAlert[] = [];
  const saturatedSlots = slots.filter((slot) => slot.occupancyRate >= 0.9);
  const backlogSlots = slots.filter((slot) => slot.backlogMinutes >= 5);
  const peakSlots = slots.filter((slot) => slot.arrivals > 5);
  const highWait = trucks.filter((truck) => (truck.temps_attente ?? 0) >= 15);
  const forcedDoorConflicts = trucks.filter((truck) =>
    truck.dataIssues.some((issue) => issue.startsWith("Conflit Porte"))
  );
  const priorityTrucks = trucks.filter((truck) => truck.prioriteQuai || truck.porteTampon);
  const maxQueue = computeMaxQueueDepth(trucks);
  const incomplete = trucks.filter((truck) => truck.arrivalBand === "missing");
  const estimated = trucks.filter((truck) => truck.durationEstimated);

  saturatedSlots.forEach((slot) => {
    alerts.push({
      id: `saturation-${slot.label}`,
      level: slot.status === "backlog" || slot.occupancyRate >= 0.98 ? "critical" : "warning",
      title: "Saturation quai",
      detail: `${slot.label} a ${Math.round(slot.occupancyRate * 100)} % d'occupation reelle.`
    });
  });

  backlogSlots.forEach((slot) => {
    alerts.push({
      id: `backlog-${slot.label}`,
      level: slot.backlogMinutes >= 30 ? "critical" : "warning",
      title: "Attente quai",
      detail: `${slot.waitingTrucks} camion(s) en attente sur ${slot.label}, ${Math.round(slot.backlogMinutes)} min cumulees.`
    });
  });

  if (maxQueue > 3) {
    alerts.push({
      id: "queue-critical",
      level: "critical",
      title: "File d'attente critique",
      detail: `${maxQueue} camions attendent simultanement au pic.`
    });
  }

  if (highWait.length > 0) {
    alerts.push({
      id: "high-wait",
      level: "warning",
      title: "Attente elevee",
      detail: `${highWait.length} camion(s) attendent au moins 15 min.`
    });
  }

  if (forcedDoorConflicts.length > 0) {
    alerts.push({
      id: "forced-door-conflict",
      level: "warning",
      title: "Conflit porte forcee",
      detail: `${forcedDoorConflicts.length} camion(s) forces sur une porte deja occupee a l'arrivee.`
    });
  }

  if (priorityTrucks.length > 0) {
    alerts.push({
      id: "priority-quai",
      level: "info",
      title: "Priorite quai",
      detail: `${priorityTrucks.length} camion(s) avec priorite ou porte Tampon.`
    });
  }

  peakSlots.forEach((slot) => {
    alerts.push({
      id: `peak-${slot.label}`,
      level: "warning",
      title: "Pic d'arrivee",
      detail: `${slot.arrivals} camions arrivent sur ${slot.label}.`
    });
  });

  if (incomplete.length > 0) {
    alerts.push({
      id: "missing-data",
      level: "warning",
      title: "Donnees incompletes",
      detail: `${incomplete.length} camion(s) sans heure d'arrivee.`
    });
  }

  if (estimated.length > 0) {
    alerts.push({
      id: "estimated-duration",
      level: "info",
      title: "Temps estime",
      detail: `${estimated.length} camion(s) utilisent 25 min: 15 min par defaut + 10 min.`
    });
  }

  return alerts.slice(0, 12);
}

export function getTodayInParis(): string {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function getCurrentMinuteInParis(): number {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "13");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return hour * 60 + minute;
}

export function getOperationalMinute(
  selectedDate: string,
  window: OperationWindow = DEFAULT_OPERATION_WINDOW,
  currentMinute: number = getCurrentMinuteInParis()
): number {
  void selectedDate;
  void window;
  return currentMinute;
}

export function uniqueFlux(trucks: Truck[]): string[] {
  return Array.from(new Set(trucks.flatMap((truck) => truck.flux))).sort((a, b) =>
    a.localeCompare(b)
  );
}

export function statusLabel(status: TruckStatus): string {
  const labels: Record<TruckStatus, string> = {
    sans_attente: "Sans attente",
    attente_courte: "Attente < 15 min",
    attente_longue: "Attente >= 15 min",
    incomplet: "Donnee incomplete",
    hors_plage: "Hors plage"
  };

  return labels[status];
}

export function slotStatusLabel(status: SlotStatus): string {
  const labels: Record<SlotStatus, string> = {
    fluide: "Fluide",
    sous_tension: "Sous tension",
    sature: "Sature",
    backlog: "Backlog"
  };

  return labels[status];
}

function normalizeRowKeys(row: SheetRow): Record<string, string> {
  return Object.entries(row).reduce<Record<string, string>>((result, [key, value]) => {
    result[normalizeHeader(key)] = cleanText(value);
    return result;
  }, {});
}

function readField(row: Record<string, string>, aliases: readonly string[]): string {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined) {
      return value;
    }
  }

  return "";
}

function cleanText(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/\uFFFD/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmptyRow(row: SheetRow): boolean {
  return Object.values(row).every((value) => cleanText(value) === "");
}

function parseSheetDate(value: string): string | null {
  const clean = cleanText(value);
  if (!clean) {
    return null;
  }

  const french = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (french) {
    const [, day, month, year] = french;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const iso = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return null;
}

function parseTimeToMinutes(value: string): number | null {
  const clean = cleanText(value).toLowerCase().replace("h", ":").replace(",", ".");
  if (!clean) {
    return null;
  }

  const timeMatch = clean.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2] ?? "0");

    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return hours * 60 + minutes;
    }
  }

  const decimal = Number(clean);
  if (Number.isFinite(decimal) && decimal > 0 && decimal < 1) {
    return Math.round(decimal * 24 * 60);
  }

  return null;
}

function parseNumber(value: string | number | null | undefined): number | null {
  const clean = cleanText(value).replace(",", ".");
  if (!clean) {
    return null;
  }

  const number = Number(clean);
  return Number.isFinite(number) ? number : null;
}

function isMarked(value: string): boolean {
  const clean = cleanText(value).toLowerCase();
  return clean === "x" || clean === "1" || clean === "oui" || clean === "true";
}

function parseRequestedDoor(value: string): { dockIndex: number | null; isTampon: boolean; issue?: string } {
  const clean = normalizeHeader(value);

  if (!clean) {
    return { dockIndex: null, isTampon: false };
  }

  if (clean === "TAMPON" || clean === "PORTETAMPON") {
    return { dockIndex: null, isTampon: true };
  }

  const match = clean.match(/^(?:PORTE)?(27|28|29|30|31)$/);
  if (match) {
    return { dockIndex: DOCK_NUMBERS.indexOf(Number(match[1])), isTampon: false };
  }

  return {
    dockIndex: null,
    isTampon: false,
    issue: `Porte souhaitee invalide: ${value}`
  };
}

function formatDoorLabel(dockIndex: number): string {
  return dockIndex === DOCK_COUNT ? "Tampon" : `Porte ${DOCK_NUMBERS[dockIndex]}`;
}

function buildFlux(row: Record<string, string>): string[] {
  const flux = [
    isMarked(readField(row, FIELD_ALIASES.sec)) ? "SEC" : "",
    isMarked(readField(row, FIELD_ALIASES.frais)) ? "FRAIS" : "",
    isMarked(readField(row, FIELD_ALIASES.surgele)) ? "SURGELE" : ""
  ].filter(Boolean);

  return flux.length ? flux : ["Standard"];
}

function buildVehicle(row: Record<string, string>): string {
  const vehicles = [
    isMarked(readField(row, FIELD_ALIASES.semi)) ? "SEMI" : "",
    isMarked(readField(row, FIELD_ALIASES.porteur)) ? "PORTEUR" : ""
  ].filter(Boolean);

  return vehicles.join(" + ") || "-";
}

function getArrivalBand(arrival: number | null): ArrivalBand {
  if (arrival === null) {
    return "missing";
  }

  if (arrival < 0) {
    return "before";
  }

  if (arrival > 24 * 60) {
    return "after";
  }

  return "main";
}

function getTruckStatus(
  arrivalBand: ArrivalBand,
  wait: number,
  dataIssues: string[]
): TruckStatus {
  if (dataIssues.some((issue) => issue.includes("Heure"))) {
    return "incomplet";
  }

  if (arrivalBand !== "main") {
    return "hors_plage";
  }

  if (wait === 0) {
    return "sans_attente";
  }

  return wait < 15 ? "attente_courte" : "attente_longue";
}

function indexOfEarliestDock(values: number[]): number {
  return values.reduce((earliestIndex, value, index) => {
    if (value < values[earliestIndex]) {
      return index;
    }

    return earliestIndex;
  }, 0);
}

function getSlotStatus(rate: number, backlogMinutes: number): SlotStatus {
  if (backlogMinutes > 0 && rate >= 0.9) {
    return "backlog";
  }

  if (rate >= 0.95) {
    return "sature";
  }

  if (rate >= 0.75) {
    return "sous_tension";
  }

  return "fluide";
}

function overlapMinutes(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function computeMaxQueueDepth(trucks: Truck[]): number {
  const events = trucks.flatMap((truck) => {
    if (
      truck.arrivalMinutes === null ||
      truck.miseAQuaiMinutes === null ||
      truck.miseAQuaiMinutes <= truck.arrivalMinutes
    ) {
      return [];
    }

    return [
      { minute: truck.arrivalMinutes, delta: 1 },
      { minute: truck.miseAQuaiMinutes, delta: -1 }
    ];
  });

  events.sort((a, b) => a.minute - b.minute || a.delta - b.delta);

  let current = 0;
  let max = 0;
  events.forEach((event) => {
    current += event.delta;
    max = Math.max(max, current);
  });

  return max;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
