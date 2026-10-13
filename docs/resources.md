# Ripple: accounts, credits, and deployment

Last checked: October 12, 2026. No account, credit balance, provider call, or cloud deployment has been verified for this project yet.

Start with the local demo. The account steps below are for enabling and testing live operation after the build is ready. Do not put provider keys in GitHub, the browser, a recording, or a frontend build variable.

## 1. Create a Nebius Token Factory account

Open [Token Factory](https://tokenfactory.nebius.com/), sign in, and create an API key using the [official quickstart](https://docs.tokenfactory.nebius.com/quickstart). That quickstart lists `https://api.tokenfactory.nebius.com/v1/`; use the regional endpoint shown for your account where applicable. The deployment guide lists Ripple's defaults. Keep the key in the backend environment only.

Copy the exact NVIDIA model IDs available to your account from its current catalog. Ripple's intended routing uses Nano for incident extraction, Super for repair planning, and Ultra for difficult conflict review. Model names in the hackathon brief are not proof that a particular API ID is available to your account. Record the actual model returned by each live call; never label another model as Ultra.

## 2. Request the published Token Factory credits

The [hackathon resources page](https://nebiusglobalaihackathon.devpost.com/resources) advertises two offers:

| Offer | Action | Published amount |
| --- | --- | --- |
| Hackathon promotion | Complete the [official promotion form](https://nebius.com/promo-code?utm_promo_activation_code=NEBIUS-DEVPOST-GLOBAL26&utm_promo_code_type=Token_Factory&utm_promo_event_code=2026-devpost-global-ai-hack) with activation code `NEBIUS-DEVPOST-GLOBAL26`. | $25 Token Factory credit |
| Builder Program | Join the [Nebius Builder Program](https://dev.nebius.com/builders), verify your email, and follow its claim instructions. | Another $25 Token Factory credit |

These are advertised offers, not credits already received. Confirm that the balance and credit expiry are suitable before running paid APIs. The promotion form's activation code may start a claim process; follow the issued redemption instructions rather than assuming it is a console voucher.

[Nebius billing documentation](https://docs.tokenfactory.nebius.com/other-capabilities/billing) says promo codes can be applied without a bank card or billing information. Do not enable automatic top-ups. If onboarding demands payment or a paid plan, stop before accepting it. The [hackathon FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs) directs missing-credit and unsupported-country issues to the [Nebius team on Discord](https://discord.com/invite/eXYTGhgnhK); the user can contact them if needed.

## 3. Create a Tavily account

Open the [Tavily platform](https://app.tavily.com/) and copy an API key from the dashboard. Its [quickstart](https://docs.tavily.com/documentation/quickstart) advertises 1,000 free API credits each month without a credit card. Keep the account on the free plan; do not enable paid usage or upgrades.

The [Nebius Builder Program](https://dev.nebius.com/builders) also advertises $25 Tavily credit, subject to eligibility, availability, and partner terms. Confirm redemption and expiry in your account; do not assume this stacks automatically with the free plan.

Ripple's implemented search path looks for venue leads when a room closure has no feasible repair. A result can identify a possible replacement venue; it does not establish availability, suitability, price, or a booking. Test with a real runtime search before describing Tavily as demonstrated.

## 4. Connect the backend and prove live operation

Follow the repository README for the implemented environment variables and startup commands. Set secrets in the backend environment or hosting secret store. A GitHub Pages frontend should contain only the backend's public address and non-secret configuration.

Before recording, run one end-to-end incident and retain a redacted execution record: application revision, execution time, requested and returned NVIDIA model IDs, completed workflow stages, validator results, Tavily source URLs where used, and provider usage metadata where available. An account key, successful model-list request, mock response, or deployed frontend alone does not prove inference.

## 5. Treat Serverless as a separate deployment decision

The [hackathon FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs) says the published promotion grants are Token Factory credits; it lists no separate AI Cloud grant. A frontend may be hosted elsewhere while the project calls an NVIDIA model through Token Factory.

Ripple's intended Serverless roles are an Endpoint for the live repair API and a Job for bounded background plan checks. Prepared configuration is not a deployed service. Review the available quota, current compute/storage/network prices, credit eligibility, and a shutdown plan with the user before creating billable infrastructure.

Use the official [Endpoint quickstart](https://docs.nebius.com/serverless/quickstart/endpoints) and [Job quickstart](https://docs.nebius.com/serverless/quickstart/jobs). Do not assume zero idle cost from the word “serverless.” Keep any endpoint behind appropriate authentication and request limits; test its HTTPS origin from the GitHub Pages frontend. Verify that the backend remains available throughout judging before submitting its URL.

## Cost boundary for this project

- Local development and the local demo can proceed without these accounts.
- Free credit claims and displayed balances still require user account setup.
- No paid plan, top-up, chargeable cloud deployment, or unrestricted public API usage is authorized.
- Exhausted or unavailable credits should produce a clear unavailable state, not an automatic paid fallback.
