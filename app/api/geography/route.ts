import { NextResponse } from "next/server";
import {
  getCitiesOfState,
  getCountries,
  getStatesOfCountry,
} from "@countrystatecity/countries";
import { errorTranslator } from "@/lib/server/locale";
import { countryDisplayName, stateDisplayName } from "@/lib/server/geography";

type GeographyOption = { code: string; name: string };

function jsonOptions(options: GeographyOption[]) {
  return NextResponse.json(options, {
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}

export async function GET(request: Request) {
  const t = errorTranslator(request);
  const { searchParams } = new URL(request.url);
  const level = searchParams.get("level");

  try {
    if (level === "countries") {
      const countries = await getCountries();
      const options = countries
        .map(({ iso2, name }) => ({ code: iso2, name: countryDisplayName(iso2, name) }))
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      return jsonOptions(options);
    }

    const countryCode = searchParams.get("country")?.toUpperCase() ?? "";
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return NextResponse.json({ error: t("geoInvalidCountry") }, { status: 400 });
    }

    if (level === "provinces") {
      const states = await getStatesOfCountry(countryCode);
      const options = states
        .map((state) => ({
          code: state.iso2,
          name: stateDisplayName(state),
        }))
        .filter((option) => option.code && option.name)
        .sort((a, b) => a.name.localeCompare(b.name, "es"));
      return jsonOptions(options);
    }

    if (level === "districts") {
      const provinceCode = searchParams.get("province")?.toUpperCase() ?? "";
      if (!/^[A-Z0-9-]{1,10}$/.test(provinceCode)) {
        return NextResponse.json({ error: t("geoInvalidState") }, { status: 400 });
      }
      const states = await getStatesOfCountry(countryCode);
      const stateExists = states.some((state) => state.iso2 === provinceCode);
      if (!stateExists) return NextResponse.json({ error: t("geoStateNotInCountry") }, { status: 400 });

      const cities = await getCitiesOfState(countryCode, provinceCode);
      const byName = new Map<string, GeographyOption>();
      for (const city of cities) {
        const name = city.name.trim();
        const normalized = name.toLocaleLowerCase("es");
        if (name && !byName.has(normalized)) byName.set(normalized, { code: String(city.id), name });
      }
      const options = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
      return jsonOptions(options);
    }

    return NextResponse.json({ error: t("geoInvalidLevel") }, { status: 400 });
  } catch (error) {
    console.error("Geography lookup failed:", error);
    return NextResponse.json({ error: t("geoLoadFailed") }, { status: 503 });
  }
}
