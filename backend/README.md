# AFROCONNECT WIFI MANAGER — backend starter

Ce dossier est destiné au backend serveur, distinct de GitHub Pages.

## Règle comptable
Une vente existe uniquement après confirmation côté serveur de la première authentification réussie d'un ticket sur MikroTik. La création et l'attribution du ticket à un revendeur ne sont jamais des ventes. Une reconnexion ne doit pas créer une deuxième vente.

## Architecture cible
- Frontend : manager existant dans `manager/`.
- API : Node.js / Express en hébergement serveur avec HTTPS.
- Base : PostgreSQL.
- Authentification HotSpot : MikroTik + RADIUS avec accounting, de préférence.
- Clôture : semaine du lundi 00:00 inclus au lundi suivant 00:00 exclu dans le fuseau métier configuré.
- Partage : commission revendeur = 10 % ; reversement = 90 %.
- Notifications : intégration WhatsApp Business API côté serveur, avec journal des livraisons.

## Sécurité
Ne jamais intégrer de mot de passe administrateur, secret API, identifiant MikroTik, mot de passe PostgreSQL ou jeton WhatsApp dans un fichier frontend public. Les secrets doivent rester dans les variables d'environnement du serveur.

Ne pas exposer le port API MikroTik au public. Préférer un VPN ou réseau privé et un compte RouterOS dédié avec privilèges minimaux.

## Démarrage local
1. Installer Node.js 20+ et PostgreSQL 15+.
2. Créer une base puis exécuter `psql "$DATABASE_URL" -f sql/schema.sql`.
3. Copier `.env.example` vers `.env` et définir une clé aléatoire forte.
4. `npm install`
5. `npm start`

Ce squelette doit être revu, testé et complété avant tout usage réel : adaptateur RouterOS/RADIUS, API manager, règles de statut de vente, rapports enregistrés, notifications WhatsApp, surveillance et sauvegardes.
