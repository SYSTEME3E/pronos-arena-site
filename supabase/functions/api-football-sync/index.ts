// =====================================================================
//  PRONOS ARENA : synchronisation avec API-Football (plan gratuit : 100 requêtes/jour)
//  Championnats : Ligue 1 (61), Premier League (39), Ligue des champions (2), La Liga (140)
//
//  Appel :  POST /functions/v1/api-football-sync?mode=import      -> importe matchs + cotes
//           POST /functions/v1/api-football-sync?mode=resultats   -> règle les matchs terminés
//  En-tête obligatoire :  x-cron-secret: <CRON_SECRET>
//
//  Secrets à définir : API_FOOTBALL_KEY, CRON_SECRET
//  (SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement.)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const LIGUES: Record<number, string> = {
  61: "Ligue 1",
  39: "Premier League",
  2: "Ligue des champions",
  140: "La Liga",
};
const BOOKMAKER = 8; // Bet365
const API = "https://v3.football.api-sports.io";
const JOURS_A_IMPORTER = 2; // aujourd'hui + demain
const MAX_APPELS = 40; // garde-fou par exécution (quota gratuit : 100/jour)

let appels = 0;
async function api(chemin: string, params: Record<string, string | number>) {
  if (appels >= MAX_APPELS) throw new Error("Garde-fou : trop d'appels API sur cette exécution.");
  appels++;
  const url = `${API}${chemin}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
  const r = await fetch(url, { headers: { "x-apisports-key": Deno.env.get("API_FOOTBALL_KEY")! } });
  if (!r.ok) throw new Error(`API-Football HTTP ${r.status}`);
  const j = await r.json();
  const err = j.errors && (Array.isArray(j.errors) ? j.errors.length : Object.keys(j.errors).length);
  if (err) throw new Error("API-Football : " + JSON.stringify(j.errors));
  return j;
}

const saison = () => {
  const d = new Date();
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; // saison 2026-27 => 2026
};
const jour = (decalage: number) => new Date(Date.now() + decalage * 864e5).toISOString().slice(0, 10);
const num = (v: unknown) => { const n = Number(v); return n > 1 ? n : null; };

// Extrait 1X2, les deux équipes marquent et plus/moins 2.5 depuis un bookmaker
function lireCotes(bookmaker: any) {
  const bets = bookmaker?.bets ?? [];
  const val = (id: number, nom: string) =>
    num(bets.find((b: any) => b.id === id)?.values?.find((v: any) => v.value === nom)?.odd);
  return {
    q1: val(1, "Home"), qx: val(1, "Draw"), q2: val(1, "Away"),
    bo: val(8, "Yes"), bn: val(8, "No"),
    po: val(5, "Over 2.5"), pu: val(5, "Under 2.5"),
  };
}

async function importer(sb: ReturnType<typeof createClient>) {
  const bilan = { importes: 0, sans_cotes: 0, erreurs: [] as string[] };
  for (let d = 0; d < JOURS_A_IMPORTER; d++) {
    const date = jour(d);
    // 1 appel : tous les matchs du jour, on garde nos 4 championnats non commencés
    const fx = await api("/fixtures", { date, timezone: "UTC" });
    const matchs = new Map<number, any>();
    for (const f of fx.response) {
      if (LIGUES[f.league.id] && f.fixture.status.short === "NS") matchs.set(f.fixture.id, f);
    }
    if (!matchs.size) continue;

    // 1 appel (parfois 2) par championnat présent : les cotes
    const ligues = [...new Set([...matchs.values()].map((f) => f.league.id))];
    for (const lg of ligues) {
      let page = 1, total = 1;
      do {
        const od = await api("/odds", { league: lg, season: saison(), date, bookmaker: BOOKMAKER, page });
        total = od.paging?.total ?? 1;
        for (const o of od.response) {
          const f = matchs.get(o.fixture.id);
          if (!f) continue;
          const c = lireCotes(o.bookmakers?.[0]);
          if (!c.q1 || !c.qx || !c.q2) { bilan.sans_cotes++; continue; }
          const { error } = await sb.rpc("api_importer_evenement", {
            p_ref: String(f.fixture.id), p_competition: LIGUES[lg],
            p_equipe1: f.teams.home.name, p_equipe2: f.teams.away.name, p_debut: f.fixture.date,
            p_q1: c.q1, p_qx: c.qx, p_q2: c.q2, p_bo: c.bo, p_bn: c.bn, p_po: c.po, p_pu: c.pu,
          });
          if (error) bilan.erreurs.push(`${f.fixture.id}: ${error.message}`); else bilan.importes++;
        }
        page++;
      } while (page <= total);
    }
  }
  return bilan;
}

const TERMINE = ["FT", "AET", "PEN"];
const ANNULE = ["PST", "CANC", "ABD", "AWD", "WO"];

async function resultats(sb: ReturnType<typeof createClient>) {
  const bilan = { regles: 0, annules: 0, erreurs: [] as string[] };
  // Matchs encore ouverts, commencés depuis plus de 100 minutes
  const limite = new Date(Date.now() - 100 * 60000).toISOString();
  const { data, error } = await sb.from("evenements").select("ref_api")
    .eq("statut", "ouvert").lt("debut", limite).not("ref_api", "is", null).limit(60);
  if (error) throw error;
  const refs = (data ?? []).map((e: any) => e.ref_api as string);
  for (let i = 0; i < refs.length; i += 20) { // 20 matchs max par appel API
    const fx = await api("/fixtures", { ids: refs.slice(i, i + 20).join("-") });
    for (const f of fx.response) {
      const s = f.fixture.status.short, ref = String(f.fixture.id);
      if (TERMINE.includes(s)) {
        // Score après 90 minutes (prolongations et tirs au but exclus)
        const { home, away } = f.score.fulltime;
        if (home == null || away == null) continue;
        const { error: e } = await sb.rpc("api_resultat_evenement", { p_ref: ref, p_score1: home, p_score2: away });
        if (e) bilan.erreurs.push(`${ref}: ${e.message}`); else bilan.regles++;
      } else if (ANNULE.includes(s)) {
        const { error: e } = await sb.rpc("api_annuler_evenement", { p_ref: ref });
        if (e) bilan.erreurs.push(`${ref}: ${e.message}`); else bilan.annules++;
      }
    }
  }
  return bilan;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response("Non autorisé", { status: 401 });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const mode = new URL(req.url).searchParams.get("mode");
  try {
    const bilan = mode === "import" ? await importer(sb) : mode === "resultats" ? await resultats(sb) : null;
    if (!bilan) return new Response("mode = import ou resultats", { status: 400 });
    return Response.json({ mode, appels_api: appels, ...bilan });
  } catch (e) {
    return Response.json({ mode, appels_api: appels, erreur: String(e) }, { status: 500 });
  }
});
