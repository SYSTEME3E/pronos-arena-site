function lire(k,d){try{var v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
// Le navigateur ne garde que le strict nécessaire : connexion, thème, favoris, ticket en cours et message flash.
// Soldes, tickets, comptes, demandes… viennent toujours de Supabase et ne sont plus stockés dans le navigateur.
var GARDE=["sbauth","theme","favs","coupon","flash"];
function ecrire(k,v){if(GARDE.indexOf(k)<0)return;try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
// Efface ce que les anciennes versions avaient enregistré (faux compte admin, soldes, comptes, demandes…).
(function(){try{Object.keys(localStorage).forEach(function(k){if(GARDE.indexOf(k)<0)localStorage.removeItem(k)})}catch(e){}})();
var coupon=lire("coupon",{}),favs=lire("favs",{}),hist=lire("hist",[]),sess=lire("sess",null),comptes=lire("comptes",[]),demandes=lire("demandes",[]),bons=lire("bons",[]),pronostic=lire("pronostic",null),parts=lire("parts",[]),EV=lire("events",[]),evcodes=lire("evcodes",[]),CONFIG=lire("config",{p1:10,p2:5,p3:2,pr:5,lien:"",minDep:0,minRet:0,hd:10,hf:18}),solde=0;
if(CONFIG.pr===undefined)CONFIG.pr=5;if(CONFIG.lien===undefined)CONFIG.lien="";if(CONFIG.minDep===undefined)CONFIG.minDep=0;if(CONFIG.minRet===undefined)CONFIG.minRet=0;if(CONFIG.hd===undefined)CONFIG.hd=10;if(CONFIG.hf===undefined)CONFIG.hf=18;
solde=(sess||{}).solde||0;
// Un administrateur n’a accès qu’au panneau d’administration : toute autre page le renvoie vers admin.html.
function gardeAdmin(){
 if(!sess||!sess.is_admin)return;
 if(/\/admin(\.html)?$/.test(location.pathname)||location.pathname.indexOf("connexion")>-1)return;
 location.replace("admin.html?t=accueil")}
gardeAdmin();

var $=function(i){return document.getElementById(i)};
function pad(n){return String(n).padStart(2,"0")}
// Les cotes s’affichent en % : 1.5 devient « 1,5 % » (gain = mise + mise x cote / 100).
function fc(q){return String(+(+q).toFixed(2)).replace(".",",")+" %"}
// Logos : uniquement des images hébergées par api-sports (même règle que côté serveur).
function logoSur(u){return typeof u==="string"&&/^https:\/\/media[a-z0-9.-]*\.api-sports\.io\/[A-Za-z0-9\/_.-]+$/.test(u)?u:""}
function ini(t){return t.split(" ").map(function(x){return x[0]}).join("").slice(0,2).toUpperCase()}
function toast(m){var t=$("toast");t.textContent=m;t.style.display="block";clearTimeout(t._h);t._h=setTimeout(function(){t.style.display="none"},2200)}
function find(id){return EV.filter(function(m){return m.id==id})[0]}
// Évènements : créés par l’admin. « ouvert » = paris acceptés jusqu’au coup d’envoi.
function ouvert(m){return !!m&&m.st==="ouvert"&&m.start>Date.now()}
function visibles(){return EV.filter(function(m){return m.st==="ouvert"&&(m.pub||evcodes.indexOf(m.id)>-1)}).sort(function(x,y){return x.start-y.start})}
function avant(){return visibles().filter(ouvert)}
function direct(){return visibles().filter(function(m){return m.start<=Date.now()})}
function dcq(a,b){return Math.max(1.05,+(1/(1/a+1/b)*0.93).toFixed(2))}
// Marchés proposés pour un évènement (selon les cotes saisies par l’admin).
function marches(m){
 var q=m.q||{},r=[];
 r.push({id:"r",t:"Résultat 1X2",pop:1,tot:0,cols:3,o:[{k:"1",lb:"V1",q:q["1"]},{k:"X",lb:"X",q:q.X},{k:"2",lb:"V2",q:q["2"]}]});
 r.push({id:"dc",t:"Double chance",pop:1,tot:0,cols:3,o:[{k:"1X",lb:"1X",q:dcq(q["1"],q.X)},{k:"12",lb:"12",q:dcq(q["1"],q["2"])},{k:"X2",lb:"X2",q:dcq(q.X,q["2"])}]});
 if(q.bo&&q.bn)r.push({id:"bt",t:"Les deux équipes marquent",pop:1,tot:0,cols:2,o:[{k:"bo",lb:"Oui",q:q.bo},{k:"bn",lb:"Non",q:q.bn}]});
 if(q.po&&q.pu)r.push({id:"to",t:"Total de buts",pop:0,tot:1,cols:2,o:[{k:"po",lb:"Plus 2.5",q:q.po},{k:"pu",lb:"Moins 2.5",q:q.pu}]});
 return r}
// Résultat d’un choix selon le score final (a = équipe 1, b = équipe 2).
function evalk(k,a,b){
 switch(k){case "1":return a>b;case "X":return a===b;case "2":return a<b;case "1X":return a>=b;case "12":return a!==b;case "X2":return a<=b;
  case "bo":return a>0&&b>0;case "bn":return !(a>0&&b>0);case "po":return a+b>=3;case "pu":return a+b<=2}
 return false}
function couleur(n){var h=0;for(var i=0;i<n.length;i++)h=(h*31+n.charCodeAt(i))%360;return "hsl("+h+",55%,40%)"}
function combine(){
 return avant().filter(function(m){return m.pub&&m.start-Date.now()<864e5}).slice(0,4).map(function(m){
  var q=m.q,k=["1","X","2"].sort(function(x,y){return q[x]-q[y]})[0];
  return {m:m,k:k,lb:{"1":"V1",X:"X","2":"V2"}[k],q:q[k]}})}
// Les entrées du ticket qui ne sont plus valables (évènement supprimé ou commencé) sont retirées.
// (le tri des matchs fermés se fait dans chargerCoeur, une fois les matchs chargés : trier ici viderait tout le ticket, car EV est encore vide)
Object.keys(coupon).forEach(function(i){if(!coupon[i]||coupon[i].k===undefined)delete coupon[i]});
function mesTickets(){return hist.filter(function(t){return sess&&t.uid===sess.id})}
// Logo : affiche l’image si l’API fournit une adresse (m.la / m.lb), sinon les initiales.
function lg(n,c,u){return '<span class="lg" style="background:'+(c||couleur(n))+'">'+ini(n)+(u?'<img class="lgi" src="'+u+'" alt="" onerror="this.remove()">':'')+'</span>'}

function carte(m){
 var h='<div class="card"><div class="lig"><span>'+esc(m.l)+'</span><button class="fav'+(favs[m.id]?" on":"")+'" data-f="'+m.id+'" aria-label="Favori">'+(favs[m.id]?"★":"☆")+'</button></div>'+
 '<a class="vs" href="match.html?id='+m.id+'" data-p="match" data-id="'+m.id+'" style="text-decoration:none;color:inherit"><div class="eq">'+lg(m.a,m.ca,m.la)+'<span>'+esc(m.a)+'</span></div><span class="j">VS</span><div class="eq"><span>'+esc(m.b)+'</span>'+lg(m.b,m.cb,m.lb)+'</div></a>'+
 '<div class="cd"><span data-cd="'+m.id+'"></span><p>'+(ouvert(m)?"Paris d’avant-match":"Match en cours")+'</p></div><div class="t12">1X2</div><div class="cotes">';
 [["1","V1"],["X","X"],["2","V2"]].forEach(function(x){
  var on=coupon[m.id]&&coupon[m.id].k===x[0];
  h+='<button class="cote" data-m="'+m.id+'" data-k="'+x[0]+'" data-lb="'+x[1]+'" data-q="'+m.q[x[0]]+'" aria-pressed="'+!!on+'"><span>'+x[1]+'</span><b>'+fc(m.q[x[0]])+'</b></button>'});
 return h+'</div></div>'}

function fmtCd(s){var j=Math.floor(s/86400);s%=86400;return (j?'<b>'+j+'j</b>':'')+'<b>'+pad(Math.floor(s/3600))+'</b>:<b>'+pad(Math.floor(s%3600/60))+'</b>:<b>'+pad(s%60)+'</b>'}
function tic(){EV.forEach(function(m){var e=document.querySelector('[data-cd="'+m.id+'"]');if(!e)return;
 var s=Math.max(0,Math.floor((m.start-Date.now())/1000));e.innerHTML=fmtCd(s);
 if(s===0&&!m._f){m._f=1;if(window.rendre)rendre()}})}
setInterval(tic,1000);

function entete(){
 return '<div class="prof"><div class="av"><svg width="28" height="28" viewBox="0 0 24 24" fill="#8f9bc4"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg></div>'+
 '<div class="who"><b>'+(sess?sess.pseudo:"Joueur")+'</b><span>Profil personnel</span></div>'+
 '<button class="ic" data-thm aria-label="Mode sombre ou clair"><span class="ti">'+iconeTheme()+'</span></button></div>'+
 '<div class="bar"><div class="solde"><span>'+solde+' <span class="j">F</span></span></div><button class="dep" id="dep">+ Recharger</button></div>'+
 '<div class="stats"><div class="st"><small>Gains semaine</small><b class="j">'+gains()+'</b></div><div class="st"><small>Paris gagnés</small><b class="b">'+mesTickets().filter(function(t){return t.st==="gagne"}).length+'</b></div><div class="st"><small>Paris en cours</small><b class="r">'+mesTickets().filter(function(t){return t.st==="cours"}).length+'</b></div></div>'}

function badge(){var n=Object.keys(coupon).length,e=$("cpn");if(e){e.textContent=n;e.style.display=n?"block":"none"}}
function nav(p){
 var N=[["index","Populaire",'<path d="M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-9z"/>'],
 ["favoris","Favoris",'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'],["ticket","Ticket",""],
 ["historique","Historique",'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" style="stroke:var(--bg2)" stroke-width="2" fill="none"/>'],
 ["menu","Menu",'<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>']];
 window.NAVP=p;var adm=!!(sess&&sess.is_admin);
 $("nb").className=adm?"adm":"";
 $("nb").innerHTML=(adm?'<button class="nv bg" id="bg" aria-label="Menu administration"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>':'')+(adm?"":N.map(function(n){var h=n[0]+".html",cur=n[0]===p?' aria-current="true"':'';
  if(n[0]==="ticket")return '<a class="nv cp" href="'+h+'" aria-label="Ticket"'+cur+'><span class="rond"><svg width="30" height="30" viewBox="0 0 24 24" fill="#fff"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/></svg><em id="cpn" style="display:none">0</em></span>Ticket</a>';
  return '<a class="nv" href="'+h+'"'+cur+'><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">'+n[2]+'</svg>'+n[1]+'</a>'}).join(""));
 badge();if(adm)tiroir()}
// Menu 3 barres de l’administrateur : les pages d’administration s’ouvrent depuis ce tiroir.
function tiroir(){
 var ex=$("tir");if(ex)ex.remove();
 var na=demandes.filter(function(x){return x.st==="attente"}).length;
 var L=[["accueil","Tableau de bord"],["demandes","Dépôts et retraits"+(na?" ("+na+")":"")],["comptes","Comptes"],["events","Évènements et résultats"],["prono","Pronostic du jour"],["regl","Réglages"]];
 var d=document.createElement("div");d.id="tir";d.innerHTML='<div class="vo" id="tvo"></div><aside class="pan"><div class="th"><b>Administration</b><button class="ic" id="tfe" aria-label="Fermer">✕</button></div>'+
  L.map(function(x){return '<a class="dir" href="admin.html?t='+x[0]+'" style="text-decoration:none;color:inherit"><span class="nom">'+x[1]+'</span><span>›</span></a>'}).join("")+
  '<a class="dir" href="#" id="tdc" style="text-decoration:none;color:inherit"><span class="nom">Déconnexion</span><span>›</span></a></aside>';
 document.body.appendChild(d)}
document.addEventListener("click",function(ev){
 if(ev.target.closest("#tdc")){ev.preventDefault();quitter();return}
 if(ev.target.closest("#bg")){$("tir").classList.add("ouv");return}
 if(ev.target.closest("#tvo")||ev.target.closest("#tfe")){$("tir").classList.remove("ouv");return}
 var c=ev.target.closest(".cote"),f=ev.target.closest(".fav");
 if(ev.target.closest("[data-thm]"))basculer();
 if(ev.target.closest("#pp"))participer();
 if(ev.target.closest("#dep"))location.href="recharge.html";
 if(c){var id=+c.dataset.m,ent={k:c.dataset.k,lb:c.dataset.lb,q:+c.dataset.q},cur=coupon[id];
  if(!ouvert(find(id))){toast("Les paris sont fermés pour ce match.");return}
  if(cur&&cur.k===ent.k)delete coupon[id];else coupon[id]=ent;ecrire("coupon",coupon);badge();if(window.rendre)rendre()}
 if(f){var k=+f.dataset.f;favs[k]=!favs[k];ecrire("favs",favs);if(window.rendre)rendre()}});

function gains(){var d=Date.now()-6048e5;return mesTickets().filter(function(t){return t.st==="gagne"&&(t.tsr||0)>=d}).reduce(function(s,t){return s+gainT(t)},0)}
function carteTicket(t){
 var etat=t.st==="cours"?'<b class="j">● En cours</b>':t.st==="gagne"?'<b class="v">Gagné</b>':t.st==="rembourse"?'<b class="b">Remboursé</b>':t.st==="annule"?'<b class="b">Annulé</b>':'<b class="r">Perdu</b>';
 var sr=function(s){return s.r===true?' <b class="v">✓</b>':s.r===false?' <b class="r">✗</b>':s.r==="annule"?' <small>(annulé)</small>':''};
 return '<article class="match"><div class="meta"><span>Ticket '+t.id+' – '+t.date+'</span>'+etat+'</div>'+
 t.sel.map(function(s){return '<div class="ligne"><span>'+esc(s.a)+' – '+esc(s.b)+' ('+esc(s.lb)+')'+(t.pp?'':sr(s))+'</span><b class="j">'+fc(s.q)+'</b></div>'}).join("")+
 '<div class="ligne"><span>Mise</span><b>'+t.mise+' F</b></div>'+
 (t.st==="perdu"||t.st==="rembourse"||t.st==="annule"?'':'<div class="ligne"><span>'+(t.st==="gagne"?"Gain":"Gain possible")+'</span><b class="j">'+gainT(t)+' F</b></div>')+(peutAnnuler(t)?'<button class="tout" style="margin-top:10px" data-an="'+t.id+'">Annuler ma mise</button>':'')+'</article>'}
// Une mise peut être annulée tant qu’aucun des matchs du ticket n’a commencé.
function peutAnnuler(t){
 if(t.st!=="cours")return false;
 if(t.pp)return !!pronostic&&pronostic.id===t.pid&&ouvert(find(pronostic.mid));
 return t.sel.every(function(x){return ouvert(find(x.eid))})}

function sauver(){}
var RETOUR=(sess&&sess.is_admin)?'':'<a href="menu.html" data-p="menu" class="tout" style="text-decoration:none;color:inherit;display:inline-block;margin-top:12px">← Menu</a>';

function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function banniereRetrait(){
 var o=retraitOuvert();
 return '<div class="fiche"><div class="ligne" style="border:0;padding:0"><b class="'+(o?"v":"r")+'">'+(o?"● Retraits ouverts":"● Retraits fermés")+'</b><span>de '+CONFIG.hd+'h à '+CONFIG.hf+'h</span></div>'+
  (o?'':'<small style="color:var(--mute)">Reviens à partir de '+CONFIG.hd+'h pour envoyer ta demande.</small>')+
  (CONFIG.minRet>0?'<div class="ligne" style="border:0;padding:6px 0 0"><span>Retrait minimum</span><b>'+CONFIG.minRet+' F</b></div>':'')+'</div>'}
function carteDemande(d,adm){
 var et=d.st==="attente"?'<b class="j">● En attente</b>':d.st==="valide"?'<b class="v">Validée</b>':'<b class="r">Refusée</b>';
 return '<article class="match"><div class="meta"><span>'+(d.type==="retrait"?"Retrait":"Recharge")+' – '+esc(d.date)+'</span>'+et+'</div>'+
 '<div class="ligne"><span>Montant</span><b class="j">'+esc(d.montant)+' F</b></div>'+
 (d.reseau?'<div class="ligne"><span>Réseau</span><b>'+esc(d.reseau)+'</b></div>':'')+
 (d.type!=="retrait"&&d.preuve?'<div class="ligne" style="display:block"><span>Preuve de paiement</span><div style="margin-top:4px;white-space:pre-wrap;word-break:break-word">'+esc(d.preuve)+'</div></div>':'')+
 (d.type==="retrait"&&d.frais!==undefined?'<div class="ligne"><span>Frais ('+esc(d.pr)+' %)</span><b class="r">− '+esc(d.frais)+' F</b></div><div class="ligne"><span>'+(adm?"À envoyer au joueur":"Tu reçois")+'</span><b class="j">'+esc(d.net)+' F</b></div>':'')+
 (adm?'<div class="ligne"><span>Joueur</span><b>'+esc(d.pseudo)+'</b></div><div class="ligne"><span>Nom et prénom</span><b>'+esc(d.prenom)+' '+esc(d.nom)+'</b></div><div class="ligne"><span>Numéro</span><b>'+esc(d.tel)+'</b></div>':'')+
 (adm&&d.st==="attente"?'<div style="display:flex;gap:8px;margin-top:10px"><button class="ok" data-v="valide" data-d="'+esc(d.id)+'">Valider</button><button class="tout" data-v="refuse" data-d="'+esc(d.id)+'">Refuser</button></div>':'')+'</article>'}


function theme(){return document.documentElement.getAttribute("data-theme")==="light"?"light":"dark"}
function iconeTheme(){return theme()==="dark"?'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>':'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'}
function basculer(){
 var n=theme()==="dark"?"light":"dark";document.documentElement.setAttribute("data-theme",n);ecrire("theme",n);
 [].forEach.call(document.querySelectorAll("[data-thm] .ti"),function(e){e.innerHTML=iconeTheme()});
 [].forEach.call(document.querySelectorAll("[data-thm] .tl"),function(e){e.textContent=n==="dark"?"Passer en mode clair":"Passer en mode sombre"})}
document.documentElement.setAttribute("data-theme",lire("theme","dark")==="light"?"light":"dark");

function tousTickets(){
 return mesTickets().concat(parts.filter(function(p){return sess&&p.uid===sess.id}).map(function(p){
  return {id:p.id,date:p.date,sel:[{a:p.a,b:p.b,lb:"Contre le pronostic "+p.score,q:p.cote}],mise:p.mise,cote:p.cote,st:p.st,pp:1,pid:p.pid,uid:p.uid}}))}
function pronoHtml(){
 var p=pronostic;if(!p)return "";
 var mine=sess&&parts.filter(function(x){return x.pid===p.id&&x.uid===sess.id&&x.st!=="annule"})[0];
 var h='<div class="fiche" style="border-color:var(--jaune)"><div style="display:flex;justify-content:space-between"><b class="j">Pronostic du jour</b><span class="cd">'+(p.st==="clos"?"Terminé":"Ouvert")+'</span></div>'+
 '<div style="font-weight:800;margin:8px 0 2px">'+esc(p.a)+' – '+esc(p.b)+'</div>'+
 '<div class="j" style="font-size:28px;font-weight:800">'+esc(p.score.replace("-"," : "))+'</div>'+
 '<p class="leg" style="margin:6px 0 10px">Si le score final est différent de ce pronostic, tu gagnes (cote '+fc(p.cote)+'). S’il est exactement celui-ci, tu perds ta mise.</p>';
 if(p.st==="clos"){
  h+='<div class="ligne"><span>Score final</span><b>'+esc(p.final.replace("-"," : "))+'</b></div>';
  if(mine)h+='<div class="ligne"><span>Ta participation ('+mine.mise+' F)</span><b>'+{cours:"En cours",gagne:"Gagné",perdu:"Perdu",rembourse:"Remboursé",annule:"Annulé"}[mine.st]+'</b></div>'}
 else if(mine)h+='<div class="ligne"><span>Ta mise</span><b class="j">'+mine.mise+' F</b></div>';
 else h+='<div class="mise"><input id="ppm" type="number" inputmode="numeric" min="1" placeholder="Mise en F"></div><button class="ok" id="pp">Participer</button>';
 return h+'</div>'}


// ===== Supabase : connexion, données et actions (le serveur décide de tout : soldes, paris, admin) =====
var SB_URL="https://vxefmhkoojbjxtczjujo.supabase.co",
 SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4ZWZtaGtvb2pianh0Y3pqdWpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwMTYzMjMsImV4cCI6MjEwODU5MjMyM30.1W76QHjIt0lkt8PhUXYzwnni4B0yQJ9Tyvcqc3CAOe8";
var AUTH=lire("sbauth",null),DASH=lire("dash",null),ARBRE=lire("arbre",[]),RO=lire("ro",null);
if(!AUTH&&location.pathname.indexOf("connexion")<0)location.href="connexion.html";

function enteteSb(t){return {apikey:SB_KEY,Authorization:"Bearer "+(t||SB_KEY),"Content-Type":"application/json"}}
function msgErr(j,st){var m=j&&(j.message||j.msg||j.error_description||j.error);return m||("Erreur "+st)}
function garderSession(j){AUTH={at:j.access_token,rt:j.refresh_token,exp:Date.now()+(j.expires_in||3600)*1000,uid:(j.user&&j.user.id)||(AUTH&&AUTH.uid)};ecrire("sbauth",AUTH)}
var _rf=null;
function jeton(){
 if(!AUTH)return Promise.reject(new Error("Connecte-toi pour continuer."));
 if(AUTH.exp-Date.now()>60000)return Promise.resolve(AUTH.at);
 if(!_rf)_rf=fetch(SB_URL+"/auth/v1/token?grant_type=refresh_token",{method:"POST",headers:enteteSb(),body:JSON.stringify({refresh_token:AUTH.rt})})
  .then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {r:r,j:j}})})
  .then(function(x){_rf=null;if(!x.r.ok||!x.j.access_token){quitter("Session expirée. Reconnecte-toi.");throw new Error("Session expirée.")}garderSession(x.j);return AUTH.at},
   function(e){_rf=null;throw e});
 return _rf}
function sbq(path,opt,anon){
 return (anon?Promise.resolve(SB_KEY):jeton()).then(function(t){
  var o=Object.assign({headers:enteteSb(t)},opt||{});
  return fetch(SB_URL+path,o)}).then(function(r){
   return r.text().then(function(txt){var j=null;try{j=txt?JSON.parse(txt):null}catch(e){}
    if(!r.ok)throw new Error(msgErr(j,r.status));return j})})}
function rpc(nom,args,anon){return sbq("/rest/v1/rpc/"+nom,{method:"POST",body:JSON.stringify(args||{})},anon)}
function lireT(p){return sbq("/rest/v1/"+p)}

function viderCache(){["sess","comptes","hist","demandes","bons","pronostic","parts","events","evcodes","dash","arbre","ro","coupon"].forEach(function(k){try{localStorage.removeItem(k)}catch(e){}})}
function quitter(msg){viderCache();try{localStorage.removeItem("sbauth")}catch(e){}AUTH=null;sess=null;if(msg)ecrire("flash",msg);location.href="connexion.html"}

function seConnecter(ident,pw){
 return rpc("email_connexion",{p_identifiant:ident},true).then(function(mail){
  if(!mail)throw new Error("Compte introuvable. Crée un compte.");
  return fetch(SB_URL+"/auth/v1/token?grant_type=password",{method:"POST",headers:enteteSb(),body:JSON.stringify({email:mail,password:pw})})}).then(function(r){
   return r.json().catch(function(){return {}}).then(function(j){
    if(!r.ok||!j.access_token)throw new Error("Mot de passe incorrect.");
    viderCache();garderSession(j)})})}
function creerCompte(d){
 var pseudo=d.pseudo.trim();
 if(!/^[A-Za-z0-9_.-]{3,20}$/.test(pseudo))return Promise.reject(new Error("Nom d’utilisateur : 3 à 20 caractères (lettres, chiffres, _ . -)."));
 if(d.tel.replace(/\D/g,"").length<8||d.tel.replace(/\D/g,"").length>15)return Promise.reject(new Error("Numéro de téléphone invalide."));
 if(d.email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email))return Promise.reject(new Error("Adresse e-mail invalide."));
 // Un nom d’utilisateur, un numéro et une adresse e-mail ne peuvent servir qu’à un seul compte (la base le garantit aussi).
 return rpc("verifier_inscription",{p_pseudo:pseudo,p_tel:d.tel,p_email:d.email||null},true).then(function(pris){
  if(pris==="pseudo")throw new Error("Ce nom d’utilisateur est déjà pris.");
  if(pris==="tel")throw new Error("Ce numéro de téléphone est déjà utilisé.");
  if(pris==="email")throw new Error("Cette adresse e-mail est déjà utilisée.");
  return fetch(SB_URL+"/auth/v1/signup",{method:"POST",headers:enteteSb(),body:JSON.stringify({email:pseudo.toLowerCase()+"@pronosarena.app",password:d.pw,
   data:{pseudo:pseudo,tel:d.tel,email_contact:d.email,prenom:"",nom:"",parrain_code:d.parrain}})})}).then(function(r){
    if(!r.ok)throw new Error("Inscription impossible : vérifie le code de parrainage et tes informations (nom, numéro ou e-mail déjà utilisés).");
    return seConnecter(pseudo,d.pw)})}
function changerMdp(){
 var n=prompt("Nouveau mot de passe (8 caractères minimum) :");if(n===null)return;
 if(n.length<8){toast("8 caractères minimum.");return}
 sbq("/auth/v1/user",{method:"PUT",body:JSON.stringify({password:n})}).then(function(){toast("Mot de passe modifié.")},function(e){toast(e.message)})}

function evBase(r){
 var q={"1":+r.q1,X:+r.qx,"2":+r.q2};
 if(r.q_bo&&r.q_bn){q.bo=+r.q_bo;q.bn=+r.q_bn}
 if(r.q_po&&r.q_pu){q.po=+r.q_po;q.pu=+r.q_pu}
 return {id:r.id,code:r.code,l:r.competition||"",a:r.equipe1,b:r.equipe2,start:Date.parse(r.debut),q:q,pub:!!r.publie,st:r.statut,
  res:(r.score1!=null&&r.score2!=null)?r.score1+"-"+r.score2:null,la:logoSur(r.logo1),lb:logoSur(r.logo2)}}
function dfr(t){return new Date(t).toLocaleDateString("fr-FR")}
// La cote est un pourcentage : mise 1000 F x cote 1,5 → 1000 + 1,5 % de 1000 = 1015 F.
function gainC(mise,cote){return Math.round(mise*(1+cote/100))}
function gainT(t){return t.st==="gagne"&&t.gain>0?t.gain:gainC(t.mise,t.cote)}
function arbre(){var n=[[],[],[]];(ARBRE||[]).forEach(function(x){if(n[x.niveau-1])n[x.niveau-1].push({id:x.user_id,pseudo:x.pseudo,rapporte:+x.rapporte||0})});return n}
function retraitOuvert(){if(RO!==null)return !!RO;var d=new Date(),m=d.getHours()*60+d.getMinutes();return m>=CONFIG.hd*60&&m<CONFIG.hf*60}

var _snap="",_p=null,_again=false;
function chargerCoeur(){
 var uid=AUTH.uid,depuis=new Date(Date.now()-7*864e5).toISOString();
 var ess=function(p){return lireT(p).catch(function(e){return null})};
 return Promise.all([
  ess("profiles?select=*&id=eq."+uid),
  ess("reglages?select=*&id=eq.1"),
  ess("evenements?select=id,code,competition,equipe1,equipe2,debut,q1,qx,q2,q_bo,q_bn,q_po,q_pu,publie,statut,score1,score2,logo1,logo2&debut=gte."+encodeURIComponent(depuis)+"&order=debut.asc&limit=500"),
  ess("evenements_charges?select=evenement_id"),
  ess("tickets?select=id,user_id,mise,cote,statut,gain,created_at,regle_le,ticket_selections(evenement_id,equipe1,equipe2,choix,libelle,cote,resultat)&order=created_at.desc&limit=500"),
  ess("participations?select=id,pronostic_id,user_id,mise,cote,statut,created_at,pronostics(equipe1,equipe2,score1,score2)&order=created_at.desc&limit=500"),
  ess("pronostics?select=*&order=id.desc&limit=1"),
  ess("demandes?select=*&order=created_at.desc&limit=500"),
  rpc("mes_bonus").catch(function(){return null}),
  rpc("arbre_parrainage").catch(function(){return null}),
  rpc("retraits_ouverts").catch(function(){return null})
 ]).then(function(R){
  var p=R[0]&&R[0][0];
  if(R[0]&&!p){quitter("Compte introuvable.");return}
  if(p&&p.bloque){quitter("Ce compte est bloqué. Contacte l’administrateur.");return}
  if(p){sess={id:p.id,pseudo:p.pseudo,email:p.email||"",tel:p.tel||"",prenom:p.prenom||"",nom:p.nom||"",pays:p.pays||"",ville:p.ville||"",
   code:p.code_parrainage,parrain:p.parrain_code||"",solde:+p.solde||0,bloque:false,is_admin:!!p.is_admin,date:dfr(p.created_at)};solde=sess.solde}
  if(sess&&sess.is_admin){RETOUR="";ecrire("sess",sess);gardeAdmin()}
  var g=R[1]&&R[1][0];
  if(g)CONFIG={p1:+g.p1,p2:+g.p2,p3:+g.p3,pr:+g.retrait_frais_pct,lien:g.lien_paiement||"",minDep:+g.depot_min,minRet:+g.retrait_min,hd:+g.retrait_heure_debut,hf:+g.retrait_heure_fin};
  if(R[2]){EV=R[2].map(evBase);
   Object.keys(coupon).forEach(function(i){if(!ouvert(find(i))||coupon[i].k===undefined)delete coupon[i]});ecrire("coupon",coupon)}
  if(R[3])evcodes=R[3].map(function(x){return x.evenement_id});
  if(R[4])hist=R[4].map(function(t){
   var sel=(t.ticket_selections||[]).map(function(s){return {eid:s.evenement_id,k:s.choix,a:s.equipe1,b:s.equipe2,lb:s.libelle,q:+s.cote,
    r:s.resultat==="gagne"?true:s.resultat==="perdu"?false:s.resultat==="annule"?"annule":null}});
   return {id:"T"+t.id,tid:t.id,uid:t.user_id,ts:Date.parse(t.created_at),date:dfr(t.created_at),sel:sel,mise:+t.mise,cote:+t.cote,st:t.statut,gain:+t.gain||0,tsr:t.regle_le?Date.parse(t.regle_le):0}});
  if(R[5])parts=R[5].map(function(r){var q=r.pronostics||{};
   return {id:"R"+r.id,rid:r.id,pid:r.pronostic_id,uid:r.user_id,a:q.equipe1,b:q.equipe2,score:q.score1+"-"+q.score2,cote:+r.cote,mise:+r.mise,date:dfr(r.created_at),st:r.statut,gain:r.statut==="gagne"?gainC(r.mise,r.cote):0}});
  if(R[6]){var pr=R[6][0];pronostic=pr?{id:pr.id,mid:pr.evenement_id,a:pr.equipe1,b:pr.equipe2,score:pr.score1+"-"+pr.score2,cote:+pr.cote,st:pr.statut,final:pr.final1!=null?pr.final1+"-"+pr.final2:null}:null}
  if(R[7])demandes=R[7].map(function(d){return {id:"D"+d.id,did:d.id,type:d.type,uid:d.user_id,pseudo:d.pseudo,montant:+d.montant,reseau:d.reseau,preuve:d.preuve||"",tel:d.tel,nom:d.nom,prenom:d.prenom,
   date:dfr(d.created_at),st:d.statut,pr:d.frais_pct!=null?+d.frais_pct:undefined,frais:d.frais!=null?+d.frais:undefined,net:d.net!=null?+d.net:undefined}});
  if(R[8]&&sess)bons=R[8].map(function(b){return {id:b.id,uid:sess.id,de:b.filleul,niv:b.niveau,base:+b.base,pc:+b.pourcentage,bonus:+b.bonus,date:dfr(b.created_at)}});
  if(R[9])ARBRE=R[9];
  if(R[10]!==null)RO=!!R[10];
  var suite=Promise.resolve();
  if(sess&&sess.is_admin){
   suite=Promise.all([
    lireT("profiles?select=id,pseudo,email,tel,prenom,nom,solde,bloque,is_admin,code_parrainage,created_at&order=created_at.desc&limit=1000").catch(function(){return null}),
    rpc("admin_tableau_de_bord").catch(function(){return null})
   ]).then(function(A){
    if(A[0])comptes=A[0].map(function(c){return {id:c.id,pseudo:c.pseudo,email:c.email||"",tel:c.tel||"",prenom:c.prenom||"",nom:c.nom||"",solde:+c.solde||0,bloque:!!c.bloque,is_admin:!!c.is_admin,code:c.code_parrainage}});
    if(A[1])DASH=A[1]})}
  return suite}).then(function(){
   ["sess","config","events","evcodes","hist","parts","pronostic","demandes","bons","comptes","dash","arbre","ro"].forEach(function(k){});
   ecrire("sess",sess);ecrire("config",CONFIG);ecrire("events",EV);ecrire("evcodes",evcodes);ecrire("hist",hist);ecrire("parts",parts);
   ecrire("pronostic",pronostic);ecrire("demandes",demandes);ecrire("bons",bons);ecrire("comptes",comptes);ecrire("dash",DASH);ecrire("arbre",ARBRE);ecrire("ro",RO);
   var s=JSON.stringify([sess,CONFIG,EV,evcodes,hist,parts,pronostic,demandes,bons,ARBRE,RO,comptes,DASH]);
   if(s!==_snap){_snap=s;rafraichirUI()}})}
function charger(){
 if(!AUTH)return Promise.resolve();
 if(_p){_again=true;return _p}
 _p=chargerCoeur().catch(function(){}).then(function(){_p=null;if(_again){_again=false;return charger()}});
 return _p}
function majHaut(){var t=$("top");if(t&&t.innerHTML.trim()&&typeof entete==="function")t.innerHTML=entete()}
function rafraichirUI(){
 var a=document.activeElement;
 if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))return;
 majHaut();if(window.NAVP&&$("nb"))nav(window.NAVP);
 if(window.rendre)rendre()}
// Exécute une action serveur, recharge les données, réaffiche la page et prévient le joueur.
function agir(fn,ok){
 return Promise.resolve().then(fn).then(function(r){
  return charger().then(function(){majHaut();if(window.rendre)rendre();if(ok)toast(typeof ok==="function"?ok(r):ok);return {ok:true,r:r}})},
  function(e){toast((e&&e.message)||"Erreur.");return {ok:false}})}
function annulerMise(id){
 var t=hist.filter(function(x){return x.id===id})[0],p=false;
 if(!t){t=parts.filter(function(x){return x.id===id})[0];p=true}
 if(!t||t.st!=="cours")return Promise.resolve(false);
 if(p?!(pronostic&&pronostic.id===t.pid&&ouvert(find(pronostic.mid))):!peutAnnuler(t)){toast("Impossible : le match a commencé.");return Promise.resolve(false)}
 return agir(function(){return p?rpc("annuler_participation",{p_participation:t.rid}):rpc("annuler_pari",{p_ticket:t.tid})},"Mise annulée et remboursée.")}
function participer(){
 var p=pronostic,m=Math.floor(+($("ppm").value||0));
 if(!p||p.st!=="ouvert")return;
 if(!ouvert(find(p.mid))){toast("Le match a commencé : participation fermée.");return}
 if(!(m>0)){toast("Entre ta mise en F.");return}
 if(m>solde){toast("Solde insuffisant. Fais une demande de recharge.");return}
 agir(function(){return rpc("participer_pronostic",{p_pronostic:p.id,p_mise:m})},"Participation enregistrée.")}
charger();
setInterval(function(){if(!document.hidden)charger()},30000);
document.addEventListener("visibilitychange",function(){if(!document.hidden)charger()});

