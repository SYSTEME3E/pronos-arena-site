-- =====================================================================
--  PRONOS ARENA : toute la logique côté serveur (Supabase / PostgreSQL)
-- =====================================================================
--  À coller dans Supabase > SQL Editor > New query, puis « Run ».
--  Le script peut être relancé : il ne supprime aucune donnée.
--
--  Principe : le navigateur ne modifie JAMAIS un solde, une cote, un pari ou
--  un statut lui-même. Il appelle des fonctions (supabase.rpc) qui vérifient
--  tout, et les tables sont en lecture seule grâce aux règles RLS.
--
--  SOMMAIRE
--   0. Réglages Supabase à faire dans le tableau de bord
--   1. Tables
--   2. Compte : inscription (SANS validation par e-mail), parrainage, connexion
--   3. Mouvements de solde (journal)
--   4. Recharges et retraits
--   5. Parrainage : bonus sur 3 niveaux, arbre
--   6. Évènements : import depuis l'API, codes, résultats, règlement des tickets
--   7. Paris (tickets combinés)
--   8. Pronostic du jour
--   9. Administration : comptes, réglages, tableau de bord
--  10. Sécurité : RLS et droits d'exécution
--
--  0. RÉGLAGES À FAIRE DANS SUPABASE (dashboard)
--   - Authentication > Providers > Email : désactiver « Confirm email ».
--     (Le script confirme aussi chaque compte automatiquement, voir 2.1.)
--   - Inscription depuis le site :
--       supabase.auth.signUp({
--         email:    pseudo.toLowerCase() + '@pronosarena.app',   // e-mail technique
--         password: motDePasse,
--         options:  { data: { pseudo, tel, email_contact, prenom, nom, parrain_code } }
--       })
--     Le vrai e-mail du joueur (facultatif) est gardé dans profiles.email.
--   - Connexion par nom d'utilisateur OU e-mail :
--       const { data: mail } = await supabase.rpc('email_connexion', { p_identifiant: saisie });
--       await supabase.auth.signInWithPassword({ email: mail, password })
--   - Le compte administrateur : créer un compte dont le nom d'utilisateur est
--     « admin » juste après avoir lancé ce script. Le premier compte « admin »
--     devient administrateur, ensuite ce nom est réservé (voir 2.2).
-- =====================================================================


-- =====================================================================
-- 1. TABLES
-- =====================================================================

-- 1.1 Réglages (une seule ligne) : tout ce que l'admin peut changer
create table if not exists public.reglages (
  id                 int primary key default 1 check (id = 1),
  p1                 numeric(5,2) not null default 10 check (p1 between 0 and 100),  -- % parrainage niveau 1
  p2                 numeric(5,2) not null default 5  check (p2 between 0 and 100),  -- niveau 2
  p3                 numeric(5,2) not null default 2  check (p3 between 0 and 100),  -- niveau 3
  retrait_frais_pct  numeric(5,2) not null default 5  check (retrait_frais_pct between 0 and 100),
  retrait_min        bigint       not null default 0  check (retrait_min >= 0),
  retrait_heure_debut int         not null default 10 check (retrait_heure_debut between 0 and 23),
  retrait_heure_fin   int         not null default 18 check (retrait_heure_fin between 1 and 24),
  depot_min          bigint       not null default 0  check (depot_min >= 0),
  lien_paiement      text         not null default '',
  fuseau             text         not null default 'Africa/Porto-Novo',  -- fuseau des heures de retrait
  check (retrait_heure_debut < retrait_heure_fin)
);
insert into public.reglages (id) values (1) on conflict (id) do nothing;

-- 1.2 Profils (un par compte). Le solde est en francs entiers.
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  pseudo           text not null check (pseudo ~ '^[A-Za-z0-9_.-]{3,20}$'),
  email            text,                       -- e-mail réel, facultatif, jamais vérifié
  tel              text not null default '',
  prenom           text not null default '',
  nom              text not null default '',
  pays             text not null default '',
  ville            text not null default '',
  code_parrainage  text not null unique,       -- le code que le joueur partage
  parrain_code     text,                       -- le code utilisé à l'inscription
  parrain_id       uuid references public.profiles(id) on delete set null,
  solde            bigint not null default 0 check (solde >= 0),
  bloque           boolean not null default false,
  is_admin         boolean not null default false,
  created_at       timestamptz not null default now()
);
create unique index if not exists profiles_pseudo_uq on public.profiles (lower(pseudo));
create index if not exists profiles_parrain_idx on public.profiles (parrain_id);
create index if not exists profiles_email_idx on public.profiles (lower(email));

-- 1.3 Journal de tous les mouvements de solde (jamais modifié, seulement ajouté)
create table if not exists public.transactions (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  type        text not null check (type in ('recharge','retrait','pari','gain','remboursement',
                                            'bonus','ajustement_admin','pronostic_mise','pronostic_gain',
                                            'pronostic_remboursement','annulation')),
  montant     bigint not null,                -- positif = entrée, négatif = sortie
  solde_apres bigint not null,
  ref         text,
  created_at  timestamptz not null default now()
);
create index if not exists transactions_user_idx on public.transactions (user_id, created_at desc);

-- 1.4 Demandes de recharge et de retrait
create table if not exists public.demandes (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  pseudo      text not null,
  type        text not null check (type in ('recharge','retrait')),
  montant     bigint not null check (montant > 0),
  reseau      text not null,
  tel         text not null,
  nom         text not null,
  prenom      text not null,
  preuve      text,                            -- preuve de paiement (recharge)
  frais_pct   numeric(5,2),                    -- retrait : % de frais au moment de la demande
  frais       bigint,
  net         bigint,                          -- retrait : montant envoyé au joueur
  statut      text not null default 'attente' check (statut in ('attente','valide','refuse')),
  traite_par  uuid references public.profiles(id) on delete set null,
  traite_le   timestamptz,
  created_at  timestamptz not null default now(),
  check (type <> 'recharge' or length(trim(coalesce(preuve,''))) > 0)
);
create index if not exists demandes_user_idx   on public.demandes (user_id, created_at desc);
create index if not exists demandes_statut_idx on public.demandes (statut, type);

-- 1.5 Bonus de parrainage
create table if not exists public.bonus_parrainage (
  id          bigint generated always as identity primary key,
  parrain_id  uuid references public.profiles(id) on delete set null,
  filleul_id  uuid references public.profiles(id) on delete set null,
  filleul     text not null,                   -- pseudo du filleul, gardé même si le compte disparaît
  niveau      int  not null check (niveau between 1 and 3),
  base        bigint not null,                 -- montant de la recharge
  pourcentage numeric(5,2) not null,
  bonus       bigint not null check (bonus > 0),
  demande_id  bigint references public.demandes(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists bonus_parrain_idx on public.bonus_parrainage (parrain_id, created_at desc);

-- 1.6 Évènements créés par l'admin (un match + ses cotes + son code)
create table if not exists public.evenements (
  id           bigint generated always as identity primary key,
  ref_api      text unique,                            -- identifiant du match chez le fournisseur de l'API
  code         text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
  competition  text not null default '',
  equipe1      text not null,
  equipe2      text not null,
  debut        timestamptz not null,           -- coup d'envoi : les paris ferment à cette heure
  q1           numeric(8,2) not null check (q1 > 1),   -- victoire équipe 1
  qx           numeric(8,2) not null check (qx > 1),   -- match nul
  q2           numeric(8,2) not null check (q2 > 1),   -- victoire équipe 2
  q_bo         numeric(8,2) check (q_bo > 1),          -- les deux équipes marquent : oui (facultatif)
  q_bn         numeric(8,2) check (q_bn > 1),          --                              non
  q_po         numeric(8,2) check (q_po > 1),          -- plus de 2.5 buts (facultatif)
  q_pu         numeric(8,2) check (q_pu > 1),          -- moins de 2.5 buts
  publie       boolean not null default true,          -- true = visible sur l'accueil de tous
  statut       text not null default 'ouvert' check (statut in ('ouvert','clos','annule')),
  score1       int check (score1 >= 0),
  score2       int check (score2 >= 0),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  check ((q_bo is null) = (q_bn is null)),
  check ((q_po is null) = (q_pu is null)),
  check (statut <> 'clos' or (score1 is not null and score2 is not null))
);
create index if not exists evenements_statut_idx on public.evenements (statut, debut);

-- Évènements « code seulement » : ceux que le joueur a chargés avec un code
create table if not exists public.evenements_charges (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  evenement_id bigint not null references public.evenements(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, evenement_id)
);

-- 1.7 Tickets (paris combinés) et leurs sélections
create table if not exists public.tickets (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  mise        bigint not null check (mise > 0),
  cote        numeric(16,6) not null check (cote >= 1),   -- cote totale (recalculée au règlement si annulation)
  statut      text not null default 'cours' check (statut in ('cours','gagne','perdu','rembourse','annule')),
  gain        bigint not null default 0,
  created_at  timestamptz not null default now(),
  regle_le    timestamptz
);
create index if not exists tickets_user_idx on public.tickets (user_id, created_at desc);

create table if not exists public.ticket_selections (
  id           bigint generated always as identity primary key,
  ticket_id    bigint not null references public.tickets(id) on delete cascade,
  evenement_id bigint not null references public.evenements(id) on delete restrict,
  equipe1      text not null,
  equipe2      text not null,
  choix        text not null check (choix in ('1','X','2','1X','12','X2','bo','bn','po','pu')),
  libelle      text not null,
  cote         numeric(8,2) not null check (cote > 1),
  resultat     text check (resultat in ('gagne','perdu','annule')),   -- null = pas encore joué
  unique (ticket_id, evenement_id)             -- une seule sélection par match dans un ticket
);
create index if not exists selections_event_idx on public.ticket_selections (evenement_id);

-- 1.8 Pronostic du jour
create table if not exists public.pronostics (
  id           bigint generated always as identity primary key,
  evenement_id bigint not null references public.evenements(id) on delete restrict,
  equipe1      text not null,
  equipe2      text not null,
  score1       int  not null check (score1 >= 0),   -- score pronostiqué
  score2       int  not null check (score2 >= 0),
  cote         numeric(8,2) not null check (cote > 1),
  statut       text not null default 'ouvert' check (statut in ('ouvert','clos')),
  final1       int check (final1 >= 0),
  final2       int check (final2 >= 0),
  created_at   timestamptz not null default now(),
  check (statut <> 'clos' or (final1 is not null and final2 is not null))
);
-- un seul pronostic ouvert à la fois
create unique index if not exists pronostic_un_seul_ouvert on public.pronostics ((statut)) where statut = 'ouvert';

create table if not exists public.participations (
  id           bigint generated always as identity primary key,
  pronostic_id bigint not null references public.pronostics(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete set null,
  mise         bigint not null check (mise > 0),
  cote         numeric(8,2) not null,
  statut       text not null default 'cours' check (statut in ('cours','gagne','perdu','rembourse','annule')),
  created_at   timestamptz not null default now()
);
-- une participation active par joueur (une participation annulée peut être refaite)
create unique index if not exists participation_unique on public.participations (pronostic_id, user_id) where statut <> 'annule';


-- 1.9 Mise à jour d'une base déjà installée avec une version précédente de ce script
alter table public.evenements add column if not exists ref_api text unique;
alter table public.evenements alter column publie set default true;
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check check (type in ('recharge','retrait','pari','gain','remboursement',
  'bonus','ajustement_admin','pronostic_mise','pronostic_gain','pronostic_remboursement','annulation'));
alter table public.tickets drop constraint if exists tickets_statut_check;
alter table public.tickets add constraint tickets_statut_check check (statut in ('cours','gagne','perdu','rembourse','annule'));
alter table public.participations drop constraint if exists participations_statut_check;
alter table public.participations add constraint participations_statut_check check (statut in ('cours','gagne','perdu','rembourse','annule'));
alter table public.participations drop constraint if exists participations_pronostic_id_user_id_key;
drop function if exists public.admin_creer_evenement(text,text,text,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,boolean,text);


-- =====================================================================
-- 2. COMPTE : INSCRIPTION SANS VALIDATION PAR E-MAIL
-- =====================================================================

-- 2.1 Confirmation automatique : aucun e-mail de validation n'est attendu.
create or replace function public.auth_confirmer_auto()
returns trigger language plpgsql as $$
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end $$;

drop trigger if exists avant_creation_compte on auth.users;
create trigger avant_creation_compte
  before insert on auth.users
  for each row execute function public.auth_confirmer_auto();

-- 2.2 À chaque nouveau compte : création du profil, du code de parrainage,
--     vérification du code de parrain. Toute erreur annule l'inscription.
create or replace function public.creer_profil()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m        jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_pseudo text  := trim(coalesce(m->>'pseudo',''));
  v_pc     text  := upper(trim(coalesce(m->>'parrain_code','')));
  v_parrain uuid;
  v_base   text;
  v_code   text;
  v_admin  boolean := false;
begin
  if v_pseudo !~ '^[A-Za-z0-9_.-]{3,20}$' then
    raise exception 'Nom d''utilisateur invalide : 3 à 20 caractères (lettres, chiffres, _ . -).';
  end if;
  if exists (select 1 from profiles where lower(pseudo) = lower(v_pseudo)) then
    raise exception 'Ce nom d''utilisateur est déjà pris.';
  end if;

  if v_pc <> '' then
    select id into v_parrain from profiles where code_parrainage = v_pc;
    if v_parrain is null then raise exception 'Code de parrainage introuvable.'; end if;
  end if;

  -- Le premier compte nommé « admin » devient administrateur ; ensuite le nom est réservé.
  if lower(v_pseudo) in ('admin','administrateur') then
    if exists (select 1 from profiles where is_admin) then
      raise exception 'Ce nom d''utilisateur est réservé.';
    end if;
    v_admin := true;
  end if;

  -- Code de parrainage unique : 4 lettres du pseudo + 3 chiffres (ex. LUCA482)
  v_base := upper(left(regexp_replace(v_pseudo, '[^A-Za-z0-9]', '', 'g') || 'XXXX', 4));
  loop
    v_code := v_base || (100 + floor(random() * 900))::int;
    exit when not exists (select 1 from profiles where code_parrainage = v_code);
  end loop;

  insert into profiles (id, pseudo, email, tel, prenom, nom, code_parrainage, parrain_code, parrain_id, is_admin)
  values (new.id, v_pseudo,
          nullif(trim(coalesce(m->>'email_contact','')), ''),
          trim(coalesce(m->>'tel','')), trim(coalesce(m->>'prenom','')), trim(coalesce(m->>'nom','')),
          v_code, nullif(v_pc,''), v_parrain, v_admin);
  return new;
end $$;

drop trigger if exists apres_creation_compte on auth.users;
create trigger apres_creation_compte
  after insert on auth.users
  for each row execute function public.creer_profil();

-- 2.3 Connexion par nom d'utilisateur OU e-mail : renvoie l'e-mail technique du compte.
--     (appelable sans être connecté ; ne révèle aucune donnée personnelle)
create or replace function public.email_connexion(p_identifiant text)
returns text language sql security definer stable set search_path = public, pg_temp as $$
  select u.email
    from profiles p join auth.users u on u.id = p.id
   where lower(p.pseudo) = lower(trim(p_identifiant))
      or (p.email is not null and lower(p.email) = lower(trim(p_identifiant)))
   limit 1
$$;

-- 2.4 Outils internes
create or replace function public.est_admin()
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create or replace function public._exiger_admin()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_admin() then raise exception 'Accès réservé à l''administrateur.'; end if;
end $$;

-- Renvoie l'id du joueur connecté, et refuse un compte bloqué.
create or replace function public._joueur()
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := auth.uid(); v_bloque boolean;
begin
  if v_id is null then raise exception 'Connecte-toi pour continuer.'; end if;
  select bloque into v_bloque from profiles where id = v_id;
  if v_bloque is null then raise exception 'Compte introuvable.'; end if;
  if v_bloque then raise exception 'Ce compte est bloqué. Contacte l''administrateur.'; end if;
  return v_id;
end $$;

-- 2.5 Le joueur modifie ses informations personnelles (jamais son solde ni ses droits)
create or replace function public.maj_profil(p_email text, p_tel text, p_prenom text, p_nom text, p_pays text, p_ville text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := _joueur();
begin
  update profiles set
    email  = nullif(trim(coalesce(p_email,'')), ''),
    tel    = trim(coalesce(p_tel,'')),
    prenom = trim(coalesce(p_prenom,'')),
    nom    = trim(coalesce(p_nom,'')),
    pays   = trim(coalesce(p_pays,'')),
    ville  = trim(coalesce(p_ville,''))
  where id = v_id;
end $$;
-- Le changement de mot de passe se fait avec supabase.auth.updateUser({ password }).


-- =====================================================================
-- 3. MOUVEMENTS DE SOLDE (seul endroit où un solde change)
-- =====================================================================
create or replace function public._mouvement(p_uid uuid, p_montant bigint, p_type text, p_ref text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_solde bigint;
begin
  if p_uid is null or p_montant = 0 then return null; end if;   -- compte supprimé : rien à créditer
  update profiles set solde = solde + p_montant where id = p_uid returning solde into v_solde;
  if v_solde is null then return null; end if;
  insert into transactions (user_id, type, montant, solde_apres, ref) values (p_uid, p_type, p_montant, v_solde, p_ref);
  return v_solde;
exception when check_violation then
  raise exception 'Solde insuffisant.';
end $$;


-- =====================================================================
-- 4. RECHARGES ET RETRAITS
-- =====================================================================

-- 4.1 Retraits ouverts ? (heure locale du fuseau réglé par l'admin)
create or replace function public.retraits_ouverts()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select (extract(hour from (now() at time zone r.fuseau)) * 60 + extract(minute from (now() at time zone r.fuseau)))
         between r.retrait_heure_debut * 60 and r.retrait_heure_fin * 60 - 1
    from reglages r where r.id = 1
$$;

-- 4.2 Demande de recharge (le solde ne bouge qu'à la validation par l'admin)
create or replace function public.demander_recharge(p_montant bigint, p_reseau text, p_tel text, p_nom text, p_prenom text, p_preuve text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := _joueur(); r reglages; v_pseudo text; v_num bigint;
begin
  select * into r from reglages where id = 1;
  if p_montant is null or p_montant <= 0 then raise exception 'Entre un montant supérieur à 0.'; end if;
  if r.depot_min > 0 and p_montant < r.depot_min then raise exception 'Dépôt minimum : % F.', r.depot_min; end if;
  if length(trim(coalesce(p_reseau,''))) = 0 or length(trim(coalesce(p_tel,''))) = 0
     or length(trim(coalesce(p_nom,''))) = 0 or length(trim(coalesce(p_prenom,''))) = 0 then
    raise exception 'Remplis le réseau, le numéro, le nom et le prénom.';
  end if;
  if length(trim(coalesce(p_preuve,''))) = 0 then raise exception 'La preuve de paiement est obligatoire.'; end if;
  select pseudo into v_pseudo from profiles where id = v_id;
  insert into demandes (user_id, pseudo, type, montant, reseau, tel, nom, prenom, preuve)
  values (v_id, v_pseudo, 'recharge', p_montant, trim(p_reseau), trim(p_tel), trim(p_nom), trim(p_prenom), left(trim(p_preuve), 500))
  returning id into v_num;
  return v_num;
end $$;

-- 4.3 Demande de retrait : heures d'ouverture, minimum, solde suffisant, frais calculés ici.
create or replace function public.demander_retrait(p_montant bigint, p_reseau text, p_tel text, p_nom text, p_prenom text)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := _joueur(); r reglages; p profiles; v_frais bigint; v_num bigint;
begin
  select * into r from reglages where id = 1;
  select * into p from profiles where id = v_id;
  if not retraits_ouverts() then
    raise exception 'Les retraits sont ouverts de %h à %h.', r.retrait_heure_debut, r.retrait_heure_fin;
  end if;
  if p_montant is null or p_montant <= 0 then raise exception 'Entre un montant supérieur à 0.'; end if;
  if r.retrait_min > 0 and p_montant < r.retrait_min then raise exception 'Retrait minimum : % F.', r.retrait_min; end if;
  if p_montant > p.solde then raise exception 'Solde insuffisant.'; end if;
  if length(trim(coalesce(p_reseau,''))) = 0 or length(trim(coalesce(p_tel,''))) = 0
     or length(trim(coalesce(p_nom,''))) = 0 or length(trim(coalesce(p_prenom,''))) = 0 then
    raise exception 'Remplis le réseau, le numéro, le nom et le prénom.';
  end if;
  v_frais := round(p_montant * r.retrait_frais_pct / 100);
  insert into demandes (user_id, pseudo, type, montant, reseau, tel, nom, prenom, frais_pct, frais, net)
  values (v_id, p.pseudo, 'retrait', p_montant, trim(p_reseau), trim(p_tel), trim(p_nom), trim(p_prenom),
          r.retrait_frais_pct, v_frais, p_montant - v_frais)
  returning id into v_num;
  return v_num;
end $$;

-- 4.4 L'admin valide ou refuse une demande.
--     Recharge validée : solde crédité + bonus de parrainage distribués.
--     Retrait validé   : solde débité du montant demandé (le joueur reçoit montant - frais).
create or replace function public.admin_traiter_demande(p_id bigint, p_decision text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare d demandes; v_bonus bigint := 0;
begin
  perform _exiger_admin();
  if p_decision not in ('valide','refuse') then raise exception 'Décision invalide.'; end if;
  select * into d from demandes where id = p_id for update;          -- verrou : pas de double validation
  if d.id is null then raise exception 'Demande introuvable.'; end if;
  if d.statut <> 'attente' then raise exception 'Cette demande a déjà été traitée.'; end if;

  if p_decision = 'valide' then
    if d.user_id is null or not exists (select 1 from profiles where id = d.user_id) then
      raise exception 'Compte introuvable.';
    end if;
    if d.type = 'recharge' then
      perform _mouvement(d.user_id, d.montant, 'recharge', 'D' || d.id);
      v_bonus := _distribuer_bonus(d.id);
    else
      if (select solde from profiles where id = d.user_id) < d.montant then
        raise exception 'Solde insuffisant pour ce retrait.';
      end if;
      perform _mouvement(d.user_id, -d.montant, 'retrait', 'D' || d.id);
    end if;
  end if;

  update demandes set statut = p_decision, traite_par = auth.uid(), traite_le = now() where id = d.id;
  return case when p_decision = 'refuse' then 'Demande refusée.'
              when d.type = 'retrait'   then 'Retrait validé, solde débité.'
              when v_bonus > 0          then 'Recharge validée. Bonus de parrainage distribués : ' || v_bonus || ' F.'
              else 'Recharge validée, solde crédité.' end;
end $$;


-- =====================================================================
-- 5. PARRAINAGE
-- =====================================================================

-- 5.1 Bonus : à chaque recharge validée, les parrains de niveau 1, 2 et 3
--     reçoivent leur pourcentage sur leur solde.
create or replace function public._distribuer_bonus(p_demande bigint)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d demandes; r reglages; v_cur uuid; v_parrain uuid; v_pct numeric; v_bonus bigint;
  v_total bigint := 0; v_vus uuid[] := '{}'; n int;
begin
  select * into d from demandes where id = p_demande;
  select * into r from reglages where id = 1;
  v_cur := d.user_id; v_vus := array[d.user_id];
  for n in 1..3 loop
    select parrain_id into v_parrain from profiles where id = v_cur;
    exit when v_parrain is null or v_parrain = any(v_vus);          -- pas de boucle
    v_vus := v_vus || v_parrain;
    v_pct := case n when 1 then r.p1 when 2 then r.p2 else r.p3 end;
    v_bonus := round(d.montant * v_pct / 100);
    if v_bonus > 0 then
      perform _mouvement(v_parrain, v_bonus, 'bonus', 'D' || d.id);
      insert into bonus_parrainage (parrain_id, filleul_id, filleul, niveau, base, pourcentage, bonus, demande_id)
      values (v_parrain, d.user_id, d.pseudo, n, d.montant, v_pct, v_bonus, d.id);
      v_total := v_total + v_bonus;
    end if;
    v_cur := v_parrain;
  end loop;
  return v_total;
end $$;

-- 5.2 Mon arbre : filleuls des niveaux 1 à 3, avec ce que chacun m'a déjà rapporté
create or replace function public.arbre_parrainage()
returns table (niveau int, user_id uuid, pseudo text, rapporte bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive arbre(niveau, id, pseudo) as (
    select 1, p.id, p.pseudo from profiles p where p.parrain_id = auth.uid() and p.id <> auth.uid()
    union all
    select a.niveau + 1, p.id, p.pseudo
      from arbre a join profiles p on p.parrain_id = a.id
     where a.niveau < 3 and p.id <> auth.uid()
  )
  select a.niveau, a.id, a.pseudo,
         coalesce((select sum(b.bonus) from bonus_parrainage b where b.parrain_id = auth.uid() and b.filleul_id = a.id), 0)::bigint
    from arbre a order by a.niveau, a.pseudo
$$;

-- 5.3 Mes bonus (historique)
create or replace function public.mes_bonus()
returns table (id bigint, filleul text, niveau int, base bigint, pourcentage numeric, bonus bigint, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, b.filleul, b.niveau, b.base, b.pourcentage, b.bonus, b.created_at
    from bonus_parrainage b where b.parrain_id = auth.uid() order by b.created_at desc
$$;


-- =====================================================================
-- 6. ÉVÈNEMENTS
-- =====================================================================

-- 6.1 Cotes dérivées (même formule que le site) et libellés des choix
create or replace function public._cote_dc(a numeric, b numeric)
returns numeric language sql immutable as $$ select greatest(1.05, round(1 / (1 / a + 1 / b) * 0.93, 2)) $$;

-- Cote d'un choix pour un évènement (null si le marché n'est pas proposé)
create or replace function public._cote(e evenements, p_choix text)
returns numeric language sql immutable as $$
  select case p_choix
    when '1'  then e.q1
    when 'X'  then e.qx
    when '2'  then e.q2
    when '1X' then _cote_dc(e.q1, e.qx)
    when '12' then _cote_dc(e.q1, e.q2)
    when 'X2' then _cote_dc(e.qx, e.q2)
    when 'bo' then e.q_bo
    when 'bn' then e.q_bn
    when 'po' then e.q_po
    when 'pu' then e.q_pu
  end
$$;

create or replace function public._libelle(p_choix text)
returns text language sql immutable as $$
  select case p_choix
    when '1' then 'V1' when 'X' then 'X' when '2' then 'V2'
    when '1X' then 'Double chance : 1X' when '12' then 'Double chance : 12' when 'X2' then 'Double chance : X2'
    when 'bo' then 'Les deux équipes marquent : Oui' when 'bn' then 'Les deux équipes marquent : Non'
    when 'po' then 'Total de buts : Plus 2.5' when 'pu' then 'Total de buts : Moins 2.5'
  end
$$;

-- Un choix est-il gagnant pour le score final s1 – s2 ?
create or replace function public._gagne(p_choix text, s1 int, s2 int)
returns boolean language sql immutable as $$
  select case p_choix
    when '1'  then s1 > s2   when 'X' then s1 = s2   when '2'  then s1 < s2
    when '1X' then s1 >= s2  when '12' then s1 <> s2 when 'X2' then s1 <= s2
    when 'bo' then s1 > 0 and s2 > 0   when 'bn' then not (s1 > 0 and s2 > 0)
    when 'po' then s1 + s2 >= 3        when 'pu' then s1 + s2 <= 2
    else false end
$$;

-- 6.2 ÉVÈNEMENTS VENANT DE L'API
--     Les évènements ne sont pas saisis à la main : une fonction serveur (Edge Function Supabase,
--     appelée par un cron) lit l'API de matchs et appelle ces fonctions avec la clé « service_role ».
--     Ces fonctions ne sont PAS appelables depuis le navigateur.
create or replace function public._nouveau_code_evenement()
returns text language plpgsql set search_path = public, pg_temp as $$
declare v text; A text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    v := 'EV';
    for i in 1..5 loop v := v || substr(A, 1 + floor(random() * length(A))::int, 1); end loop;
    exit when not exists (select 1 from evenements where code = v);
  end loop;
  return v;
end $$;

-- Crée le match, ou met à jour ses cotes tant qu'il n'a pas commencé. Renvoie l'id interne.
create or replace function public.api_importer_evenement(
  p_ref text, p_competition text, p_equipe1 text, p_equipe2 text, p_debut timestamptz,
  p_q1 numeric, p_qx numeric, p_q2 numeric,
  p_bo numeric default null, p_bn numeric default null, p_po numeric default null, p_pu numeric default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  if coalesce(trim(p_ref),'') = '' then raise exception 'Référence API manquante.'; end if;
  if not (p_q1 > 1 and p_qx > 1 and p_q2 > 1) then raise exception 'Cotes 1X2 invalides.'; end if;
  insert into evenements (ref_api, code, competition, equipe1, equipe2, debut, q1, qx, q2, q_bo, q_bn, q_po, q_pu, publie)
  values (trim(p_ref), _nouveau_code_evenement(), trim(coalesce(p_competition,'')), trim(p_equipe1), trim(p_equipe2), p_debut,
          p_q1, p_qx, p_q2,
          case when p_bo > 1 and p_bn > 1 then p_bo end, case when p_bo > 1 and p_bn > 1 then p_bn end,
          case when p_po > 1 and p_pu > 1 then p_po end, case when p_po > 1 and p_pu > 1 then p_pu end, true)
  on conflict (ref_api) do update set
      competition = excluded.competition, debut = excluded.debut,
      q1 = excluded.q1, qx = excluded.qx, q2 = excluded.q2,
      q_bo = excluded.q_bo, q_bn = excluded.q_bn, q_po = excluded.q_po, q_pu = excluded.q_pu
    where evenements.statut = 'ouvert' and evenements.debut > now()        -- jamais après le coup d'envoi
  returning id into v_id;
  if v_id is null then select id into v_id from evenements where ref_api = trim(p_ref); end if;
  return v_id;
end $$;

-- Termine un évènement (score final) et règle les tickets. Commun à l'API et à la correction manuelle.
create or replace function public._cloturer_evenement(p_id bigint, p_score1 int, p_score2 int, p_exiger_debut boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e evenements;
begin
  if p_score1 is null or p_score2 is null or p_score1 < 0 or p_score2 < 0 then raise exception 'Saisis le score final des deux équipes.'; end if;
  select * into e from evenements where id = p_id for update;
  if e.id is null then raise exception 'Évènement introuvable.'; end if;
  if e.statut <> 'ouvert' then raise exception 'Cet évènement est déjà terminé ou annulé.'; end if;
  if p_exiger_debut and e.debut > now() then raise exception 'Le match n''a pas encore commencé.'; end if;
  update evenements set statut = 'clos', score1 = p_score1, score2 = p_score2 where id = e.id;
  perform _regler_evenement(e.id);
end $$;

-- Score final reçu de l'API
create or replace function public.api_resultat_evenement(p_ref text, p_score1 int, p_score2 int)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  select id into v_id from evenements where ref_api = trim(p_ref);
  if v_id is null then raise exception 'Évènement inconnu.'; end if;
  perform _cloturer_evenement(v_id, p_score1, p_score2, false);
end $$;

-- Match annulé ou reporté chez le fournisseur
create or replace function public.api_annuler_evenement(p_ref text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint; e evenements;
begin
  select id into v_id from evenements where ref_api = trim(p_ref);
  if v_id is null then raise exception 'Évènement inconnu.'; end if;
  select * into e from evenements where id = v_id for update;
  if e.statut <> 'ouvert' then return; end if;
  update evenements set statut = 'annule' where id = e.id;
  perform _regler_evenement(e.id);
end $$;

-- 6.3 Le joueur entre un code : l'évènement s'ajoute à sa liste.
create or replace function public.charger_evenement(p_code text)
returns evenements language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := _joueur(); e evenements;
begin
  select * into e from evenements where code = upper(trim(coalesce(p_code,''))) and statut = 'ouvert';
  if e.id is null then raise exception 'Code introuvable.'; end if;
  if e.debut <= now() then raise exception 'Cet évènement a déjà commencé.'; end if;
  insert into evenements_charges (user_id, evenement_id) values (v_id, e.id) on conflict do nothing;
  return e;
end $$;

-- 6.4 Règlement d'un ticket (appelé après chaque résultat) :
--     une sélection perdue = ticket perdu ; toutes gagnées (les annulées comptent 1.00) = gain ;
--     tout annulé = mise remboursée ; sinon le ticket reste en cours.
create or replace function public._regler_ticket(p_ticket bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t tickets; s record; v_cote numeric := 1; v_gagnees int := 0; v_gain bigint;
begin
  select * into t from tickets where id = p_ticket and statut = 'cours' for update;
  if t.id is null then return; end if;

  if exists (select 1 from ticket_selections where ticket_id = t.id and resultat = 'perdu') then
    update tickets set statut = 'perdu', gain = 0, regle_le = now() where id = t.id;
    return;
  end if;
  if exists (select 1 from ticket_selections where ticket_id = t.id and resultat is null) then
    return;                                                          -- il reste des matchs à jouer
  end if;

  for s in select cote from ticket_selections where ticket_id = t.id and resultat = 'gagne' loop
    v_cote := v_cote * s.cote; v_gagnees := v_gagnees + 1;
  end loop;

  if v_gagnees = 0 then
    update tickets set statut = 'rembourse', gain = 0, regle_le = now() where id = t.id;
    perform _mouvement(t.user_id, t.mise, 'remboursement', 'T' || t.id);
  else
    v_gain := round(t.mise * v_cote);
    update tickets set statut = 'gagne', cote = v_cote, gain = v_gain, regle_le = now() where id = t.id;
    perform _mouvement(t.user_id, v_gain, 'gain', 'T' || t.id);
  end if;
end $$;

-- Applique le résultat (ou l'annulation) de l'évènement à toutes les sélections, puis règle les tickets.
create or replace function public._regler_evenement(p_event bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e evenements; s record;
begin
  select * into e from evenements where id = p_event;
  update ticket_selections set resultat =
      case when e.statut = 'annule' then 'annule'
           when _gagne(choix, e.score1, e.score2) then 'gagne' else 'perdu' end
   where evenement_id = e.id and resultat is null;
  for s in select distinct ticket_id from ticket_selections where evenement_id = e.id loop
    perform _regler_ticket(s.ticket_id);
  end loop;
end $$;

-- 6.5 Correction manuelle par l'admin (si l'API se trompe ou tarde) : score final, tickets réglés.
create or replace function public.admin_resultat_evenement(p_id bigint, p_score1 int, p_score2 int)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _exiger_admin();
  perform _cloturer_evenement(p_id, p_score1, p_score2, true);
end $$;

-- 6.6 Annulation : les sélections de cet évènement comptent pour une cote de 1.00.
create or replace function public.admin_annuler_evenement(p_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e evenements;
begin
  perform _exiger_admin();
  select * into e from evenements where id = p_id for update;
  if e.id is null then raise exception 'Évènement introuvable.'; end if;
  if e.statut <> 'ouvert' then raise exception 'Cet évènement est déjà terminé ou annulé.'; end if;
  update evenements set statut = 'annule' where id = e.id;
  perform _regler_evenement(e.id);
end $$;

-- 6.7 Suppression : seulement si personne n'a joué dessus.
create or replace function public.admin_supprimer_evenement(p_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _exiger_admin();
  if exists (select 1 from ticket_selections where evenement_id = p_id) or exists (select 1 from pronostics where evenement_id = p_id) then
    raise exception 'Des paris existent sur cet évènement : annule-le plutôt.';
  end if;
  delete from evenements where id = p_id;
end $$;


-- =====================================================================
-- 7. PARIS
-- =====================================================================
-- p_selections : [{"evenement_id": 12, "choix": "1"}, {"evenement_id": 15, "choix": "po"}]
-- Les cotes viennent de la base, jamais du navigateur.
create or replace function public.placer_pari(p_selections jsonb, p_mise bigint)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := _joueur(); x jsonb; e evenements; v_choix text; v_cote numeric; v_tot numeric := 1;
  v_ticket bigint; v_n int; v_vus bigint[] := '{}';
begin
  if p_mise is null or p_mise <= 0 then raise exception 'Entre ta mise en F.'; end if;
  if jsonb_typeof(p_selections) <> 'array' then raise exception 'Ticket invalide.'; end if;
  v_n := jsonb_array_length(p_selections);
  if v_n < 1 then raise exception 'Ton ticket est vide.'; end if;
  if v_n > 20 then raise exception '20 sélections maximum par ticket.'; end if;
  if p_mise > (select solde from profiles where id = v_id) then raise exception 'Solde insuffisant. Fais une demande de recharge.'; end if;

  insert into tickets (user_id, mise, cote) values (v_id, p_mise, 1) returning id into v_ticket;

  for x in select * from jsonb_array_elements(p_selections) loop
    v_choix := x->>'choix';
    select * into e from evenements where id = (x->>'evenement_id')::bigint;
    if e.id is null then raise exception 'Évènement introuvable.'; end if;
    if e.id = any(v_vus) then raise exception 'Un seul choix par match dans un ticket.'; end if;
    v_vus := v_vus || e.id;
    if e.statut <> 'ouvert' or e.debut <= now() then
      raise exception 'Les paris sont fermés pour %  – %.', e.equipe1, e.equipe2;
    end if;
    if not e.publie and not exists (select 1 from evenements_charges where user_id = v_id and evenement_id = e.id) then
      raise exception 'Évènement non disponible : entre son code d''abord.';
    end if;
    v_cote := _cote(e, v_choix);
    if v_cote is null then raise exception 'Ce choix n''est pas proposé pour % – %.', e.equipe1, e.equipe2; end if;
    insert into ticket_selections (ticket_id, evenement_id, equipe1, equipe2, choix, libelle, cote)
    values (v_ticket, e.id, e.equipe1, e.equipe2, v_choix, _libelle(v_choix), v_cote);
    v_tot := v_tot * v_cote;
  end loop;

  update tickets set cote = v_tot where id = v_ticket;
  perform _mouvement(v_id, -p_mise, 'pari', 'T' || v_ticket);
  return v_ticket;
end $$;

-- Annuler sa mise : possible tant qu'aucun match du ticket n'a commencé. La mise est remboursée.
-- Valable pour tous les comptes, y compris l'administrateur.
create or replace function public.annuler_pari(p_ticket bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := _joueur(); t tickets;
begin
  select * into t from tickets where id = p_ticket and user_id = v_id for update;
  if t.id is null then raise exception 'Ticket introuvable.'; end if;
  if t.statut <> 'cours' then raise exception 'Ce pari ne peut plus être annulé.'; end if;
  if exists (select 1 from ticket_selections s join evenements e on e.id = s.evenement_id
              where s.ticket_id = t.id and (e.debut <= now() or e.statut <> 'ouvert')) then
    raise exception 'Un match de ce ticket a déjà commencé : la mise ne peut plus être annulée.';
  end if;
  update tickets set statut = 'annule', gain = 0, regle_le = now() where id = t.id;
  perform _mouvement(v_id, t.mise, 'annulation', 'T' || t.id);
end $$;

-- Combiné du jour : le choix le plus favorable (cote 1X2 la plus basse) des matchs publics
-- qui commencent dans les 24 prochaines heures (4 maximum).
create or replace function public.combine_du_jour()
returns table (evenement_id bigint, equipe1 text, equipe2 text, choix text, libelle text, cote numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.equipe1, e.equipe2,
         case when least(e.q1, e.qx, e.q2) = e.q1 then '1' when least(e.q1, e.qx, e.q2) = e.qx then 'X' else '2' end,
         case when least(e.q1, e.qx, e.q2) = e.q1 then 'V1' when least(e.q1, e.qx, e.q2) = e.qx then 'X' else 'V2' end,
         least(e.q1, e.qx, e.q2)
    from evenements e
   where e.publie and e.statut = 'ouvert' and e.debut > now() and e.debut < now() + interval '24 hours'
   order by e.debut limit 4
$$;


-- =====================================================================
-- 8. PRONOSTIC DU JOUR
--    Règle : score final DIFFÉRENT du pronostic = gagné ; score EXACT = perdu.
-- =====================================================================
create or replace function public.admin_publier_pronostic(p_evenement bigint, p_score1 int, p_score2 int, p_cote numeric)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare e evenements; v_id bigint;
begin
  perform _exiger_admin();
  select * into e from evenements where id = p_evenement;
  if e.id is null or e.statut = 'annule' then raise exception 'Évènement introuvable.'; end if;
  if p_score1 is null or p_score2 is null or p_score1 < 0 or p_score2 < 0 or not (p_cote > 1) then
    raise exception 'Choisis le match, le score et une cote supérieure à 1.';
  end if;
  if exists (select 1 from pronostics where statut = 'ouvert') then
    raise exception 'Un pronostic est déjà ouvert : termine-le d''abord.';
  end if;
  insert into pronostics (evenement_id, equipe1, equipe2, score1, score2, cote)
  values (e.id, e.equipe1, e.equipe2, p_score1, p_score2, p_cote) returning id into v_id;
  return v_id;
end $$;

create or replace function public.participer_pronostic(p_pronostic bigint, p_mise bigint)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := _joueur(); p pronostics; ev evenements; v_part bigint;
begin
  select * into p from pronostics where id = p_pronostic;
  if p.id is null or p.statut <> 'ouvert' then raise exception 'Ce pronostic est terminé.'; end if;
  select * into ev from evenements where id = p.evenement_id;
  if ev.debut <= now() then raise exception 'Le match a commencé : participation fermée.'; end if;
  if p_mise is null or p_mise <= 0 then raise exception 'Entre ta mise en F.'; end if;
  if exists (select 1 from participations where pronostic_id = p.id and user_id = v_id and statut <> 'annule') then
    raise exception 'Tu participes déjà à ce pronostic.';
  end if;
  if p_mise > (select solde from profiles where id = v_id) then raise exception 'Solde insuffisant. Fais une demande de recharge.'; end if;
  insert into participations (pronostic_id, user_id, mise, cote) values (p.id, v_id, p_mise, p.cote) returning id into v_part;
  perform _mouvement(v_id, -p_mise, 'pronostic_mise', 'R' || v_part);
  return v_part;
end $$;

-- Score final : gains crédités (score différent) ou mises perdues (score exact).
create or replace function public.admin_cloturer_pronostic(p_id bigint, p_final1 int, p_final2 int)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p pronostics; r record;
begin
  perform _exiger_admin();
  if p_final1 is null or p_final2 is null or p_final1 < 0 or p_final2 < 0 then raise exception 'Saisis le score final.'; end if;
  select * into p from pronostics where id = p_id for update;
  if p.id is null or p.statut <> 'ouvert' then raise exception 'Pronostic introuvable ou déjà terminé.'; end if;
  update pronostics set statut = 'clos', final1 = p_final1, final2 = p_final2 where id = p.id;
  for r in select * from participations where pronostic_id = p.id and statut = 'cours' for update loop
    if (p_final1, p_final2) <> (p.score1, p.score2) then
      update participations set statut = 'gagne' where id = r.id;
      perform _mouvement(r.user_id, round(r.mise * r.cote), 'pronostic_gain', 'R' || r.id);
    else
      update participations set statut = 'perdu' where id = r.id;
    end if;
  end loop;
end $$;

-- « Rembourser tout » : les mises perdues reviennent dans les comptes, sans gain.
create or replace function public.admin_rembourser_pronostic(p_id bigint)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  perform _exiger_admin();
  if not exists (select 1 from pronostics where id = p_id and statut = 'clos') then
    raise exception 'Le pronostic doit être terminé.';
  end if;
  for r in select * from participations where pronostic_id = p_id and statut = 'perdu' for update loop
    update participations set statut = 'rembourse' where id = r.id;
    perform _mouvement(r.user_id, r.mise, 'pronostic_remboursement', 'R' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;


-- Annuler sa participation au pronostic : possible tant que le match n'a pas commencé.
create or replace function public.annuler_participation(p_participation bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := _joueur(); r participations; ev evenements;
begin
  select * into r from participations where id = p_participation and user_id = v_id for update;
  if r.id is null then raise exception 'Participation introuvable.'; end if;
  if r.statut <> 'cours' then raise exception 'Cette participation ne peut plus être annulée.'; end if;
  select e.* into ev from pronostics p join evenements e on e.id = p.evenement_id where p.id = r.pronostic_id;
  if ev.debut <= now() then raise exception 'Le match a commencé : la mise ne peut plus être annulée.'; end if;
  update participations set statut = 'annule' where id = r.id;
  perform _mouvement(v_id, r.mise, 'annulation', 'R' || r.id);
end $$;

-- =====================================================================
-- 9. ADMINISTRATION
-- =====================================================================

-- 9.1 Ajouter (montant > 0) ou retirer (montant < 0) un montant sur un compte joueur
create or replace function public.admin_ajuster_solde(p_uid uuid, p_montant bigint)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare p profiles;
begin
  perform _exiger_admin();
  select * into p from profiles where id = p_uid;
  if p.id is null then raise exception 'Compte introuvable.'; end if;
  if p.is_admin then raise exception 'Le compte administrateur ne peut pas être modifié.'; end if;
  if p_montant is null or p_montant = 0 then raise exception 'Entre un montant supérieur à 0.'; end if;
  if p_montant < 0 and -p_montant > p.solde then raise exception 'Solde insuffisant : % F.', p.solde; end if;
  return _mouvement(p_uid, p_montant, 'ajustement_admin', 'admin');
end $$;

-- 9.2 Bloquer / débloquer (un compte bloqué ne peut plus se connecter ni jouer)
create or replace function public.admin_bloquer(p_uid uuid, p_bloque boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _exiger_admin();
  if exists (select 1 from profiles where id = p_uid and is_admin) then raise exception 'Le compte administrateur ne peut pas être bloqué.'; end if;
  update profiles set bloque = p_bloque where id = p_uid;
  update auth.users set banned_until = case when p_bloque then 'infinity'::timestamptz else null end where id = p_uid;
end $$;

-- 9.3 Supprimer un compte : ses demandes en attente sont refusées, ses filleuls sont détachés.
create or replace function public.admin_supprimer_compte(p_uid uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _exiger_admin();
  if exists (select 1 from profiles where id = p_uid and is_admin) then raise exception 'Le compte administrateur ne peut pas être supprimé.'; end if;
  if not exists (select 1 from profiles where id = p_uid) then raise exception 'Compte introuvable.'; end if;
  update demandes set statut = 'refuse', traite_par = auth.uid(), traite_le = now() where user_id = p_uid and statut = 'attente';
  update profiles set parrain_id = null, parrain_code = null where parrain_id = p_uid;
  delete from auth.users where id = p_uid;               -- le profil disparaît avec (cascade)
end $$;

-- 9.4 Réglages : parrainage, retrait, recharge
create or replace function public.admin_maj_reglages(
  p_p1 numeric, p_p2 numeric, p_p3 numeric,
  p_frais numeric, p_retrait_min bigint, p_heure_debut int, p_heure_fin int,
  p_lien text, p_depot_min bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _exiger_admin();
  if not (p_heure_debut >= 0 and p_heure_fin <= 24 and p_heure_debut < p_heure_fin) then
    raise exception 'Heures invalides : l''ouverture doit être avant la fermeture (de 0 à 24).';
  end if;
  if coalesce(trim(p_lien),'') <> '' and trim(p_lien) !~* '^https?://' then raise exception 'Le lien doit commencer par https://'; end if;
  update reglages set
    p1 = p_p1, p2 = p_p2, p3 = p_p3,
    retrait_frais_pct = p_frais, retrait_min = greatest(0, p_retrait_min),
    retrait_heure_debut = p_heure_debut, retrait_heure_fin = p_heure_fin,
    lien_paiement = trim(coalesce(p_lien,'')), depot_min = greatest(0, p_depot_min)
  where id = 1;
end $$;

-- 9.5 Tableau de bord
create or replace function public.admin_tableau_de_bord()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare j jsonb;
begin
  perform _exiger_admin();
  select jsonb_build_object(
    'total_recharge',   coalesce((select sum(montant) from demandes where type='recharge' and statut='valide'), 0),
    'total_retire',     coalesce((select sum(montant) from demandes where type='retrait'  and statut='valide'), 0),
    'gagne',            coalesce((select sum(gain) from tickets where statut='gagne'), 0)
                      + coalesce((select sum(round(mise*cote)) from participations where statut='gagne'), 0),
    'nb_gagnes',        (select count(*) from tickets where statut='gagne') + (select count(*) from participations where statut='gagne'),
    'perdu',            coalesce((select sum(mise) from tickets where statut='perdu'), 0)
                      + coalesce((select sum(mise) from participations where statut='perdu'), 0),
    'nb_perdus',        (select count(*) from tickets where statut='perdu') + (select count(*) from participations where statut='perdu'),
    'depots_attente',   (select count(*) from demandes where type='recharge' and statut='attente'),
    'depots_attente_montant',  coalesce((select sum(montant) from demandes where type='recharge' and statut='attente'), 0),
    'retraits_attente', (select count(*) from demandes where type='retrait' and statut='attente'),
    'retraits_attente_montant', coalesce((select sum(montant) from demandes where type='retrait' and statut='attente'), 0)
  ) into j;
  return j;
end $$;


-- =====================================================================
-- 10. SÉCURITÉ : RLS ET DROITS
-- =====================================================================
alter table public.reglages            enable row level security;
alter table public.profiles            enable row level security;
alter table public.transactions        enable row level security;
alter table public.demandes            enable row level security;
alter table public.bonus_parrainage    enable row level security;
alter table public.evenements          enable row level security;
alter table public.evenements_charges  enable row level security;
alter table public.tickets             enable row level security;
alter table public.ticket_selections   enable row level security;
alter table public.pronostics          enable row level security;
alter table public.participations      enable row level security;

-- Lecture seulement. Toutes les écritures passent par les fonctions ci-dessus.
drop policy if exists lire_reglages      on public.reglages;
drop policy if exists lire_profil        on public.profiles;
drop policy if exists lire_transactions  on public.transactions;
drop policy if exists lire_demandes      on public.demandes;
drop policy if exists lire_evenements    on public.evenements;
drop policy if exists lire_charges       on public.evenements_charges;
drop policy if exists lire_tickets       on public.tickets;
drop policy if exists lire_selections    on public.ticket_selections;
drop policy if exists lire_pronostics    on public.pronostics;
drop policy if exists lire_participations on public.participations;

create policy lire_reglages      on public.reglages for select to authenticated using (true);
create policy lire_profil        on public.profiles for select to authenticated using (id = auth.uid() or est_admin());
create policy lire_transactions  on public.transactions for select to authenticated using (user_id = auth.uid() or est_admin());
create policy lire_demandes      on public.demandes for select to authenticated using (user_id = auth.uid() or est_admin());
create policy lire_evenements    on public.evenements for select to authenticated using (
  publie or est_admin() or exists (select 1 from public.evenements_charges c where c.user_id = auth.uid() and c.evenement_id = evenements.id));
create policy lire_charges       on public.evenements_charges for select to authenticated using (user_id = auth.uid());
create policy lire_tickets       on public.tickets for select to authenticated using (user_id = auth.uid() or est_admin());
create policy lire_selections    on public.ticket_selections for select to authenticated using (
  est_admin() or exists (select 1 from public.tickets t where t.id = ticket_id and t.user_id = auth.uid()));
create policy lire_pronostics    on public.pronostics for select to authenticated using (true);
create policy lire_participations on public.participations for select to authenticated using (user_id = auth.uid() or est_admin());

revoke all on all tables in schema public from anon, authenticated;
grant select on public.reglages, public.profiles, public.transactions, public.demandes, public.evenements,
                public.evenements_charges, public.tickets, public.ticket_selections,
                public.pronostics, public.participations to authenticated;
-- bonus_parrainage : lisible uniquement via mes_bonus()

-- Fonctions : rien n'est appelable par défaut, on ouvre seulement ce qui doit l'être.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.email_connexion(text)                       to anon, authenticated;
grant execute on function public.retraits_ouverts()                          to authenticated;
grant execute on function public.est_admin()                                 to authenticated;
-- joueur
grant execute on function public.maj_profil(text,text,text,text,text,text)   to authenticated;
grant execute on function public.demander_recharge(bigint,text,text,text,text,text) to authenticated;
grant execute on function public.demander_retrait(bigint,text,text,text,text)       to authenticated;
grant execute on function public.arbre_parrainage()                          to authenticated;
grant execute on function public.mes_bonus()                                 to authenticated;
grant execute on function public.charger_evenement(text)                     to authenticated;
grant execute on function public.placer_pari(jsonb,bigint)                   to authenticated;
grant execute on function public.combine_du_jour()                           to authenticated;
grant execute on function public.participer_pronostic(bigint,bigint)         to authenticated;
grant execute on function public.annuler_pari(bigint)                        to authenticated;
grant execute on function public.annuler_participation(bigint)               to authenticated;
-- admin (chaque fonction vérifie aussi est_admin())
grant execute on function public.admin_traiter_demande(bigint,text)          to authenticated;
grant execute on function public.admin_resultat_evenement(bigint,int,int)    to authenticated;
grant execute on function public.admin_annuler_evenement(bigint)             to authenticated;
grant execute on function public.admin_supprimer_evenement(bigint)           to authenticated;
grant execute on function public.admin_publier_pronostic(bigint,int,int,numeric) to authenticated;
grant execute on function public.admin_cloturer_pronostic(bigint,int,int)    to authenticated;
grant execute on function public.admin_rembourser_pronostic(bigint)          to authenticated;
grant execute on function public.admin_ajuster_solde(uuid,bigint)            to authenticated;
grant execute on function public.admin_bloquer(uuid,boolean)                 to authenticated;
grant execute on function public.admin_supprimer_compte(uuid)                to authenticated;
grant execute on function public.admin_maj_reglages(numeric,numeric,numeric,numeric,bigint,int,int,text,bigint) to authenticated;
grant execute on function public.admin_tableau_de_bord()                     to authenticated;

-- API : seulement la clé « service_role » (jamais le navigateur)
grant execute on function public.api_importer_evenement(text,text,text,text,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to service_role;
grant execute on function public.api_resultat_evenement(text,int,int)        to service_role;
grant execute on function public.api_annuler_evenement(text)                 to service_role;

-- Fin du script.
