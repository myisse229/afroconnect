# Sécurité et import GitHub

## Dépôt public : mesure à prendre
Le fichier `manager/index.html` dans `main` contient des identifiants d'administration codés en dur (`LOGIN_USER` / `LOGIN_PASS`). Ils sont visibles dans le code source public. Considérez ces identifiants comme compromis et remplacez-les; ne les réutilisez pas. Le bon correctif est de faire l'authentification et les autorisations côté serveur. Un écran de connexion purement JavaScript ne protège pas les données.

## Import sans interruption du site
1. Dans GitHub, ouvrez `myisse229/afroconnect`.
2. `Add file → Upload files`.
3. Importez le dossier `backend/` et le dossier `docs/` depuis ce pack.
4. N'écrasez pas `manager/index.html` dans cette première étape.
5. Vérifiez les fichiers et validez le commit.
6. Plus tard, nous corrigerons le frontend dans un commit séparé, après préparation de l'authentification serveur.

## Ne jamais publier
- Fichier `.env` réel.
- Mots de passe de compte / administrateur.
- Clés API, jetons WhatsApp.
- Identifiants et mots de passe MikroTik.
- URL de base de données avec mot de passe.

`.env.example` ne contient que des valeurs fictives.

## Déploiement
GitHub Pages peut publier le HTML/CSS/JS, mais ne peut pas exécuter une API Node.js ni PostgreSQL. Le backend devra être déployé sur un service serveur distinct. La connexion RouterOS/RADIUS, les clôtures hebdomadaires persistantes, WhatsApp Business API, tests, sauvegardes et surveillance ne sont pas encore configurés.
