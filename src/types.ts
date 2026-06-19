export type ArrivalBand = "before" | "main" | "after" | "missing";

export type TruckStatus =
  | "sans_attente"
  | "attente_courte"
  | "attente_longue"
  | "incomplet"
  | "hors_plage";

export type Truck = {
  id: string;
  sourceIndex: number;
  date: string;
  dateLabel: string;
  cle: string;
  compteur_local: string;
  code_voyage: string;
  nom_ramasse: string;
  heure_arrivee: string;
  arrivalMinutes: number | null;
  nb_palettes: number | null;
  type_flux: string;
  flux: string[];
  type_vehicule: string;
  temps_dechargement_minutes: number;
  durationEstimated: boolean;
  creneau_horaire: string;
  porte_souhaitee: string;
  porteForcee: number | null;
  porteTampon: boolean;
  prioriteQuai: boolean;
  porte_affectee: string | null;
  dockIndex: number | null;
  heure_mise_a_quai: string | null;
  miseAQuaiMinutes: number | null;
  heure_fin_dechargement: string | null;
  finDechargementMinutes: number | null;
  temps_attente: number | null;
  statut: TruckStatus;
  arrivalBand: ArrivalBand;
  dataIssues: string[];
};

export type SlotStatus = "fluide" | "sous_tension" | "sature" | "backlog";

export type SlotAnalysis = {
  label: string;
  start: number;
  end: number;
  arrivals: number;
  totalUnloadMinutes: number;
  occupiedMinutes: number;
  capacityMinutes: number;
  occupancyRate: number;
  backlogMinutes: number;
  waitingTrucks: number;
  status: SlotStatus;
};

export type KpiSet = {
  totalTrucks: number;
  trucksInWindow: number;
  trucksBefore: number;
  trucksAfter: number;
  trucksWithoutWait: number;
  trucksWithWait: number;
  averageWait: number;
  maxWait: number;
  globalOccupancyRate: number;
  busiestSlot: string;
  incompleteData: number;
  estimatedDurations: number;
};

export type OperationAlert = {
  id: string;
  level: "info" | "warning" | "critical";
  title: string;
  detail: string;
};

export type RoadmapResponse = {
  generatedAt: string;
  source: {
    sheetId: string;
    mode: "google-sheets-api" | "public-csv";
  };
  dates: string[];
  trucks: Truck[];
  errors: string[];
};

export type Filters = {
  date: string;
  code: string;
  ramasse: string;
  status: "all" | TruckStatus;
  flux: "all" | string;
};
