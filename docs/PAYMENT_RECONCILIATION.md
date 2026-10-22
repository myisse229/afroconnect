# Suivi fiable des paiements AFROCONNECT

## Objectif

Séparer les tickets générés/activés de l'argent effectivement encaissé. Les statistiques actuelles de tickets activés restent des estimations et ne doivent pas être présentées comme des recettes confirmées.

## Migration PostgreSQL

1. Ouvrir Render, puis la base PostgreSQL utilisée par `afroconnect-api`.
2. Ouvrir l'outil SQL disponible pour cette base (ou se connecter avec les paramètres privés de connexion).
3. Exécuter une seule fois le fichier `backend/sql/migrations/20261022_payment_ledger.sql`.
4. Vérifier que les tables `payment_transactions` et `payment_transaction_events` existent.
5. Ne jamais publier l'URL de connexion, le mot de passe PostgreSQL ou des clés FedaPay dans un ticket, une capture publique ou le dépôt Git.

La migration est additive : elle ne supprime ni ne modifie les tickets existants. Elle ne doit pas être exécutée automatiquement au démarrage de l'API.

## Règles de comptabilisation

- **Recettes confirmées** : uniquement les transactions dont le statut est `CONFIRMED`.
- **En attente** : exclues du total encaissé.
- **Échouées / annulées** : exclues du total encaissé.
- **Remboursées** : présentées séparément et déduites des recettes nettes selon la règle comptable retenue.
- **Ventes manuelles** : enregistrer le mode (espèces, Mobile Money manuel, virement), la référence disponible, la date de paiement et l'agent qui a saisi l'opération.
- **FedaPay** : ne confirmer un paiement qu'après vérification côté serveur auprès de FedaPay ou validation d'une notification authentifiée. Ne jamais se fier à une page de retour navigateur ni à une valeur envoyée par le client.
- **Idempotence** : l'identifiant de transaction du prestataire et la clé d'idempotence empêchent de compter deux fois le même paiement.
- **Rapprochement** : comparer périodiquement les transactions confirmées avec le tableau de bord FedaPay et le journal des ventes manuelles.

## État d'implémentation

Cette migration prépare le registre persistant et son journal d'événements. Elle ne branche pas encore de webhook FedaPay et n'ajoute pas encore d'interface de saisie manuelle ni de nouveaux chiffres d'encaissement au Manager. Ces fonctionnalités doivent être livrées après validation des paramètres FedaPay (mode test/production, secret webhook et méthode de vérification officielle) et des règles de vente manuelle.

## Vérifications avant mise en production

- Tester en mode FedaPay test un paiement confirmé, refusé, annulé et une notification répétée.
- Vérifier que la répétition d'une notification ne crée pas de double comptabilisation.
- Vérifier qu'une vente manuelle ne peut être enregistrée que par un administrateur authentifié.
- Comparer les totaux journaliers avec FedaPay et les ventes manuelles.
- Garder les indicateurs existants clairement étiquetés « valeur estimée des tickets activés » jusqu'à ce que le registre soit alimenté et contrôlé.
