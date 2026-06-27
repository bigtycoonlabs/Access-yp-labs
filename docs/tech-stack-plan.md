# YP Labs Arbo + Equity Platform Plan

YP Labs is positioned as a unified arbitrage access platform. The product is no longer a split service catalog. The live experience should route every user through one setup wizard and one access plan.

## Product Scope

- **Single product:** YP Labs Arbo + Equity Arbitrage Access
- **Single access price:** `$997`
- **Primary user path:** learn the categories, complete setup wizard, enter workspace, confirm activation/payment
- **Audience:** beginners, learners, active traders, business users, and advanced operators who need clear market-category guidance before connecting accounts

## User Education Model

The platform must explain these categories in plain language:

- **Brokers:** account providers/intermediaries for equities, forex, options, funds, and similar markets
- **Exchanges:** marketplaces where orders meet and where liquidity, fees, rules, and access can vary
- **Crypto venues:** centralized exchanges, wallets, stablecoins, tokens, and decentralized liquidity paths
- **Pairs:** BTC/USD, ETH/USDT, EUR/USD, asset-to-asset routes, and other comparisons where spread and fees matter
- **Equity markets:** stocks, ETFs, market hours, broker account types, and cash/margin differences

The platform should avoid promising guaranteed outcomes. It should frame arbitrage as a setup, recognition, timing, pricing, spread, fee, and access problem.

## Wizard Flow

1. **Experience level**
   - New to arbitrage
   - Learning the markets
   - Active trader or operator
   - Advanced user

2. **Market interest**
   - All market types
   - Brokers
   - Exchanges
   - Crypto
   - Pairs
   - Equity

3. **Readiness**
   - Teach me first
   - Help me choose accounts
   - I already have accounts
   - Set up for a team

4. **Access request**
   - Collect contact details
   - Create pending workspace setup
   - Confirm that payment is handled after activation review

## Backend Behavior

- Wizard submissions create one project/access setup.
- Pricing is calculated server-side from `src/services/pricing.js`.
- Cart contents are ignored for pricing so legacy service selections cannot alter the unified access price.
- The created line item should use `service_type = arbitrage_access`.
- The existing database column names can remain for compatibility, but their user-facing meaning is now:
  - `housing_type` -> experience level
  - `channel` -> market interest
  - `mission` -> readiness and notes

## Workspace Behavior

Client workspace language should describe:

- Setup status
- Access setup checklist
- Specialist messages
- Setup documents
- Billing for the unified access plan

Staff workspace language should describe:

- Access queue
- Active setups
- Awaiting contact
- In setup
- Client access records

## Deployment Notes

Railway should continue serving the Express app with static files from `public/`. The liveness endpoint remains `/api/health`, and database readiness remains `/api/ready`.
