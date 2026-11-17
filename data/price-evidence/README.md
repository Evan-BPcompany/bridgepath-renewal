# Price evidence (golf shoes)

`golf-shoe-approved-2026-11-17.json`: 52 public FOB listing prices of golf shoes (Global Sources, collected 2026-11-17), all `approved`
by the owner. They are the evidence of the AI quote of the golf shoe (`price_evidence`, migration 023).

**Check before relying on them:** `upper_material`, `outsole` and `closure` were guessed from the listing titles (most rows have none),
and the prices are display prices of the listings, not quotes.

Store them in a database (the migrations must have run first). A dry run, which stores nothing, is the default:

```bash
npm run evidence:import -- data/price-evidence/golf-shoe-approved-2026-11-17.json
npm run evidence:import -- data/price-evidence/golf-shoe-approved-2026-11-17.json --apply
```

On the hosting, take the database address from its settings and keep it out of the files, for example on Heroku:

```bash
DATABASE_URL="$(heroku config:get DATABASE_URL -a APP_NAME)" DATABASE_SSL_REJECT_UNAUTHORIZED=false npm run evidence:import -- data/price-evidence/golf-shoe-approved-2026-11-17.json --apply
```

A row that is already there is left as it is, so running it twice is safe. A real quote of a factory replaces the listing price of its
kind of shoe: add it as a row with `"price_kind": "quote"`.
