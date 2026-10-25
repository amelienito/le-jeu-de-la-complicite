# Le Jeu de la Complicité

Site **non officiel** pour jouer au jeu de la complicité de l'émission *Un Bon Moment* (Kyan Khojandi et Navo). Aucun lien avec eux. Pour les soutenir : [Une Bonne Boutique](https://unebonneboutique.com).

## Le principe

Celui qui fait deviner voit un mot, par exemple **Dalida**. Il le fait trouver uniquement avec des références à votre vie : « ta mère est fan ». Chaque mot trouvé rapporte 1 point, et le tour change tous les 5 points.

- **À 4** : deux équipes de 2 (Noirs contre Blancs). L'équipe adverse voit aussi le mot pour vérifier.
- **À 2** (ou 3, 5…) : chacun son tour, pour le plaisir.

## Deux façons de jouer

- **En ligne** : un joueur crée la partie et donne le code de 4 lettres. Les autres le tapent sur leur téléphone. Pas de compte. Celui qui devine ne reçoit jamais le mot.
- **Sur un seul téléphone** : on entre les prénoms et on se passe le téléphone à chaque tour.

## Technique

Site statique (HTML, CSS, JS), sans serveur à toi. Le mode en ligne relie les téléphones en direct avec [PeerJS](https://peerjs.com) : la partie vit sur le téléphone de celui qui l'a créée, qui doit donc garder la page ouverte.

| Fichier | Rôle |
|---|---|
| `index.html` | La page |
| `style.css` | Le look noir et blanc |
| `app.js` | Le jeu, le mode local et le mode en ligne |
| `words.js` | La liste des mots, par catégorie (facile à compléter) |

Mise en ligne : GitHub Pages, branche `main`, dossier racine.
