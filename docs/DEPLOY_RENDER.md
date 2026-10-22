# Déploiement du backend AFROCONNECT sur Render

Ce guide concerne le service API existant `https://afroconnect-api.onrender.com` et sa base PostgreSQL hébergée sur Render. Il est prévu pour mettre à jour le service existant, pas pour créer un second service ou une seconde base.

## 1. Configuration du service Render existant

Dans Render, ouvrir le Web Service qui dessert `https://afroconnect-api.onrender.com`, puis vérifier :

- **Root Directory** : `backend`
- **Runtime** : Node
- **Build Command** : `npm install`
- **Start Command** : `npm start`
- **Health Check Path** : `/health`
- **Node version** : Node.js 20 ou supérieur (le projet déclare `node >=20`).

Ne change pas le service de production pour qu'il suive la branche de travail. La branche `feat/voucherman-dashboard` sert à la validation ; le déploiement de production doit se faire depuis `main` après fusion et vérification des contrôles.

## 2. Variables d'environnement

Dans **Environment** du service existant, vérifier que ces variables sont définies. Ne colle jamais leurs valeurs secrètes dans GitHub, dans un ticket ou dans une conversation.

| Variable | Valeur / règle |
| --- | --- |
| `DATABASE_URL` | URL **interne** de la base PostgreSQL Render existante, copiée depuis les informations de connexion de cette base. Ne pas créer une nouvelle base. |
| `AFROCONNECT_API_KEY` | Secret aléatoire d'au moins 32 caractères ; doit rester identique aux systèmes qui appellent l'API avec un Bearer token. |
| `ADMIN_USERNAME` | Identifiant du compte administrateur actuel. |
| `ADMIN_PASSWORD` | Mot de passe administrateur fort, conservé uniquement dans Render. |
| `SESSION_SECRET` | Secret aléatoire distinct d'au moins 32 caractères ; ne pas le remplacer sans prévoir la reconnexion des administrateurs. |
| `BUSINESS_TIMEZONE` | `Africa/Porto-Novo` pour les rapports d'activité au Bénin. |
| `PORT` | Render le fournit automatiquement ; ne pas le figer dans l'environnement de production. |

Le fichier `backend/.env.example` donne uniquement des exemples fictifs pour le développement local. **Ne l'utilise pas comme ensemble de secrets de production.**

## 3. Vérifier le schéma PostgreSQL avant le déploiement

L'application ne lance pas automatiquement les créations de tables au démarrage. Le schéma de référence est `backend/sql/schema.sql`.

Dans la base PostgreSQL Render existante, vérifier que les tables `tickets`, `plans`, `resellers`, `routers` et `activation_events` existent. Si elles manquent, faire une sauvegarde avant toute modification, puis appliquer le schéma fourni au moyen d'une connexion SQL sécurisée à cette base. Ne supprime pas et ne recrée pas les tables existantes : elles peuvent contenir les données de production.

## 4. Valider et déployer

1. Examiner la demande de fusion GitHub : https://github.com/myisse229/afroconnect/pull/1
2. Vérifier que le workflow **Validate AfroConnect** réussit sur le commit à fusionner.
3. Après fusion dans `main`, laisser Render déployer le commit sur le **service existant** si le déploiement automatique est activé ; sinon lancer un déploiement manuel du dernier commit de `main`.
4. Sur Render, consulter les logs et confirmer que le service démarre sans erreur de variable d'environnement ou de requête PostgreSQL.
5. Vérifier l'endpoint de santé : https://afroconnect-api.onrender.com/health. Le résultat attendu est un statut HTTP 200 avec `{"status":"ok","database":"connected"}`.
6. Ouvrir le manager : https://afroconnectworld.com/manager/ ; se connecter avec le compte existant et vérifier les cinq périodes du tableau de bord et la liste des activations récentes.

## 5. Limites fonctionnelles à conserver

- Le tableau de bord additionne les prix des tickets activés : c'est une **valeur estimée des tickets activés**, pas un relevé de paiements confirmés.
- Les méthodes et transactions de paiement ne sont pas encore enregistrées par le backend.
- Les sessions Wi-Fi actives en direct ne sont pas encore collectées par cette API.
- Un contrôle de syntaxe ne remplace pas un test de connexion à la base ni une validation fonctionnelle en production.

## 6. Retour arrière

Si le nouveau déploiement échoue, utiliser l'historique des déploiements Render pour revenir au dernier déploiement fonctionnel. Conserver les variables d'environnement et la base existantes ; ne pas supprimer la base pendant le rollback.
