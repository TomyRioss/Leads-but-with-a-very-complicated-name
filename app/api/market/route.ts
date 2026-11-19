import { getMarketCountry, isArgentinaMarket } from "@/lib/market";

export async function GET(request: Request) {
  const country = getMarketCountry(request.headers);

  return Response.json(
    { country, market: isArgentinaMarket(request.headers) ? "AR" : "international" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
