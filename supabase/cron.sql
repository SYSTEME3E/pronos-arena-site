-- =====================================================================
--  PRONOS ARENA : planification automatique (Supabase > SQL Editor)
--  Remplace <PROJET> par la référence de ton projet et <CRON_SECRET> par ton secret.
--  Budget : import 3x/jour (~10 appels chacun) + résultats toutes les 30 min (1 appel,
--  seulement s'il y a des matchs à régler) => reste sous les 100 requêtes/jour.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('pronos-import', '0 6,12,18 * * *', $$
  select net.http_post(
    url := 'https://<PROJET>.supabase.co/functions/v1/api-football-sync?mode=import',
    headers := '{"x-cron-secret": "<CRON_SECRET>"}'::jsonb);
$$);

select cron.schedule('pronos-resultats', '*/30 * * * *', $$
  select net.http_post(
    url := 'https://<PROJET>.supabase.co/functions/v1/api-football-sync?mode=resultats',
    headers := '{"x-cron-secret": "<CRON_SECRET>"}'::jsonb);
$$);
