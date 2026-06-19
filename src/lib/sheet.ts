import Papa from "papaparse";
import { normalizeRows } from "@/lib/planning";
import type { RoadmapResponse } from "@/types";

const DEFAULT_SHEET_ID = "1kxVKlwjMyM619Rg1WdqzvxwQ0pT-b-FIv651C_oWwkg";
const DEFAULT_WEEK_GIDS = ["0", "1518551151", "140536758", "1451860817", "1580103380"];

type GoogleValuesResponse = {
  values?: string[][];
};

type PublicSheetInfo = {
  gid: string;
  title: string;
};

type GoogleBatchValuesResponse = {
  valueRanges?: GoogleValuesResponse[];
};

type GoogleSpreadsheetMetadata = {
  sheets?: Array<{
    properties?: {
      hidden?: boolean;
      title?: string;
    };
  }>;
};

export async function loadRoadmapData(): Promise<RoadmapResponse> {
  const sheetId = process.env.GOOGLE_SHEET_ID || DEFAULT_SHEET_ID;
  const errors: string[] = [];
  const targetDates = getTargetDateSet();

  if (process.env.GOOGLE_SHEETS_API_KEY) {
    try {
      const rows = await fetchFromGoogleSheetsApi(sheetId);
      const trucks = filterTargetDates(normalizeRows(rows), targetDates);

      return {
        generatedAt: new Date().toISOString(),
        source: { sheetId, mode: "google-sheets-api" },
        dates: buildDates(trucks),
        trucks,
        errors
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Google Sheets API indisponible");
    }
  }

  const publicResult = await fetchFromPublicCsv(sheetId);
  errors.push(...publicResult.errors);
  const rows = publicResult.rows;
  const trucks = filterTargetDates(normalizeRows(rows), targetDates);

  return {
    generatedAt: new Date().toISOString(),
    source: { sheetId, mode: "public-csv" },
    dates: buildDates(trucks),
    trucks,
    errors
  };
}

async function fetchFromGoogleSheetsApi(sheetId: string): Promise<Record<string, string>[]> {
  const ranges = process.env.GOOGLE_SHEETS_RANGES
    ? process.env.GOOGLE_SHEETS_RANGES.split(",").map((range) => range.trim()).filter(Boolean)
    : await fetchSpreadsheetRanges(sheetId);
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet`);
  url.searchParams.set("key", process.env.GOOGLE_SHEETS_API_KEY ?? "");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");
  ranges.forEach((range) => url.searchParams.append("ranges", range));

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Google Sheets API: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as GoogleBatchValuesResponse;
  return (payload.valueRanges ?? []).flatMap((range) => matrixToRows(range.values ?? []));
}

async function fetchFromPublicCsv(
  sheetId: string
): Promise<{ errors: string[]; rows: Record<string, string>[] }> {
  const { errors, gids } = await getPublicGids(sheetId);
  const results = await Promise.allSettled(gids.map((gid) => fetchPublicCsvByGid(sheetId, gid)));
  const rows: Record<string, string>[] = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      rows.push(...result.value);
      return;
    }

    errors.push(
      result.reason instanceof Error
        ? result.reason.message
        : `Lecture impossible pour gid ${gids[index]}`
    );
  });

  if (rows.length === 0 && errors.length > 0) {
    throw new Error(errors.join(" | "));
  }

  return { errors, rows };
}

async function fetchPublicCsvByGid(
  sheetId: string,
  gid: string
): Promise<Record<string, string>[]> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`CSV Google Sheet gid ${gid}: ${response.status} ${response.statusText}`);
  }

  const csv = await response.text();
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: "greedy"
  });

  if (parsed.errors.length) {
    throw new Error(parsed.errors[0]?.message ?? "Lecture CSV impossible");
  }

  return parsed.data;
}

async function fetchSpreadsheetRanges(sheetId: string): Promise<string[]> {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`);
  url.searchParams.set("key", process.env.GOOGLE_SHEETS_API_KEY ?? "");
  url.searchParams.set("fields", "sheets.properties(title,hidden)");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Metadata Google Sheets: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as GoogleSpreadsheetMetadata;
  const titles = (payload.sheets ?? [])
    .map((sheet) => sheet.properties)
    .filter((properties): properties is { hidden?: boolean; title: string } =>
      Boolean(properties?.title && !properties.hidden)
    )
    .map((properties) => `'${properties.title.replace(/'/g, "''")}'!A:Z`);

  return titles.length ? titles : [process.env.GOOGLE_SHEETS_RANGE || "A:Z"];
}

function matrixToRows(values: string[][]): Record<string, string>[] {
  const [headers, ...rows] = values;
  if (!headers) {
    return [];
  }

  return rows.map((row) =>
    headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = row[index] ?? "";
      return record;
    }, {})
  );
}

function buildDates(trucks: { date: string }[]): string[] {
  return Array.from(new Set(trucks.map((truck) => truck.date))).sort();
}

async function getPublicGids(sheetId: string): Promise<{ errors: string[]; gids: string[] }> {
  const configured = process.env.GOOGLE_SHEET_GIDS?.split(",")
    .map((gid) => gid.trim())
    .filter(Boolean);

  if (configured?.length) {
    return { errors: [], gids: configured };
  }

  try {
    const discovered = await fetchPublicSheetInfos(sheetId);
    const operationalGids = discovered
      .filter((sheet) => isOperationalSheetTitle(sheet.title))
      .map((sheet) => sheet.gid);

    if (operationalGids.length) {
      return { errors: [], gids: operationalGids };
    }

    return {
      errors: ["Aucun onglet operationnel detecte automatiquement, lecture limitee aux onglets par defaut."],
      gids: DEFAULT_WEEK_GIDS
    };
  } catch (error) {
    return {
      errors: [
        error instanceof Error
          ? `Detection automatique des onglets impossible: ${error.message}`
          : "Detection automatique des onglets impossible."
      ],
      gids: DEFAULT_WEEK_GIDS
    };
  }
}

async function fetchPublicSheetInfos(sheetId: string): Promise<PublicSheetInfo[]> {
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/edit?usp=sharing`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return parsePublicSheetInfos(await response.text());
}

function parsePublicSheetInfos(html: string): PublicSheetInfo[] {
  const matches = html.matchAll(/\[\d+,0,\\"(\d+)\\",\[\{\\"1\\":\[\[0,0,\\"([^\\"]+)\\"/g);
  const seen = new Set<string>();

  return Array.from(matches).reduce<PublicSheetInfo[]>((sheets, match) => {
    const [, gid, title] = match;

    if (!gid || !title || seen.has(gid)) {
      return sheets;
    }

    seen.add(gid);
    sheets.push({ gid, title });
    return sheets;
  }, []);
}

function isOperationalSheetTitle(title: string): boolean {
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (/^(data|synthese|depart|param|config|modele|template)\b/.test(normalized)) {
    return false;
  }

  return /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.test(normalized)
    || /\b(planning|roadmap|quai|ramasse|ramasses)\b/.test(normalized);
}

function getTargetDateSet(): Set<string> | null {
  const configuredDates = process.env.ROADMAP_TARGET_DATES?.split(",")
    .map((date) => date.trim())
    .filter(Boolean);

  if (configuredDates?.length) {
    return new Set(configuredDates);
  }

  const startDate = process.env.ROADMAP_START_DATE;
  const endDate = process.env.ROADMAP_END_DATE;

  if (!startDate || !endDate) {
    return null;
  }

  return new Set(buildDateRange(startDate, endDate));
}

function filterTargetDates<T extends { date: string }>(rows: T[], targetDates: Set<string> | null): T[] {
  if (!targetDates) {
    return rows;
  }

  return rows.filter((row) => targetDates.has(row.date));
}

function buildDateRange(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  const current = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);

  while (current.getTime() <= end.getTime()) {
    result.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return result;
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
