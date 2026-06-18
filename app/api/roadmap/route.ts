import { NextResponse } from "next/server";
import { loadRoadmapData } from "@/lib/sheet";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await loadRoadmapData();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        source: {
          sheetId: process.env.GOOGLE_SHEET_ID ?? "1kxVKlwjMyM619Rg1WdqzvxwQ0pT-b-FIv651C_oWwkg",
          mode: "public-csv"
        },
        dates: [],
        trucks: [],
        errors: [error instanceof Error ? error.message : "Erreur inconnue"]
      },
      { status: 500 }
    );
  }
}
