# سَكينة — Sakina

Application PWA **100 % hors-ligne** : adhkar (Hisn al-Muslim), Coran complet, adhkar personnalisés, checklist quotidienne et historique sur plusieurs années. Aucun compte, aucune publicité, aucune donnée ne quitte l'appareil.

## Lancer en local

```powershell
node server.js
```

Puis ouvrir <http://localhost:4173>. Aucune dépendance npm, aucun build.

## Installer sur téléphone

Un service worker exige HTTPS. Publier le dossier tel quel sur un hébergement statique (GitHub Pages, Netlify, Cloudflare Pages…), ouvrir l'URL sur le téléphone puis « Ajouter à l'écran d'accueil ». Après la première ouverture, l'application fonctionne sans connexion.

## Fonctionnalités

- **الأذكار** — 132 chapitres / 267 adhkar, recherche sans tashkīl, compteur tactile, favoris, progression du jour.
- **أذكاري** — créer ses propres catégories et adhkar (texte, nombre de répétitions, note).
- **القرآن** — 114 sourates (rasm ʿuthmānī), recherche, signets, reprise automatique de la lecture, taille du texte.
- **وِردي** — objectifs du jour à cocher ; les objectifs liés (adhkar / Coran) se cochent seuls à la fin de la lecture.
- **السجل** — carte annuelle, calendrier mensuel, séries, taux de réussite, détail de chaque jour. L'historique est conservé sans limite de durée.
- **الإعدادات** — thème sombre / clair, taille du texte arabe, export / import d'une sauvegarde JSON.

## Structure

```
index.html            coquille de l'app
sw.js                 service worker (pré-cache de tous les fichiers)
manifest.webmanifest
css/base.css          design system (tokens + composants)
css/<vue>.css         styles par écran
js/app.js             démarrage + routeur (hash)
js/store.js           persistance IndexedDB (objectifs, jours, adhkar perso, Coran)
js/data.js            chargement des données embarquées
js/ui.js              helpers DOM, icônes, sheet, toast…
js/views/*.js         un module par écran (exporte `routes`)
data/adhkar.json      généré par tools/build-data.js
data/quran.json       généré par tools/build-data.js
tools/                scripts de génération (données, icônes)
```

Après toute modification d'un fichier, incrémenter `VERSION` dans `sw.js` (et ajouter les nouveaux fichiers à `ASSETS`).

## Sources et licences

- Adhkar : [rn0x/Adhkar-json](https://github.com/rn0x/Adhkar-json) — « حصن المسلم », Saʿīd b. ʿAlī b. Wahf al-Qaḥṭānī. Textes repris tels quels.
- Takhrīj (référence affichée sous chaque dhikr) : notes de bas de page de [rn0x/hisn_almuslim_json](https://github.com/rn0x/hisn_almuslim_json), reprises telles quelles. Une référence n'est rattachée à un dhikr que si la correspondance est vérifiée par le script (`tools/build-data.js`) : 248 adhkar sur 267 ; les 19 autres n'affichent aucune référence plutôt qu'une référence incertaine.
- Règles par moment (`sessionItems` dans `js/data.js`) : matin / soir et après chaque prière, appliquées uniquement d'après ce que le texte du livre énonce.
- Coran : [risan/quran-json](https://github.com/risan/quran-json) — texte ʿuthmānī. Repris tel quel (114 sourates, 6236 versets vérifiés au build).
- Polices : Amiri, Amiri Quran, Tajawal — SIL Open Font License.

Avant toute diffusion publique, vérifier les conditions de réutilisation de ces deux jeux de données et faire relire les textes par une personne compétente.
