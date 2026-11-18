# Price evidence

The evidence of the AI quote (`price_evidence`, migrations 023 and 024). Every row was `approved` by the owner.

| File | Rows | What |
|---|---|---|
| `golf-shoe-approved-2026-11-17.json` | 52 | public FOB listing prices of golf shoes (Global Sources, collected 2026-11-17) |
| `sunglasses-approved-2026-11-18.json` | 45 | public FOB listing prices of golf and sports sunglasses (Global Sources, collected 2026-11-18); shown only as a reference next to the cost simulation |
| `golf-tee-approved-2026-11-18.json` | 13 | 10 public FOB listing prices of golf tees (Global Sources, 2026-11-18) and the 3 rows of the real bamboo tee factory quote (EXW, 2026-11); price per 100 tees (`unit: 100_tees`), material in `product_type` (bamboo_tee, plastic_tee) |

**Check before relying on them:** the parts of a row (`upper_material`, `outsole`, `closure` of a shoe, `frame_material` and `lens_type`
of sunglasses) were guessed from the listing titles (most rows have none), and the prices are display prices of the listings, not quotes.

Store them in a database (the migrations must have run first). A dry run, which stores nothing, is the default:

```bash
npm run evidence:import -- data/price-evidence/golf-shoe-approved-2026-11-17.json
npm run evidence:import -- data/price-evidence/golf-shoe-approved-2026-11-17.json --apply
npm run evidence:import -- data/price-evidence/sunglasses-approved-2026-11-18.json --apply
npm run evidence:import -- data/price-evidence/golf-tee-approved-2026-11-18.json --apply
```

On the hosting, take the database address from its settings and keep it out of the files, for example on Heroku:

```bash
DATABASE_URL="$(heroku config:get DATABASE_URL -a APP_NAME)" DATABASE_SSL_REJECT_UNAUTHORIZED=false npm run evidence:import -- data/price-evidence/golf-shoe-approved-2026-11-17.json --apply
DATABASE_URL="$(heroku config:get DATABASE_URL -a APP_NAME)" DATABASE_SSL_REJECT_UNAUTHORIZED=false npm run evidence:import -- data/price-evidence/sunglasses-approved-2026-11-18.json --apply
```

A row that is already there is left as it is, so running it twice is safe. A real quote of a factory replaces the listing price of its
kind of product: add it as a row with `"price_kind": "quote"`.
