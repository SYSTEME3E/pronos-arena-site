// Comptes administrateurs (version locale rapide)
var ADMINS=["admin","eric1"];
function pseudoAdmin(p){return ADMINS.indexOf(String(p||"").toLowerCase())>-1}
function lire(k,d){try{var v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function ecrire(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
var coupon=lire("coupon",{}),favs=lire("favs",{}),hist=lire("hist",[]),sess=lire("sess",null),comptes=lire("comptes",[]),demandes=lire("demandes",[]),bons=lire("bons",[]),pronostic=lire("pronostic",null),parts=lire("parts",[]),EV=lire("events",[]),evcodes=lire("evcodes",[]),CONFIG=lire("config",{p1:10,p2:5,p3:2,pr:5,lien:"",minDep:0,minRet:0,hd:10,hf:18}),solde=0;
if(CONFIG.pr===undefined)CONFIG.pr=5;if(CONFIG.lien===undefined)CONFIG.lien="";if(CONFIG.minDep===undefined)CONFIG.minDep=0;if(CONFIG.minRet===undefined)CONFIG.minRet=0;if(CONFIG.hd===undefined)CONFIG.hd=10;if(CONFIG.hf===undefined)CONFIG.hf=18;
if(sess){var cc=comptes.filter(function(c){return c.id===sess.id})[0];if(!cc||cc.bloque){sess=null;ecrire("sess",null)}}
solde=(lire("sess",null)||{}).solde||0;
if(!sess&&location.pathname.indexOf("connexion")<0)location.href="connexion.html";

var $=function(i){return document.getElementById(i)};
function pad(n){return String(n).padStart(2,"0")}
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
Object.keys(coupon).forEach(function(i){if(!ouvert(find(i))||coupon[i].k===undefined)delete coupon[i]});ecrire("coupon",coupon);
function mesTickets(){return hist.filter(function(t){return sess&&t.uid===sess.id})}
// Règle les tickets quand l’admin saisit un résultat (m.res) ou annule l’évènement.
function verdict(t){
 if(t.sel.some(function(s){return s.r===false})){t.st="perdu";t.tsr=Date.now();return}
 if(t.sel.some(function(s){return s.r==null}))return;
 var g=t.sel.filter(function(s){return s.r===true});t.tsr=Date.now();
 if(!g.length){t.st="rembourse";crediter(t.uid,t.mise);return}
 t.cote=g.reduce(function(p,s){return p*s.q},1);t.st="gagne";crediter(t.uid,Math.round(t.mise*t.cote))}
function reglerEvent(m){
 var ab=m.res?m.res.split("-").map(Number):null;
 hist.forEach(function(t){
  if(t.st!=="cours")return;var ch=false;
  t.sel.forEach(function(s){if(s.eid===m.id&&s.r==null){s.r=m.st==="annule"?"annule":evalk(s.k,ab[0],ab[1]);ch=true}});
  if(ch)verdict(t)});
 ecrire("hist",hist)}
// Logo : affiche l’image si l’API fournit une adresse (m.la / m.lb), sinon les initiales.
function lg(n,c,u){return '<span class="lg" style="background:'+(c||couleur(n))+'">'+ini(n)+(u?'<img class="lgi" src="'+u+'" alt="" onerror="this.remove()">':'')+'</span>'}

function carte(m){
 var h='<div class="card"><div class="lig"><span>'+esc(m.l)+'</span><button class="fav'+(favs[m.id]?" on":"")+'" data-f="'+m.id+'" aria-label="Favori">'+(favs[m.id]?"★":"☆")+'</button></div>'+
 '<a class="vs" href="match.html?id='+m.id+'" data-p="match" data-id="'+m.id+'" style="text-decoration:none;color:inherit"><div class="eq">'+lg(m.a,m.ca,m.la)+'<span>'+esc(m.a)+'</span></div><span class="j">VS</span><div class="eq"><span>'+esc(m.b)+'</span>'+lg(m.b,m.cb,m.lb)+'</div></a>'+
 '<div class="cd"><span data-cd="'+m.id+'"></span><p>'+(ouvert(m)?"Paris d’avant-match":"Match en cours")+'</p></div><div class="t12">1X2</div><div class="cotes">';
 [["1","V1"],["X","X"],["2","V2"]].forEach(function(x){
  var on=coupon[m.id]&&coupon[m.id].k===x[0];
  h+='<button class="cote" data-m="'+m.id+'" data-k="'+x[0]+'" data-lb="'+x[1]+'" data-q="'+m.q[x[0]]+'" aria-pressed="'+!!on+'"><span>'+x[1]+'</span><b>'+(+m.q[x[0]]).toFixed(2)+'</b></button>'});
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
 var adm=sess&&pseudoAdmin(sess.pseudo);
 $("nb").className=adm?"adm":"";
 $("nb").innerHTML=(adm?'<button class="nv bg" id="bg" aria-label="Menu administration"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>':'')+N.map(function(n){var h=n[0]+".html",cur=n[0]===p?' aria-current="true"':'';
  if(n[0]==="ticket")return '<a class="nv cp" href="'+h+'" aria-label="Ticket"'+cur+'><span class="rond"><svg width="30" height="30" viewBox="0 0 24 24" fill="#fff"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/></svg><em id="cpn" style="display:none">0</em></span>Ticket</a>';
  return '<a class="nv" href="'+h+'"'+cur+'><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">'+n[2]+'</svg>'+n[1]+'</a>'}).join("");
 badge();if(adm)tiroir()}
// Menu 3 barres de l’administrateur : les pages d’administration s’ouvrent depuis ce tiroir.
function tiroir(){
 var na=demandes.filter(function(x){return x.st==="attente"}).length;
 var L=[["accueil","Tableau de bord"],["demandes","Dépôts et retraits"+(na?" ("+na+")":"")],["comptes","Comptes"],["events","Évènements et résultats"],["prono","Pronostic du jour"],["regl","Réglages"]];
 var d=document.createElement("div");d.id="tir";d.innerHTML='<div class="vo" id="tvo"></div><aside class="pan"><div class="th"><b>Administration</b><button class="ic" id="tfe" aria-label="Fermer">✕</button></div>'+
  L.map(function(x){return '<a class="dir" href="admin.html?t='+x[0]+'" style="text-decoration:none;color:inherit"><span class="nom">'+x[1]+'</span><span>›</span></a>'}).join("")+'</aside>';
 document.body.appendChild(d)}
document.addEventListener("click",function(ev){
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

function gains(){var d=Date.now()-6048e5;return mesTickets().filter(function(t){return t.st==="gagne"&&(t.tsr||0)>=d}).reduce(function(s,t){return s+Math.round(t.mise*t.cote)},0)}
function carteTicket(t){
 var etat=t.st==="cours"?'<span class="live">● En cours</span>':t.st==="gagne"?'<b class="j">Gagné</b>':t.st==="rembourse"?'<b class="b">Remboursé</b>':t.st==="annule"?'<b class="b">Annulé</b>':'<b class="r">Perdu</b>';
 var sr=function(s){return s.r===true?' <b class="j">✓</b>':s.r===false?' <b class="r">✗</b>':s.r==="annule"?' <small>(annulé)</small>':''};
 return '<article class="match"><div class="meta"><span>Ticket '+t.id+' – '+t.date+'</span>'+etat+'</div>'+
 t.sel.map(function(s){return '<div class="ligne"><span>'+esc(s.a)+' – '+esc(s.b)+' ('+esc(s.lb)+')'+(t.pp?'':sr(s))+'</span><b class="j">'+s.q.toFixed(2)+'</b></div>'}).join("")+
 '<div class="ligne"><span>Mise</span><b>'+t.mise+' F</b></div>'+
 (t.st==="perdu"||t.st==="rembourse"||t.st==="annule"?'':'<div class="ligne"><span>'+(t.st==="gagne"?"Gain":"Gain possible")+'</span><b class="j">'+Math.round(t.mise*t.cote)+' F</b></div>')+(peutAnnuler(t)?'<button class="tout" style="margin-top:10px" data-an="'+t.id+'">Annuler ma mise</button>':'')+'</article>'}
// Une mise peut être annulée tant qu’aucun des matchs du ticket n’a commencé.
function peutAnnuler(t){
 if(t.st!=="cours")return false;
 if(t.pp)return !!pronostic&&pronostic.id===t.pid&&ouvert(find(pronostic.mid));
 return t.sel.every(function(x){return ouvert(find(x.eid))})}
function annulerMise(id){
 var t=hist.filter(function(x){return x.id===id})[0],p=false;
 if(!t){t=parts.filter(function(x){return x.id===id})[0];p=true}
 if(!t||t.st!=="cours")return false;
 if(p?!(pronostic&&pronostic.id===t.pid&&ouvert(find(pronostic.mid))):!peutAnnuler(t))return false;
 t.st="annule";crediter(t.uid||sess.id,t.mise);ecrire(p?"parts":"hist",p?parts:hist);return true}

function sauver(){ecrire("sess",sess);comptes=comptes.map(function(c){return c.id===sess.id?sess:c});ecrire("comptes",comptes)}
var RETOUR='<a href="menu.html" data-p="menu" class="tout" style="text-decoration:none;color:inherit;display:inline-block;margin-top:12px">← Menu</a>';

function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function crediter(uid,m){comptes.forEach(function(c){if(c.id===uid)c.solde=(c.solde||0)+m});ecrire("comptes",comptes);
 if(sess&&sess.id===uid){var c=comptes.filter(function(x){return x.id===uid})[0];sess.solde=c?c.solde:(sess.solde||0)+m;ecrire("sess",sess);solde=sess.solde}}
// Parrainage réel : le parrain d’un compte est celui dont le code est dans c.parrain.
function parrains(c){
 var r=[],cur=c;
 for(var n=0;n<3;n++){
  var code=(cur&&cur.parrain)||"";if(!code)break;
  var p=comptes.filter(function(x){return x.code===code})[0];
  if(!p||p.id===c.id||r.indexOf(p)>=0)break;
  r.push(p);cur=p}
 return r}
function arbre(){
 var niv=[[],[],[]],codes=sess&&sess.code?[sess.code]:[],vus={};
 if(sess)vus[sess.id]=1;
 for(var n=0;n<3;n++){var suiv=[];
  comptes.forEach(function(c){if(!vus[c.id]&&c.parrain&&codes.indexOf(c.parrain)>=0){vus[c.id]=1;niv[n].push(c);suiv.push(c.code)}});
  codes=suiv}
 return niv}
// Recharge validée : chaque parrain (niveaux 1 à 3) reçoit son pourcentage, crédité sur son solde.
function distribuerBonus(d){
 var c=comptes.filter(function(x){return x.id===d.uid})[0],tot=0;
 if(!c)return 0;
 parrains(c).forEach(function(p,i){
  var pc=+CONFIG["p"+(i+1)]||0,b=Math.round(d.montant*pc/100);
  if(b>0){crediter(p.id,b);bons.unshift({id:"B"+Date.now()+i,uid:p.id,de:c.pseudo,niv:i+1,base:d.montant,pc:pc,bonus:b,date:new Date().toLocaleDateString("fr-FR"),did:d.id});tot+=b}});
 ecrire("bons",bons);return tot}
// Retraits : ouverts seulement entre CONFIG.hd h et CONFIG.hf h (heure de l’appareil ; le serveur décidera plus tard).
function retraitOuvert(){var d=new Date(),m=d.getHours()*60+d.getMinutes();return m>=CONFIG.hd*60&&m<CONFIG.hf*60}
function banniereRetrait(){
 var o=retraitOuvert();
 return '<div class="fiche"><div class="ligne" style="border:0;padding:0"><b class="'+(o?"j":"r")+'">'+(o?"● Retraits ouverts":"● Retraits fermés")+'</b><span>de '+CONFIG.hd+'h à '+CONFIG.hf+'h</span></div>'+
  (o?'':'<small style="color:var(--mute)">Reviens à partir de '+CONFIG.hd+'h pour envoyer ta demande.</small>')+
  (CONFIG.minRet>0?'<div class="ligne" style="border:0;padding:6px 0 0"><span>Retrait minimum</span><b>'+CONFIG.minRet+' F</b></div>':'')+'</div>'}
function carteDemande(d,adm){
 var et=d.st==="attente"?'<b class="j">● En attente</b>':d.st==="valide"?'<b class="j">Validée</b>':'<b class="r">Refusée</b>';
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
 '<p class="leg" style="margin:6px 0 10px">Si le score final est différent de ce pronostic, tu gagnes (cote '+p.cote.toFixed(2)+'). S’il est exactement celui-ci, tu perds ta mise.</p>';
 if(p.st==="clos"){
  h+='<div class="ligne"><span>Score final</span><b>'+esc(p.final.replace("-"," : "))+'</b></div>';
  if(mine)h+='<div class="ligne"><span>Ta participation ('+mine.mise+' F)</span><b>'+{cours:"En cours",gagne:"Gagné",perdu:"Perdu",rembourse:"Remboursé",annule:"Annulé"}[mine.st]+'</b></div>'}
 else if(mine)h+='<div class="ligne"><span>Ta mise</span><b class="j">'+mine.mise+' F</b></div>';
 else h+='<div class="mise"><input id="ppm" type="number" inputmode="numeric" min="1" placeholder="Mise en F"></div><button class="ok" id="pp">Participer</button>';
 return h+'</div>'}
function participer(){
 var p=pronostic,m=+($("ppm").value||0);
 if(!p||p.st!=="ouvert")return;
 if(!ouvert(find(p.mid))){toast("Le match a commencé : participation fermée.");return}
 if(!(m>0)){toast("Entre ta mise en F.");return}
 if(m>solde){toast("Solde insuffisant. Fais une demande de recharge.");return}
 parts.unshift({id:"R"+Math.floor(100000+Math.random()*900000),pid:p.id,uid:sess.id,pseudo:sess.pseudo,a:p.a,b:p.b,score:p.score,cote:p.cote,mise:m,date:new Date().toLocaleDateString("fr-FR"),st:"cours"});
 ecrire("parts",parts);solde-=m;sess.solde=solde;sauver();toast("Participation enregistrée.");if(window.rendre)rendre()}


// ===== Évènements : chargés depuis Supabase (table « evenements », lecture publique des matchs publiés) =====
var SB_URL="https://vxefmhkoojbjxtczjujo.supabase.co",
 SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4ZWZtaGtvb2pianh0Y3pqdWpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwMTYzMjMsImV4cCI6MjEwODU5MjMyM30.1W76QHjIt0lkt8PhUXYzwnni4B0yQJ9Tyvcqc3CAOe8";
function evBase(r){
 var q={"1":+r.q1,X:+r.qx,"2":+r.q2};
 if(r.q_bo&&r.q_bn){q.bo=+r.q_bo;q.bn=+r.q_bn}
 if(r.q_po&&r.q_pu){q.po=+r.q_po;q.pu=+r.q_pu}
 return {id:r.id,code:r.code,l:r.competition||"",a:r.equipe1,b:r.equipe2,start:Date.parse(r.debut),q:q,pub:!!r.publie,st:r.statut,
  res:(r.score1!=null&&r.score2!=null)?r.score1+"-"+r.score2:null}}
function chargerEvents(){
 if(!window.fetch||!sess)return;
 var depuis=new Date(Date.now()-3*864e5).toISOString();
 fetch(SB_URL+"/rest/v1/evenements?select=id,code,competition,equipe1,equipe2,debut,q1,qx,q2,q_bo,q_bn,q_po,q_pu,publie,statut,score1,score2&debut=gte."+encodeURIComponent(depuis)+"&order=debut.asc&limit=300",
  {headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY}})
 .then(function(r){if(!r.ok)throw 0;return r.json()})
 .then(function(rows){
  var nv=rows.map(evBase);
  if(JSON.stringify(nv)===JSON.stringify(EV))return;
  EV=nv;ecrire("events",EV);
  // Matchs terminés ou annulés côté base : les tickets en cours sont réglés (sans effet s’ils le sont déjà).
  nv.forEach(function(m){if(m.st==="annule"||(m.st==="clos"&&m.res))reglerEvent(m)});
  Object.keys(coupon).forEach(function(i){if(!ouvert(find(i))||coupon[i].k===undefined)delete coupon[i]});ecrire("coupon",coupon);
  badge();if(window.rendre)rendre()})
 .catch(function(){})}
chargerEvents();
