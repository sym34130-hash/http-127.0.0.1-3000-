"use client";

import {
  Activity,
  AlertTriangle,
  BookOpen,
  CalendarDays,
  ChartColumnBig,
  Clock,
  DoorOpen,
  ExternalLink,
  FileSpreadsheet,
  LayoutDashboard,
  Map as MapIcon,
  RefreshCw,
  Rows3,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  TimerReset,
  Truck as TruckIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import clsx from "clsx";
import {
  DOCK_COUNT,
  DEFAULT_OPERATION_WINDOW,
  OPERATION_WINDOWS,
  SLOT_CAPACITY,
  SLOT_MINUTES,
  applyFilters,
  computeAlerts,
  computeKpis,
  computeSlots,
  filterTrucksByOperationWindow,
  formatDateFr,
  formatDuration,
  formatMinutes,
  formatOperationWindow,
  getOperationalMinute,
  getOperationWindow,
  getTodayInParis,
  slotStatusLabel,
  statusLabel,
  uniqueFlux
} from "@/lib/planning";
import type { OperationWindow, OperationWindowId } from "@/lib/planning";
import type { Filters, KpiSet, OperationAlert, RoadmapResponse, SlotAnalysis, Truck } from "@/types";

type ViewMode = "simple" | "decision";
type LoadState = "idle" | "loading" | "ready" | "error";
type AlertGroups = {
  active: OperationAlert[];
  history: OperationAlert[];
};
type DecisionLevel = "ok" | "warning" | "critical";
type DecisionStatus = {
  action: string;
  detail: string;
  level: DecisionLevel;
  title: string;
};
type DateGroup = {
  dates: string[];
  label: string;
  weekStart: string;
};

const TIMELINE_WIDTH = 1080;
const HOUR_PIXEL_WIDTH = 120;
const BLOCK_HEIGHT = 64;
const LANE_GAP = 8;
const LEFT_LABEL_WIDTH = 132;
const REFRESH_MS = 30_000;
const GUIDE_URL = "/guide-utilisation-roadmap-quai.html";
const GOOGLE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1kxVKlwjMyM619Rg1WdqzvxwQ0pT-b-FIv651C_oWwkg/edit?usp=sharing";

const DEFAULT_FILTERS: Filters = {
  date: "",
  code: "",
  ramasse: "",
  status: "all",
  flux: "all"
};

export default function Page() {
  const [data, setData] = useState<RoadmapResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [operationWindowId, setOperationWindowId] = useState<OperationWindowId>(DEFAULT_OPERATION_WINDOW.id);
  const [viewMode, setViewMode] = useState<ViewMode>("decision");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string>("");
  const [nowMinute, setNowMinute] = useState(DEFAULT_OPERATION_WINDOW.start);
  const hasLoadedDataRef = useRef(false);
  const selectedDate = filters.date || data?.dates[0] || "";
  const operationWindow = useMemo(() => getOperationWindow(operationWindowId), [operationWindowId]);

  const loadData = useCallback(async () => {
    setLoadState("loading");
    setError("");

    try {
      const response = await fetch("/api/roadmap", { cache: "no-store" });
      const payload = (await response.json()) as RoadmapResponse;

      if (!response.ok) {
        throw new Error(payload.errors?.[0] ?? "Chargement impossible");
      }

      setData(payload);
      hasLoadedDataRef.current = true;
      setLoadState("ready");
      setFilters((current) => {
        if (payload.dates.length === 0) {
          return current;
        }

        if (current.date && payload.dates.includes(current.date)) {
          return current;
        }

        return {
          ...current,
          date: chooseDefaultDate(payload.dates)
        };
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erreur inconnue");
      setLoadState(hasLoadedDataRef.current ? "ready" : "error");
    }
  }, []);

  useEffect(() => {
    void loadData();
    const timer = window.setInterval(() => void loadData(), REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    const refreshClock = () => setNowMinute(getOperationalMinute(selectedDate, operationWindow));

    refreshClock();
    const timer = window.setInterval(refreshClock, REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [operationWindow, selectedDate]);

  const scopedFilters = { ...filters, date: selectedDate };
  const filteredDateTrucks = useMemo(
    () => applyFilters(data?.trucks ?? [], scopedFilters),
    [data?.trucks, scopedFilters]
  );
  const dateTrucks = useMemo(
    () => (data?.trucks ?? []).filter((truck) => truck.date === selectedDate),
    [data?.trucks, selectedDate]
  );
  const visibleTrucks = useMemo(
    () => filterTrucksByOperationWindow(filteredDateTrucks, operationWindow),
    [filteredDateTrucks, operationWindow]
  );
  const periodDateTrucks = useMemo(
    () => filterTrucksByOperationWindow(dateTrucks, operationWindow),
    [dateTrucks, operationWindow]
  );
  const outsidePeriodCount = Math.max(0, filteredDateTrucks.length - visibleTrucks.length);
  const slots = useMemo(() => computeSlots(visibleTrucks, operationWindow), [operationWindow, visibleTrucks]);
  const kpis = useMemo(() => computeKpis(visibleTrucks, operationWindow), [operationWindow, visibleTrucks]);
  const alerts = useMemo(() => computeAlerts(visibleTrucks, slots), [visibleTrucks, slots]);
  const fluxOptions = useMemo(() => uniqueFlux(periodDateTrucks), [periodDateTrucks]);
  const weekSummary = useMemo(
    () => buildWeekSummary(data?.trucks ?? [], selectedDate),
    [data?.trucks, selectedDate]
  );
  const alertGroups = useMemo(
    () => splitOperationAlerts(alerts, nowMinute, visibleTrucks),
    [alerts, nowMinute, visibleTrucks]
  );
  const generatedAt = data?.generatedAt ? new Date(data.generatedAt) : null;

  return (
    <main className="min-h-screen bg-field text-ink">
      <TopBar
        generatedAt={generatedAt}
        isRefreshing={loadState === "loading"}
        onRefresh={loadData}
        sourceMode={data?.source.mode}
      />

      <section className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 lg:px-6">
          <FilterBar
            dates={data?.dates ?? []}
            filters={scopedFilters}
            fluxOptions={fluxOptions}
            onChange={setFilters}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted">
              <CalendarDays className="h-4 w-4" />
              <span>{selectedDate ? formatDateFr(selectedDate) : "Aucune date"}</span>
              <span className="text-line">|</span>
              <Clock className="h-4 w-4" />
              <span>Reference {formatMinutes(nowMinute)}</span>
              <span className="text-line">|</span>
              <span>{operationWindow.label} {formatOperationWindow(operationWindow)}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <OperationWindowToggle value={operationWindowId} onChange={setOperationWindowId} />
              <ViewToggle value={viewMode} onChange={setViewMode} />
            </div>
          </div>
        </div>
      </section>

      {loadState === "error" ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : (
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 lg:px-6">
          {error && data ? (
            <div className="flex items-center gap-2 border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span>Derniere synchronisation non aboutie. Les dernieres donnees valides restent affichees.</span>
              <span className="text-muted">{error}</span>
            </div>
          ) : null}

          {data?.errors?.length ? (
            <div className="flex items-center gap-2 border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span>{data.errors.join(" | ")}</span>
            </div>
          ) : null}

          <WeekNavigator
            days={weekSummary}
            onSelect={(date) => setFilters((current) => ({ ...current, date }))}
            selectedDate={selectedDate}
          />

          <KpiStrip kpis={kpis} outsidePeriodCount={outsidePeriodCount} />

          {viewMode === "simple" ? (
            <SimpleView
              alerts={alertGroups.active}
              allFilteredTrucks={filteredDateTrucks}
              kpis={kpis}
              nowMinute={nowMinute}
              operationWindow={operationWindow}
              selectedDate={selectedDate}
              trucks={visibleTrucks}
            />
          ) : (
            <DecisionView
              activeAlerts={alertGroups.active}
              historicalAlerts={alertGroups.history}
              nowMinute={nowMinute}
              operationWindow={operationWindow}
              selectedDate={selectedDate}
              slots={slots}
              trucks={visibleTrucks}
            />
          )}
        </div>
      )}
    </main>
  );
}

function TopBar({
  generatedAt,
  isRefreshing,
  onRefresh,
  sourceMode
}: {
  generatedAt: Date | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  sourceMode?: RoadmapResponse["source"]["mode"];
}) {
  return (
    <header className="border-b border-line bg-ink text-white">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-[82px] items-center justify-center border border-white/15 bg-[#0056a8] px-3 text-lg font-black tracking-wide text-white">
            STEF
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">Roadmap Quai</h1>
            <p className="flex items-center gap-1.5 text-sm text-white/70">
              <TruckIcon className="h-3.5 w-3.5" />
              <span>Pilotage 5 portes | Matin / Apres-midi / Journee</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-white/75">
          <a
            className="inline-flex h-9 items-center gap-2 border border-white/20 px-3 font-semibold text-white transition hover:bg-white/10"
            href={GUIDE_URL}
          >
            <BookOpen className="h-4 w-4" />
            <span>Guide d'utilisation</span>
          </a>
          <a
            className="inline-flex h-9 items-center gap-2 border border-success/60 bg-success px-3 font-semibold text-white transition hover:bg-success/90"
            href={GOOGLE_SHEET_URL}
            rel="noreferrer"
            target="_blank"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>Google Sheet</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <span className="inline-flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {sourceMode === "google-sheets-api" ? "Google Sheets API" : "CSV public Google Sheet"}
          </span>
          <span>
            MAJ {generatedAt ? generatedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "--:--"}
          </span>
          <button
            aria-label="Actualiser"
            className="inline-flex h-9 items-center gap-2 border border-white/20 px-3 text-white transition hover:bg-white/10"
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw className={clsx("h-4 w-4", isRefreshing && "animate-spin")} />
            <span>Actualiser</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function FilterBar({
  dates,
  filters,
  fluxOptions,
  onChange
}: {
  dates: string[];
  filters: Filters;
  fluxOptions: string[];
  onChange: (next: Filters | ((current: Filters) => Filters)) => void;
}) {
  const dateGroups = useMemo(() => groupDatesByWeek(dates), [dates]);

  const update = <Key extends keyof Filters>(key: Key, value: Filters[Key]) => {
    onChange((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[180px_1fr_1fr_190px_170px]">
      <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Jour
        <div className="relative">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <select
            className="h-10 w-full border border-line bg-white pl-9 pr-3 text-sm text-ink outline-none transition focus:border-ink"
            onChange={(event) => update("date", event.target.value)}
            value={filters.date}
          >
            {dates.length === 0 ? <option value="">Aucune date</option> : null}
            {dateGroups.map((group) => (
              <optgroup key={group.weekStart} label={group.label}>
                {group.dates.map((date) => (
                  <option key={date} value={date}>
                    {date === "sans-date" ? "Sans date" : formatDateFr(date)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </label>

      <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Code tournee
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="h-10 w-full border border-line bg-white pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-ink"
            onChange={(event) => update("code", event.target.value)}
            placeholder="LIGE00"
            value={filters.code}
          />
        </div>
      </label>

      <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Ramasse
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="h-10 w-full border border-line bg-white pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-ink"
            onChange={(event) => update("ramasse", event.target.value)}
            placeholder="Nom ramasse"
            value={filters.ramasse}
          />
        </div>
      </label>

      <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Statut
        <div className="relative">
          <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <select
            className="h-10 w-full border border-line bg-white pl-9 pr-3 text-sm text-ink outline-none transition focus:border-ink"
            onChange={(event) => update("status", event.target.value as Filters["status"])}
            value={filters.status}
          >
            <option value="all">Tous</option>
            <option value="sans_attente">{statusLabel("sans_attente")}</option>
            <option value="attente_courte">{statusLabel("attente_courte")}</option>
            <option value="attente_longue">{statusLabel("attente_longue")}</option>
            <option value="incomplet">{statusLabel("incomplet")}</option>
            <option value="hors_plage">{statusLabel("hors_plage")}</option>
          </select>
        </div>
      </label>

      <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Type flux
        <div className="relative">
          <Rows3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <select
            className="h-10 w-full border border-line bg-white pl-9 pr-3 text-sm text-ink outline-none transition focus:border-ink"
            onChange={(event) => update("flux", event.target.value)}
            value={filters.flux}
          >
            <option value="all">Tous</option>
            {fluxOptions.map((flux) => (
              <option key={flux} value={flux}>
                {flux}
              </option>
            ))}
          </select>
        </div>
      </label>
    </div>
  );
}

function OperationWindowToggle({
  onChange,
  value
}: {
  onChange: (windowId: OperationWindowId) => void;
  value: OperationWindowId;
}) {
  return (
    <div className="inline-flex border border-line bg-white p-1 shadow-toolbar">
      {OPERATION_WINDOWS.map((window) => (
        <button
          aria-pressed={value === window.id}
          className={clsx(
            "inline-flex h-9 items-center gap-2 px-3 text-sm font-semibold transition",
            value === window.id ? "bg-ink text-white" : "text-muted hover:bg-field hover:text-ink"
          )}
          key={window.id}
          onClick={() => onChange(window.id)}
          title={formatOperationWindow(window)}
          type="button"
        >
          <Clock className="h-4 w-4" />
          <span>{window.label}</span>
        </button>
      ))}
    </div>
  );
}

function ViewToggle({
  value,
  onChange
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="inline-flex border border-line bg-white p-1 shadow-toolbar">
      <button
        aria-pressed={value === "simple"}
        className={clsx(
          "inline-flex h-9 items-center gap-2 px-3 text-sm font-semibold transition",
          value === "simple" ? "bg-ink text-white" : "text-muted hover:bg-field hover:text-ink"
        )}
        onClick={() => onChange("simple")}
        type="button"
      >
        <MapIcon className="h-4 w-4" />
        Vue simple
      </button>
      <button
        aria-pressed={value === "decision"}
        className={clsx(
          "inline-flex h-9 items-center gap-2 px-3 text-sm font-semibold transition",
          value === "decision" ? "bg-ink text-white" : "text-muted hover:bg-field hover:text-ink"
        )}
        onClick={() => onChange("decision")}
        type="button"
      >
        <LayoutDashboard className="h-4 w-4" />
        Decision quai
      </button>
    </div>
  );
}

type DaySummary = {
  date: string;
  label: string;
  maxWait: number;
  occupancyRate: number;
  total: number;
  waiting: number;
};

function WeekNavigator({
  days,
  onSelect,
  selectedDate
}: {
  days: DaySummary[];
  onSelect: (date: string) => void;
  selectedDate: string;
}) {
  if (days.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-2 md:grid-cols-5">
      {days.map((day) => {
        const isSelected = day.date === selectedDate;
        const riskTone =
          day.maxWait >= 30 || day.occupancyRate > 0.9
            ? "border-danger"
            : day.maxWait >= 15 || day.occupancyRate >= 0.7
              ? "border-warning"
              : "border-success";

        return (
          <button
            className={clsx(
              "border bg-white px-3 py-3 text-left shadow-toolbar transition hover:border-ink",
              isSelected ? "border-ink ring-2 ring-ink/10" : riskTone
            )}
            key={day.date}
            onClick={() => onSelect(day.date)}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{day.label}</span>
              <span className="text-xs font-semibold text-muted">{formatDateFr(day.date)}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted">Camions</div>
                <div className="text-base font-semibold">{day.total}</div>
              </div>
              <div>
                <div className="text-muted">Attente</div>
                <div className="text-base font-semibold">{day.waiting}</div>
              </div>
              <div>
                <div className="text-muted">Max</div>
                <div className="text-base font-semibold">{formatDuration(day.maxWait)}</div>
              </div>
            </div>
          </button>
        );
      })}
    </section>
  );
}

function KpiStrip({ kpis, outsidePeriodCount }: { kpis: KpiSet; outsidePeriodCount: number }) {
  const items = [
    { label: "Total prevus", value: kpis.totalTrucks, icon: TruckIcon },
    { label: "En attente", value: kpis.trucksWithWait, icon: TimerReset },
    { label: "Attente max", value: formatDuration(kpis.maxWait), icon: ShieldAlert },
    { label: "Occupation", value: `${Math.round(kpis.globalOccupancyRate * 100)} %`, icon: Activity },
    { label: "Creneau charge", value: kpis.busiestSlot, icon: ChartColumnBig },
    { label: "Hors periode", value: outsidePeriodCount, icon: Clock },
    { label: "A corriger", value: kpis.incompleteData, icon: AlertTriangle }
  ];

  return (
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <div key={item.label} className="border border-line bg-white px-3 py-3">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <span>{item.label}</span>
              <Icon className="h-4 w-4" />
            </div>
            <div className="mt-2 truncate text-xl font-semibold text-ink">{item.value}</div>
          </div>
        );
      })}
    </section>
  );
}

function SimpleView({
  alerts,
  allFilteredTrucks,
  kpis,
  nowMinute,
  operationWindow,
  selectedDate,
  trucks
}: {
  alerts: OperationAlert[];
  allFilteredTrucks: Truck[];
  kpis: KpiSet;
  nowMinute: number;
  operationWindow: OperationWindow;
  selectedDate: string;
  trucks: Truck[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <GanttTimeline
          nowMinute={nowMinute}
          operationWindow={operationWindow}
          selectedDate={selectedDate}
          showHeatbar={false}
          trucks={trucks}
        />
      </div>

      <aside className="flex flex-col gap-4">
        <Legend />
        <CompactAlerts alerts={alerts} />
        <OutOfRangeSections operationWindow={operationWindow} trucks={allFilteredTrucks} />
        <CorrectionsPanel trucks={trucks} estimatedCount={kpis.estimatedDurations} />
      </aside>
    </div>
  );
}

function DecisionView({
  activeAlerts,
  historicalAlerts,
  nowMinute,
  operationWindow,
  selectedDate,
  slots,
  trucks
}: {
  activeAlerts: OperationAlert[];
  historicalAlerts: OperationAlert[];
  nowMinute: number;
  operationWindow: OperationWindow;
  selectedDate: string;
  slots: SlotAnalysis[];
  trucks: Truck[];
}) {
  const decisionStatus = useMemo(
    () => buildDecisionStatus(trucks, slots, activeAlerts, nowMinute),
    [activeAlerts, nowMinute, slots, trucks]
  );

  return (
    <div className="flex flex-col gap-4">
      <DecisionStatusBanner status={decisionStatus} />

      <FieldView alerts={activeAlerts} nowMinute={nowMinute} operationWindow={operationWindow} trucks={trucks} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <GanttTimeline
            nowMinute={nowMinute}
            operationWindow={operationWindow}
            selectedDate={selectedDate}
            showHeatbar
            trucks={trucks}
          />
        </div>

        <div className="flex flex-col gap-4">
          <AlertPanel alerts={activeAlerts} />
          <HistoricalAlertPanel alerts={historicalAlerts} />
          <CorrectionsPanel trucks={trucks} estimatedCount={trucks.filter((truck) => truck.durationEstimated).length} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_520px]">
        <SlotChart slots={slots} />
        <SlotTable slots={slots} />
      </div>
    </div>
  );
}

function GanttTimeline({
  nowMinute,
  operationWindow,
  selectedDate,
  showHeatbar,
  trucks
}: {
  nowMinute: number;
  operationWindow: OperationWindow;
  selectedDate: string;
  showHeatbar: boolean;
  trucks: Truck[];
}) {
  const timelineWidth = getTimelineWidth(operationWindow);
  const rows = useMemo(
    () => buildTimelineRows(trucks, operationWindow, timelineWidth),
    [operationWindow, timelineWidth, trucks]
  );
  const slots = useMemo(() => computeSlots(trucks, operationWindow), [operationWindow, trucks]);
  const isToday = selectedDate === getTodayInParis();
  const isNowInWindow = nowMinute >= operationWindow.start && nowMinute < operationWindow.end;
  const nowLeft =
    ((nowMinute - operationWindow.start) / (operationWindow.end - operationWindow.start)) * timelineWidth;

  return (
    <section className="quai-map-frame min-w-0 overflow-hidden border border-line bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-muted" />
          <h2 className="text-base font-semibold">Map quai {formatOperationWindow(operationWindow)}</h2>
        </div>
        <div className="hidden items-center gap-3 text-xs text-muted md:flex">
          <span>5 portes</span>
          <span>|</span>
          <span>{operationWindow.label}</span>
          <span>|</span>
          <span>Auto-refresh 30s</span>
        </div>
      </div>

      <div className="quai-map-frame scrollbar-thin max-w-full overflow-x-auto">
        <div className="w-max min-w-full">
          <div className="flex border-b border-line bg-field">
            <div style={{ width: LEFT_LABEL_WIDTH }} />
            <div className="relative h-14" style={{ width: timelineWidth }}>
              <TimeAxis operationWindow={operationWindow} />
              {showHeatbar ? <Heatbar slots={slots} /> : null}
            </div>
          </div>

          <div className="relative">
            {isToday && isNowInWindow ? (
              <div
                className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-ink"
                style={{ left: LEFT_LABEL_WIDTH + nowLeft }}
              >
                <span className="absolute -left-8 top-1 bg-ink px-2 py-1 text-[10px] font-semibold text-white">
                  {formatMinutes(nowMinute)}
                </span>
              </div>
            ) : null}

            {rows.map((row) => (
              <div key={row.key} className="flex border-b border-line last:border-b-0">
                <div
                  className={clsx(
                    "flex shrink-0 items-start border-r border-line px-3 py-3 text-sm font-semibold",
                    "bg-white text-ink"
                  )}
                  style={{ width: LEFT_LABEL_WIDTH, minHeight: row.height }}
                >
                  {row.label}
                </div>
                <div
                  className="gantt-grid relative bg-white"
                  style={{ width: timelineWidth, height: row.height }}
                >
                  {row.items.map((item) => (
                    <TruckBlock
                      isToday={isToday}
                      item={item}
                      key={`${item.kind}-${item.truck.id}-${item.lane}`}
                      nowMinute={nowMinute}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TimeAxis({ operationWindow }: { operationWindow: OperationWindow }) {
  const hours = buildAxisMinutes(operationWindow, 60);
  const halfHours = buildAxisMinutes(operationWindow, 30);

  return (
    <>
      {halfHours.map((minute) => {
        const left = ((minute - operationWindow.start) / (operationWindow.end - operationWindow.start)) * 100;
        return (
          <div
            className="absolute top-8 h-3 border-l border-muted/30"
            key={`half-${minute}`}
            style={{ left: `${left}%` }}
          />
        );
      })}
      {hours.map((minute) => {
        const left = ((minute - operationWindow.start) / (operationWindow.end - operationWindow.start)) * 100;
        return (
          <div
            className="absolute top-2 -translate-x-1/2 text-xs font-semibold text-muted"
            key={minute}
            style={{ left: `${left}%` }}
          >
            {formatMinutes(minute)}
          </div>
        );
      })}
    </>
  );
}

function Heatbar({ slots }: { slots: SlotAnalysis[] }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 flex h-2">
      {slots.map((slot) => (
        <div
          className={clsx("h-2", slotColor(slot.status))}
          key={slot.label}
          style={{ width: `${100 / slots.length}%` }}
          title={`${slot.label} | ${Math.round(slot.occupancyRate * 100)} % d'occupation reelle`}
        />
      ))}
    </div>
  );
}

function TruckBlock({
  isToday,
  item,
  nowMinute
}: {
  isToday: boolean;
  item: TimelineItem;
  nowMinute: number;
}) {
  const truck = item.truck;
  const done = isToday && truck.finDechargementMinutes !== null && truck.finDechargementMinutes <= nowMinute;
  const palette = getTruckPalette(truck, done);
  const wait = truck.temps_attente ?? 0;
  const visibleDockStart = Math.min(
    item.end,
    Math.max(item.start, truck.miseAQuaiMinutes ?? item.start)
  );
  const waitRatio =
    item.end > item.start && wait > 0 ? (visibleDockStart - item.start) / (item.end - item.start) : 0;
  const waitWidth = Math.max(0, Math.min(item.width, Math.round(item.width * waitRatio)));
  const waitTone = wait >= 15 ? "rgba(217, 72, 72, 0.22)" : "rgba(216, 133, 34, 0.22)";
  const title = [
    `${truck.code_voyage} | ${truck.nom_ramasse}`,
    `Arrivee ${truck.heure_arrivee || "-"}`,
    `Quai ${truck.heure_mise_a_quai || "-"}`,
    `Fin ${truck.heure_fin_dechargement || "-"}`,
    `Dechargement ${formatDuration(truck.temps_dechargement_minutes)}`,
    `Palettes ${truck.nb_palettes ?? "-"}`,
    `Compteur ${truck.compteur_local || "-"}`,
    `Flux ${truck.type_flux}`,
    truck.porte_souhaitee ? `Porte souhaitee ${truck.porte_souhaitee}` : "",
    truck.prioriteQuai ? "Priorite quai" : "",
    `Attente ${formatDuration(wait)}`
  ].filter(Boolean).join("\n");

  return (
    <div
      className={clsx(
        "absolute overflow-hidden border px-2 py-1 text-[11px] shadow-sm",
        palette.className
      )}
      style={{
        left: item.left,
        top: 10 + item.lane * (BLOCK_HEIGHT + LANE_GAP),
        width: item.width,
        height: BLOCK_HEIGHT
      }}
      title={title}
    >
      {waitWidth > 0 ? (
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-0 top-0 border-r border-dashed border-ink/30"
          style={{
            width: waitWidth,
            backgroundImage: `repeating-linear-gradient(135deg, ${waitTone} 0 6px, transparent 6px 12px)`
          }}
        />
      ) : null}
      <div className="relative z-10 flex items-center justify-between gap-1">
        <strong className="truncate text-xs">{truck.code_voyage}</strong>
        <div className="flex shrink-0 items-center gap-1">
          {truck.prioriteQuai ? (
            <span className="bg-ink px-1 text-[10px] font-semibold text-white">PRIO</span>
          ) : null}
          {truck.porteTampon ? (
            <span className="bg-warning px-1 text-[10px] font-semibold text-white">TAMPON</span>
          ) : null}
          {truck.compteur_local ? (
            <span className="bg-white/55 px-1 text-[10px] font-semibold">#{truck.compteur_local}</span>
          ) : null}
        </div>
      </div>
      <div className="relative z-10 mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5 leading-tight">
        <span className="truncate">Arr. {truck.heure_arrivee || "-"}</span>
        <span className="truncate">Quai {truck.heure_mise_a_quai || "-"}</span>
        <span className="truncate">{formatDuration(truck.temps_dechargement_minutes)}</span>
        <span className="truncate">{truck.nb_palettes ?? "-"} pal.</span>
      </div>
      <div className="relative z-10 mt-1 truncate text-[10px] opacity-90">
        {wait > 0 ? `Attente ${formatDuration(wait)} | ${truck.nom_ramasse}` : truck.nom_ramasse}
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    { label: "Sans attente", className: "bg-success" },
    { label: "Attente < 15 min", className: "bg-warning" },
    { label: "Attente >= 15 min", className: "bg-danger" },
    { label: "Priorite quai", className: "bg-ink/20" },
    { label: "Porte Tampon", className: "bg-warning/30" },
    { label: "Zone hachuree = attente integree", className: "bg-warning/30" },
    { label: "Termine", className: "bg-done" },
    { label: "Incomplet", className: "bg-muted" }
  ];

  return (
    <section className="border border-line bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Code couleur</h2>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {items.map((item) => (
          <div className="flex items-center gap-2 text-sm" key={item.label}>
            <span className={clsx("h-3 w-6", item.className)} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CompactAlerts({ alerts }: { alerts: OperationAlert[] }) {
  return (
    <section className="border border-line bg-white p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        <AlertTriangle className="h-4 w-4" />
        Alertes
      </h2>
      {alerts.length === 0 ? (
        <p className="text-sm text-muted">Aucune alerte active.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.slice(0, 5).map((alert) => (
            <div className={clsx("border-l-4 bg-field px-3 py-2", alertBorder(alert.level))} key={alert.id}>
              <div className="text-sm font-semibold">{alert.title}</div>
              <div className="text-xs text-muted">{alert.detail}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AlertPanel({ alerts }: { alerts: OperationAlert[] }) {
  return (
    <section className="border border-line bg-white">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <AlertTriangle className="h-5 w-5 text-warning" />
        <h2 className="text-base font-semibold">Risques actifs et a venir</h2>
      </div>
      <div className="grid gap-2 p-4">
        {alerts.length === 0 ? (
          <div className="border border-line bg-field px-3 py-3 text-sm text-muted">
            Aucun risque actif ou a venir.
          </div>
        ) : (
          alerts.map((alert) => (
            <div
              className={clsx("border-l-4 bg-field px-3 py-3", alertBorder(alert.level))}
              key={alert.id}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{alert.title}</span>
                <span className={clsx("px-2 py-1 text-xs font-semibold uppercase", alertBadge(alert.level))}>
                  {alert.level}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">{alert.detail}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function HistoricalAlertPanel({ alerts }: { alerts: OperationAlert[] }) {
  return (
    <section className="border border-line bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted" />
          <h2 className="text-base font-semibold">Historique tensions</h2>
        </div>
        <span className="text-sm font-semibold text-muted">{alerts.length}</span>
      </div>
      <div className="grid gap-2 p-4">
        {alerts.length === 0 ? (
          <div className="border border-line bg-field px-3 py-3 text-sm text-muted">Aucune tension passee.</div>
        ) : (
          alerts.slice(0, 5).map((alert) => (
            <div className="border-l-4 border-muted bg-field px-3 py-2" key={`history-${alert.id}`}>
              <div className="text-sm font-semibold">{alert.title}</div>
              <div className="text-xs text-muted">{alert.detail}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function OutOfRangeSections({
  operationWindow,
  trucks
}: {
  operationWindow: OperationWindow;
  trucks: Truck[];
}) {
  const before = trucks.filter(
    (truck) => truck.arrivalMinutes !== null && truck.arrivalMinutes < operationWindow.start
  );
  const after = trucks.filter(
    (truck) => truck.arrivalMinutes !== null && truck.arrivalMinutes >= operationWindow.end
  );

  return (
    <section className="border border-line bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Hors periode</h2>
      <OutOfRangeList label={`Avant ${formatMinutes(operationWindow.start)}`} trucks={before} />
      <div className="mt-4">
        <OutOfRangeList label={`Apres ${formatMinutes(operationWindow.end)}`} trucks={after} />
      </div>
    </section>
  );
}

function OutOfRangeList({ label, trucks }: { label: string; trucks: Truck[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm font-semibold">
        <span>{label}</span>
        <span className="text-muted">{trucks.length}</span>
      </div>
      {trucks.length === 0 ? (
        <p className="text-sm text-muted">Aucun camion.</p>
      ) : (
        <div className="max-h-48 overflow-y-auto border border-line">
          {trucks.map((truck) => (
            <div className="border-b border-line px-3 py-2 text-sm last:border-b-0" key={truck.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{truck.code_voyage}</span>
                <span className="text-muted">{truck.heure_arrivee}</span>
              </div>
              <div className="truncate text-xs text-muted">{truck.nom_ramasse}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CorrectionsPanel({
  estimatedCount,
  trucks
}: {
  estimatedCount: number;
  trucks: Truck[];
}) {
  const corrections = trucks.filter((truck) => truck.dataIssues.length > 0);

  return (
    <section className="border border-line bg-white p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        <ShieldAlert className="h-4 w-4" />
        Donnees a corriger
      </h2>
      <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
        <div className="border border-line bg-field px-3 py-2">
          <div className="text-xs text-muted">Lignes</div>
          <div className="text-lg font-semibold">{corrections.length}</div>
        </div>
        <div className="border border-line bg-field px-3 py-2">
          <div className="text-xs text-muted">Temps estimes</div>
          <div className="text-lg font-semibold">{estimatedCount}</div>
        </div>
      </div>
      {corrections.length === 0 ? (
        <p className="text-sm text-muted">Aucune correction.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto border border-line">
          {corrections.map((truck) => (
            <div className="border-b border-line px-3 py-2 text-sm last:border-b-0" key={truck.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{truck.code_voyage}</span>
                <span className="text-xs text-muted">{truck.compteur_local || "-"}</span>
              </div>
              <div className="mt-1 text-xs text-danger">{truck.dataIssues.join(" | ")}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FieldView({
  alerts,
  nowMinute,
  operationWindow,
  trucks
}: {
  alerts: OperationAlert[];
  nowMinute: number;
  operationWindow: OperationWindow;
  trucks: Truck[];
}) {
  const nextWindowEnd = Math.min(nowMinute + SLOT_MINUTES, operationWindow.end);
  const current = trucks.filter(
    (truck) =>
      truck.miseAQuaiMinutes !== null &&
      truck.finDechargementMinutes !== null &&
      truck.miseAQuaiMinutes <= nowMinute &&
      truck.finDechargementMinutes > nowMinute
  );
  const next = trucks.filter(
    (truck) =>
      truck.arrivalMinutes !== null &&
      truck.arrivalMinutes >= nowMinute &&
      truck.arrivalMinutes < nextWindowEnd
  );
  const nextExpected = trucks
    .filter((truck) => truck.arrivalMinutes !== null && truck.arrivalMinutes >= nowMinute)
    .sort((a, b) => (a.arrivalMinutes ?? 0) - (b.arrivalMinutes ?? 0))[0];
  const occupiedDoors = new Set(current.map((truck) => truck.dockIndex).filter((dock) => dock !== null)).size;
  const availableDoors = Math.max(0, DOCK_COUNT - occupiedDoors);
  const waitingNow = trucks.filter(
    (truck) =>
      truck.arrivalMinutes !== null &&
      truck.miseAQuaiMinutes !== null &&
      truck.arrivalMinutes <= nowMinute &&
      truck.miseAQuaiMinutes > nowMinute
  );
  const nextPalettes = next.reduce((sum, truck) => sum + (truck.nb_palettes ?? 0), 0);
  const criticalAlerts = alerts.filter((alert) => alert.level !== "info");

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <div className="border border-line bg-white">
        <PanelTitle icon={DoorOpen} title="Maintenant" value={formatMinutes(nowMinute)} />
        <div className="space-y-3 p-4">
          <FieldMetric label="Camions en cours" value={current.length} />
          <FieldMetric label="Portes occupees" value={`${occupiedDoors}/${DOCK_COUNT}`} />
          <FieldMetric
            label="Prochain attendu"
            value={nextExpected ? `${nextExpected.code_voyage} ${nextExpected.heure_arrivee}` : "-"}
          />
          <MiniTruckList
            emptyLabel="Aucun camion en cours."
            trucks={current}
            renderMeta={(truck) =>
              `${truck.porte_affectee ?? "-"} | reste ${formatDuration((truck.finDechargementMinutes ?? nowMinute) - nowMinute)}`
            }
          />
        </div>
      </div>

      <div className="border border-line bg-white">
        <PanelTitle icon={Clock} title="Prochaines 30 minutes" value={`${next.length} arrivee(s)`} />
        <div className="space-y-3 p-4">
          <FieldMetric label="Portes disponibles" value={availableDoors} />
          <FieldMetric label="Volume palettes" value={nextPalettes} />
          <FieldMetric
            label="Risque attente"
            value={next.some((truck) => (truck.temps_attente ?? 0) > 0) ? "Oui" : "Non"}
          />
          <MiniTruckList
            emptyLabel="Aucune arrivee."
            trucks={next}
            renderMeta={(truck) =>
              `${truck.heure_arrivee} | ${truck.nb_palettes ?? "-"} pal. | quai ${truck.heure_mise_a_quai ?? "-"}`
            }
          />
        </div>
      </div>

      <div className="border border-line bg-white">
        <PanelTitle icon={AlertTriangle} title="Risques" value={`${criticalAlerts.length} alerte(s)`} />
        <div className="space-y-3 p-4">
          <FieldMetric label="Camions en attente" value={waitingNow.length} />
          <FieldMetric
            label="Creneaux critiques"
            value={criticalAlerts.filter((alert) => /Saturation|Attente quai|Backlog|Pic/.test(alert.title)).length}
          />
          <FieldMetric
            label="Donnees a corriger"
            value={alerts.some((alert) => alert.id === "missing-data") ? "Oui" : "Non"}
          />
          <div>
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              <span>En attente maintenant</span>
              <span className="text-muted">{waitingNow.length}</span>
            </div>
            <MiniTruckList
              emptyLabel="Aucun camion en attente."
              trucks={waitingNow}
              renderMeta={(truck) =>
                `Arr. ${truck.heure_arrivee || "-"} | quai ${truck.heure_mise_a_quai ?? "-"} | attente ${formatDuration(
                  Math.max(0, nowMinute - (truck.arrivalMinutes ?? nowMinute))
                )}`
              }
            />
          </div>
          <div className="max-h-40 overflow-y-auto border border-line">
            {criticalAlerts.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted">Aucun risque actif.</p>
            ) : (
              criticalAlerts.slice(0, 4).map((alert) => (
                <div className="border-b border-line px-3 py-2 text-sm last:border-b-0" key={alert.id}>
                  <div className="font-semibold">{alert.title}</div>
                  <div className="text-xs text-muted">{alert.detail}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function DecisionStatusBanner({ status }: { status: DecisionStatus }) {
  const tone = decisionTone(status.level);

  return (
    <section className={clsx("border px-4 py-4", tone.container)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={clsx("h-3 w-3", tone.dot)} />
            <h2 className="text-lg font-semibold">{status.title}</h2>
          </div>
          <p className="mt-1 text-sm text-muted">{status.detail}</p>
        </div>
        <div className={clsx("border px-3 py-2 text-sm font-semibold", tone.action)}>
          {status.action}
        </div>
      </div>
    </section>
  );
}

function PanelTitle({
  icon: Icon,
  title,
  value
}: {
  icon: typeof DoorOpen;
  title: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-muted" />
        <h2 className="font-semibold">{title}</h2>
      </div>
      <span className="text-sm font-semibold text-muted">{value}</span>
    </div>
  );
}

function FieldMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-4 border border-line bg-field px-3 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function MiniTruckList({
  emptyLabel,
  renderMeta,
  trucks
}: {
  emptyLabel: string;
  renderMeta: (truck: Truck) => string;
  trucks: Truck[];
}) {
  return (
    <div className="max-h-40 overflow-y-auto border border-line">
      {trucks.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted">{emptyLabel}</p>
      ) : (
        trucks.slice(0, 6).map((truck) => (
          <div className="border-b border-line px-3 py-2 text-sm last:border-b-0" key={truck.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{truck.code_voyage}</span>
              <span className="text-xs text-muted">{truck.type_flux}</span>
            </div>
            <div className="truncate text-xs text-muted">{renderMeta(truck)}</div>
          </div>
        ))
      )}
    </div>
  );
}

function SlotChart({ slots }: { slots: SlotAnalysis[] }) {
  const chartFrameRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ height: 0, width: 0 });
  const chartWidth = Math.max(320, chartSize.width - 32);
  const chartHeight = Math.max(260, chartSize.height - 32);
  const data = slots.map((slot) => ({
    label: slot.label.replace(" - ", "\n"),
    arrivals: slot.arrivals,
    occupation: Math.round(slot.occupancyRate * 100),
    attente: Math.round(slot.backlogMinutes),
    status: slot.status
  }));

  useEffect(() => {
    const frame = chartFrameRef.current;

    if (!frame) {
      return;
    }

    const refreshSize = () => {
      const rect = frame.getBoundingClientRect();

      const nextSize = {
        height: Math.floor(rect.height),
        width: Math.floor(rect.width)
      };

      setChartSize((current) =>
        current.height === nextSize.height && current.width === nextSize.width ? current : nextSize
      );
    };

    refreshSize();
    const observer = new ResizeObserver(refreshSize);
    observer.observe(frame);

    return () => observer.disconnect();
  }, []);

  const isChartReady = chartSize.width > 0 && chartSize.height > 0;

  return (
    <section className="border border-line bg-white">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <ChartColumnBig className="h-5 w-5 text-muted" />
        <h2 className="text-base font-semibold">Analyse par creneau</h2>
      </div>
      <div className="h-80 p-4" ref={chartFrameRef}>
        {isChartReady ? (
          <ComposedChart
            data={data}
            height={chartHeight}
            margin={{ left: -20, right: 8, top: 8, bottom: 8 }}
            width={chartWidth}
          >
            <CartesianGrid stroke="#d9e1ec" strokeDasharray="3 3" />
            <XAxis dataKey="label" fontSize={11} interval={0} tickLine={false} />
            <YAxis yAxisId="left" fontSize={11} tickLine={false} />
            <YAxis yAxisId="right" orientation="right" fontSize={11} tickLine={false} />
            <Tooltip />
            <Bar dataKey="occupation" name="Occupation reelle %" yAxisId="left">
              {data.map((entry) => (
                <Cell fill={slotHex(entry.status)} key={entry.label} />
              ))}
            </Bar>
            <Line dataKey="arrivals" name="Arrivees" stroke="#172033" strokeWidth={2} yAxisId="right" />
          </ComposedChart>
        ) : (
          <div className="flex h-full items-center justify-center border border-line bg-field text-sm text-muted">
            Chargement du graphique...
          </div>
        )}
      </div>
    </section>
  );
}

function SlotTable({ slots }: { slots: SlotAnalysis[] }) {
  const referenceCapacity = slots[0]?.capacityMinutes ?? SLOT_CAPACITY;

  return (
    <section className="border border-line bg-white">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Rows3 className="h-5 w-5 text-muted" />
          <h2 className="text-base font-semibold">Capacite par 30 min</h2>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="border border-line bg-field px-3 py-2 text-right">
            <div className="font-semibold text-ink">{DOCK_COUNT}</div>
            <div className="text-muted">portes</div>
          </div>
          <div className="border border-line bg-field px-3 py-2 text-right">
            <div className="font-semibold text-ink">{referenceCapacity}</div>
            <div className="text-muted">min max</div>
          </div>
          <div className="border border-line bg-field px-3 py-2 text-right">
            <div className="font-semibold text-ink">hors</div>
            <div className="text-muted">tampon</div>
          </div>
        </div>
      </div>
      <div className="scrollbar-thin max-h-80 overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="sticky top-0 bg-field text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="border-b border-line px-3 py-2 text-left">Creneau</th>
              <th className="border-b border-line px-3 py-2 text-right">Arr.</th>
              <th className="border-b border-line px-3 py-2 text-right">Charge arrivee</th>
              <th className="border-b border-line px-3 py-2 text-right">Occupation reelle</th>
              <th className="border-b border-line px-3 py-2 text-right">Taux occ.</th>
              <th className="border-b border-line px-3 py-2 text-right">Attente cumulee</th>
              <th className="border-b border-line px-3 py-2 text-left">Etat</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr className="border-b border-line last:border-b-0" key={slot.label}>
                <td className="px-3 py-2 font-semibold">{slot.label}</td>
                <td className="px-3 py-2 text-right">{slot.arrivals}</td>
                <td className="px-3 py-2 text-right">{Math.round(slot.totalUnloadMinutes)} min</td>
                <td className="px-3 py-2 text-right">{Math.round(slot.occupiedMinutes)} min</td>
                <td className="px-3 py-2 text-right">{Math.round(slot.occupancyRate * 100)} %</td>
                <td className="px-3 py-2 text-right">{Math.round(slot.backlogMinutes)} min</td>
                <td className="px-3 py-2">
                  <span className={clsx("px-2 py-1 text-xs font-semibold", slotBadge(slot.status))}>
                    {slotStatusLabel(slot.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="mx-auto max-w-2xl px-4 py-16">
      <div className="border border-danger/40 bg-white p-6 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-danger" />
        <h2 className="mt-3 text-lg font-semibold">Chargement impossible</h2>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <button
          className="mt-4 inline-flex h-10 items-center gap-2 bg-ink px-4 text-sm font-semibold text-white"
          onClick={onRetry}
          type="button"
        >
          <RefreshCw className="h-4 w-4" />
          Reessayer
        </button>
      </div>
    </section>
  );
}

type TimelineItem = {
  end: number;
  kind: "truck";
  lane: number;
  left: number;
  rowKey: string;
  start: number;
  truck: Truck;
  width: number;
};

type TimelineRow = {
  height: number;
  items: TimelineItem[];
  key: string;
  label: string;
};

function getTimelineWidth(operationWindow: OperationWindow): number {
  const hours = (operationWindow.end - operationWindow.start) / 60;
  return Math.max(TIMELINE_WIDTH, Math.round(hours * HOUR_PIXEL_WIDTH));
}

function buildAxisMinutes(operationWindow: OperationWindow, step: number): number[] {
  const minutes: number[] = [];

  for (let minute = operationWindow.start; minute <= operationWindow.end; minute += step) {
    minutes.push(minute);
  }

  if (minutes[minutes.length - 1] !== operationWindow.end) {
    minutes.push(operationWindow.end);
  }

  return minutes;
}

function buildTimelineRows(
  trucks: Truck[],
  operationWindow: OperationWindow,
  timelineWidth: number
): TimelineRow[] {
  const rowMap = new Map<string, TimelineItem[]>();
  Array.from({ length: DOCK_COUNT }, (_, index) => `dock-${index}`).forEach((key) => rowMap.set(key, []));
  rowMap.set("tampon", []);

  trucks.forEach((truck) => {
    if (truck.miseAQuaiMinutes !== null && truck.finDechargementMinutes !== null && truck.dockIndex !== null) {
      const blockStart = Math.min(truck.arrivalMinutes ?? truck.miseAQuaiMinutes, truck.miseAQuaiMinutes);
      const start = Math.max(operationWindow.start, blockStart);
      const end = Math.min(operationWindow.end, truck.finDechargementMinutes);

      if (end > start) {
        const rowKey = truck.porteTampon ? "tampon" : `dock-${truck.dockIndex}`;
        rowMap.get(rowKey)?.push(createTimelineItem(truck, rowKey, start, end, operationWindow, timelineWidth));
      }
    }
  });

  const dockRows = Array.from({ length: DOCK_COUNT }, (_, index) =>
    buildTimelineRow(`dock-${index}`, `Porte ${index + 1}`, rowMap)
  );

  return [...dockRows, buildTimelineRow("tampon", "Tampon", rowMap)];
}

function chooseDefaultDate(dates: string[]): string {
  const validDates = dates.filter(isIsoDate);
  const today = getTodayInParis();
  const upcoming = validDates.find((date) => date >= today);

  if (validDates.includes(today)) {
    return today;
  }

  return upcoming ?? validDates[validDates.length - 1] ?? dates[0] ?? "";
}

function buildWeekSummary(trucks: Truck[], selectedDate: string): DaySummary[] {
  const byDate = new Map<string, Truck[]>();
  const selectedWeekStart = isIsoDate(selectedDate) ? getWeekStartIso(selectedDate) : "";

  trucks.forEach((truck) => {
    const dateTrucks = byDate.get(truck.date) ?? [];
    dateTrucks.push(truck);
    byDate.set(truck.date, dateTrucks);
  });

  return Array.from(byDate.entries())
    .filter(([date]) => {
      if (selectedDate === "sans-date") {
        return date === "sans-date";
      }

      return !selectedWeekStart || (isIsoDate(date) && getWeekStartIso(date) === selectedWeekStart);
    })
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, dayTrucks]) => {
      const kpis = computeKpis(dayTrucks);

      return {
        date,
        label: getWeekdayLabel(date),
        maxWait: kpis.maxWait,
        occupancyRate: kpis.globalOccupancyRate,
        total: kpis.totalTrucks,
        waiting: kpis.trucksWithWait
      };
    });
}

function groupDatesByWeek(dates: string[]): DateGroup[] {
  const groups = new Map<string, string[]>();
  const withoutDate: string[] = [];

  dates.forEach((date) => {
    if (!isIsoDate(date)) {
      withoutDate.push(date);
      return;
    }

    const weekStart = getWeekStartIso(date);
    const weekDates = groups.get(weekStart) ?? [];
    weekDates.push(date);
    groups.set(weekStart, weekDates);
  });

  const groupedDates = Array.from(groups.entries())
    .sort(([weekA], [weekB]) => weekA.localeCompare(weekB))
    .map(([weekStart, weekDates]) => ({
      weekStart,
      label: formatWeekLabel(weekStart),
      dates: weekDates.sort()
    }));

  return withoutDate.length
    ? [...groupedDates, { weekStart: "sans-date", label: "Sans date", dates: withoutDate }]
    : groupedDates;
}

function formatWeekLabel(weekStart: string): string {
  const weekEnd = addDays(weekStart, 6);
  return `Semaine du ${formatDateFr(weekStart)} au ${formatDateFr(weekEnd)}`;
}

function getWeekStartIso(date: string): string {
  const parsed = parseIsoDateUtc(date);
  const day = parsed.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  parsed.setUTCDate(parsed.getUTCDate() + delta);

  return toIsoDate(parsed);
}

function addDays(date: string, days: number): string {
  const parsed = parseIsoDateUtc(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);

  return toIsoDate(parsed);
}

function parseIsoDateUtc(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isIsoDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function splitOperationAlerts(alerts: OperationAlert[], nowMinute: number, trucks: Truck[]): AlertGroups {
  const waitingNow = buildWaitingNow(trucks, nowMinute).length;

  return alerts.reduce<AlertGroups>(
    (groups, alert) => {
      const slotWindow = extractAlertWindow(alert);
      if (slotWindow) {
        const target = slotWindow.end > nowMinute ? groups.active : groups.history;
        target.push(alert);
        return groups;
      }

      if (alert.id === "high-wait" || alert.id === "queue-critical") {
        const target = waitingNow > 0 ? groups.active : groups.history;
        target.push(alert);
        return groups;
      }

      groups.active.push(alert);
      return groups;
    },
    { active: [], history: [] }
  );
}

function buildDecisionStatus(
  trucks: Truck[],
  slots: SlotAnalysis[],
  activeAlerts: OperationAlert[],
  nowMinute: number
): DecisionStatus {
  const current = buildCurrentTrucks(trucks, nowMinute);
  const waitingNow = buildWaitingNow(trucks, nowMinute);
  const next = buildNextArrivals(trucks, nowMinute);
  const currentSlot = slots.find((slot) => slot.start <= nowMinute && slot.end > nowMinute);
  const criticalNow =
    waitingNow.length > 0 ||
    currentSlot?.status === "backlog" ||
    currentSlot?.status === "sature" ||
    activeAlerts.some((alert) => alert.level === "critical" && isAlertCurrent(alert, nowMinute));

  if (criticalNow) {
    return {
      action: waitingNow.length > 0 ? "Traiter les camions en attente" : "Surveiller les portes maintenant",
      detail: `${waitingNow.length} camion(s) en attente, ${current.length}/${DOCK_COUNT} porte(s) occupee(s), ${next.length} arrivee(s) dans 30 min.`,
      level: "critical",
      title: "Action requise"
    };
  }

  const warningSoon =
    next.some((truck) => (truck.temps_attente ?? 0) > 0) ||
    currentSlot?.status === "sous_tension" ||
    activeAlerts.some(
      (alert) =>
        (alert.level === "warning" || alert.level === "critical") &&
        isAlertInDecisionWindow(alert, nowMinute)
    );

  if (warningSoon) {
    return {
      action: "Anticiper le prochain creneau",
      detail: `${current.length}/${DOCK_COUNT} porte(s) occupee(s), ${next.length} arrivee(s) dans 30 min, aucun camion en attente maintenant.`,
      level: "warning",
      title: "Sous tension"
    };
  }

  return {
    action: "Aucune action immediate",
    detail: `${current.length}/${DOCK_COUNT} porte(s) occupee(s), ${next.length} arrivee(s) dans 30 min, aucun camion en attente.`,
    level: "ok",
    title: "Situation fluide"
  };
}

function buildCurrentTrucks(trucks: Truck[], nowMinute: number): Truck[] {
  return trucks.filter(
    (truck) =>
      truck.miseAQuaiMinutes !== null &&
      truck.finDechargementMinutes !== null &&
      truck.miseAQuaiMinutes <= nowMinute &&
      truck.finDechargementMinutes > nowMinute
  );
}

function buildWaitingNow(trucks: Truck[], nowMinute: number): Truck[] {
  return trucks.filter(
    (truck) =>
      truck.arrivalMinutes !== null &&
      truck.miseAQuaiMinutes !== null &&
      truck.arrivalMinutes <= nowMinute &&
      truck.miseAQuaiMinutes > nowMinute
  );
}

function buildNextArrivals(trucks: Truck[], nowMinute: number): Truck[] {
  return trucks.filter(
    (truck) =>
      truck.arrivalMinutes !== null &&
      truck.arrivalMinutes >= nowMinute &&
      truck.arrivalMinutes < nowMinute + SLOT_MINUTES
  );
}

function extractAlertWindow(alert: OperationAlert): { end: number; start: number } | null {
  const match = `${alert.id} ${alert.detail}`.match(/(\d{2})h(\d{2})\s*-\s*(\d{2})h(\d{2})/);
  if (!match) {
    return null;
  }

  const [, startHour, startMinute, endHour, endMinute] = match;
  return {
    start: Number(startHour) * 60 + Number(startMinute),
    end: Number(endHour) * 60 + Number(endMinute)
  };
}

function isAlertCurrent(alert: OperationAlert, nowMinute: number): boolean {
  const slotWindow = extractAlertWindow(alert);
  return !slotWindow || (slotWindow.start <= nowMinute && slotWindow.end > nowMinute);
}

function isAlertInDecisionWindow(alert: OperationAlert, nowMinute: number): boolean {
  const slotWindow = extractAlertWindow(alert);
  if (!slotWindow) {
    return alert.id === "missing-data";
  }

  return slotWindow.end > nowMinute && slotWindow.start < nowMinute + SLOT_MINUTES;
}

function getWeekdayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long"
  }).format(parsed);
}

function buildTimelineRow(labelKey: string, label: string, rowMap: Map<string, TimelineItem[]>): TimelineRow {
  const items = assignVisualLanes(rowMap.get(labelKey) ?? []);
  const laneCount = items.reduce((max, item) => Math.max(max, item.lane + 1), 1);

  return {
    key: labelKey,
    label,
    items,
    height: Math.max(92, 20 + laneCount * (BLOCK_HEIGHT + LANE_GAP))
  };
}

function createTimelineItem(
  truck: Truck,
  rowKey: string,
  start: number,
  end: number,
  operationWindow: OperationWindow,
  timelineWidth: number
): TimelineItem {
  const left = ((start - operationWindow.start) / (operationWindow.end - operationWindow.start)) * timelineWidth;
  const rawWidth = ((end - start) / (operationWindow.end - operationWindow.start)) * timelineWidth;
  const minWidth = 150;
  const width = Math.min(timelineWidth, Math.max(rawWidth, minWidth));
  const adjustedLeft = Math.min(left, timelineWidth - width);

  return {
    end,
    kind: "truck",
    lane: 0,
    left: Math.max(0, adjustedLeft),
    rowKey,
    start,
    truck,
    width
  };
}

function assignVisualLanes(items: TimelineItem[]): TimelineItem[] {
  const lanes: number[] = [];

  return items
    .slice()
    .sort((a, b) => a.left - b.left || a.truck.sourceIndex - b.truck.sourceIndex)
    .map((item) => {
      const lane = lanes.findIndex((end) => end + 6 <= item.left);
      const nextLane = lane >= 0 ? lane : lanes.length;
      lanes[nextLane] = item.left + item.width;

      return { ...item, lane: nextLane };
    });
}

function getTruckPalette(truck: Truck, done: boolean) {
  if (truck.arrivalBand === "missing" || truck.statut === "incomplet") {
    return { className: "border-muted/50 bg-muted/15 text-ink" };
  }

  if (done) {
    return { className: "border-done/40 bg-done/15 text-ink" };
  }

  if (truck.porteTampon) {
    return { className: "border-warning/70 bg-warning/20 text-ink" };
  }

  if (truck.prioriteQuai) {
    return { className: "border-ink/70 bg-ink/10 text-ink" };
  }

  if (truck.statut === "attente_longue") {
    return { className: "border-danger/50 bg-danger/15 text-ink" };
  }

  if (truck.statut === "attente_courte") {
    return { className: "border-warning/60 bg-warning/15 text-ink" };
  }

  if (truck.statut === "hors_plage") {
    return { className: "border-muted/40 bg-muted/10 text-ink" };
  }

  return { className: "border-success/50 bg-success/15 text-ink" };
}

function slotColor(status: SlotAnalysis["status"]) {
  const classes: Record<SlotAnalysis["status"], string> = {
    fluide: "bg-success",
    sous_tension: "bg-warning",
    sature: "bg-danger",
    backlog: "bg-ink"
  };

  return classes[status];
}

function slotHex(status: SlotAnalysis["status"]) {
  const colors: Record<SlotAnalysis["status"], string> = {
    fluide: "#1f9d6b",
    sous_tension: "#d88522",
    sature: "#d94848",
    backlog: "#172033"
  };

  return colors[status];
}

function slotBadge(status: SlotAnalysis["status"]) {
  const classes: Record<SlotAnalysis["status"], string> = {
    fluide: "bg-success/10 text-success",
    sous_tension: "bg-warning/10 text-warning",
    sature: "bg-danger/10 text-danger",
    backlog: "bg-ink text-white"
  };

  return classes[status];
}

function decisionTone(level: DecisionLevel) {
  const tones: Record<
    DecisionLevel,
    {
      action: string;
      container: string;
      dot: string;
    }
  > = {
    ok: {
      action: "border-success/30 bg-success/10 text-success",
      container: "border-success/30 bg-success/5",
      dot: "bg-success"
    },
    warning: {
      action: "border-warning/30 bg-warning/10 text-warning",
      container: "border-warning/40 bg-warning/10",
      dot: "bg-warning"
    },
    critical: {
      action: "border-danger/30 bg-danger/10 text-danger",
      container: "border-danger/40 bg-danger/10",
      dot: "bg-danger"
    }
  };

  return tones[level];
}

function alertBorder(level: OperationAlert["level"]) {
  const classes: Record<OperationAlert["level"], string> = {
    info: "border-done",
    warning: "border-warning",
    critical: "border-danger"
  };

  return classes[level];
}

function alertBadge(level: OperationAlert["level"]) {
  const classes: Record<OperationAlert["level"], string> = {
    info: "bg-done/10 text-done",
    warning: "bg-warning/10 text-warning",
    critical: "bg-danger/10 text-danger"
  };

  return classes[level];
}
