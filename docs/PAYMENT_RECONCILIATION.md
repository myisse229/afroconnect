# Règle de comptabilisation des ventes AFROCONNECT

## Règle métier validée

Pour le Manager AFROCONNECT, **un ticket activé est considéré comme encaissé**.

- Un ticket compte dans le chiffre d'affaires à partir de sa première activation validée.
- Le montant comptabilisé est le prix enregistré sur le ticket (`price_minor_snapshot`) et sa devise (`currency_snapshot`).
- Une activation ultérieure du même ticket ne doit pas créer une nouvelle vente.
- Un ticket simplement généré, encore en stock ou jamais activé, n'est pas compté comme vente encaissée.
- Les statistiques journalières, hebdomadaires, mensuelles et annuelles s'appuient sur la date de première activation.

## FedaPay et ventes manuelles

Les tickets payés par FedaPay Mobile Money suivent la même règle : dès que leur activation est validée, le ticket est comptabilisé une seule fois. Il ne faut pas additionner une seconde fois le même montant au titre d'un paiement FedaPay, car cela doublerait le chiffre d'affaires.

Cette règle suppose que le processus d'activation ne valide que les tickets effectivement encaissés. Si cette garantie change, il faudra revoir la règle métier avant de modifier les statistiques.

## Implémentation existante

L'API s'appuie déjà sur le statut `ACTIVATED` et `first_activated_at` pour les rapports. Le premier passage à l'état activé doit rester idempotent : la même activation répétée ne peut pas incrémenter les ventes une seconde fois.

Le montant calculé à partir du prix du ticket est la valeur des tickets activés selon cette règle métier ; ce n'est pas un relevé séparé des frais, commissions ou remboursements FedaPay.

## Contrôles avant fusion

- Vérifier que le même ticket activé plusieurs fois n'est compté qu'une seule fois.
- Vérifier que les tickets non activés sont exclus des ventes.
- Vérifier les regroupements par jour, semaine, mois et année à partir de la première activation.
- Vérifier que les prix historiques du ticket sont utilisés plutôt que le prix actuel du forfait.
- Ne pas créer ni utiliser un registre de paiement séparé pour ajouter une deuxième fois les ventes déjà comptées par activation.
