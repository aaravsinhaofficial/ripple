# Ripple: accounts, credits, and deployment

Project status: October 13, 2026. Nebius Token Factory authentication and real daily assistance are verified: ten attempts produced nine completed Nano/Super responses and one explicit timeout, including the browser → authenticated local API → provider flow. See the [redacted execution record](evidence/daily-live-2026-10-13.json) and [validation scope](validation.md#real-daily-assistance--october-13-2026).

Cloud browser authentication has succeeded, but the account has no accessible tenant or project. No Cloud resources have been created. Tavily runtime and hosted AI access remain unverified. The public GitHub Pages app runs the local daily planner without an account or backend.

The offer amounts and promotion terms below were checked against their linked sources on **October 12, 2026**; they have not been reverified as current offers. They are separate from the project's October 13 execution evidence. Keep provider keys out of GitHub, the browser, recordings and frontend build variables.

## 1. Configure Nebius Token Factory

Open [Token Factory](https://tokenfactory.nebius.com/), sign in, and create an API key using the [official quickstart](https://docs.tokenfactory.nebius.com/quickstart). That quickstart lists `https://api.tokenfactory.nebius.com/v1/`; use the regional endpoint shown for your account where applicable. The deployment guide lists Ripple's defaults. Keep the key in the backend environment only.

Copy the exact NVIDIA model IDs available to your account from its current catalog. Ripple's daily assistance uses Nano to turn notes into reviewable task drafts and Super to prepare steps for a selected task. These paths have completed real calls; the returned identities are recorded in the evidence above. Conditional Ultra review and asynchronous repair jobs belong to the retained event workspace at `?workspace=events`, not the daily endpoint, and are not part of that live evidence. Record the actual returned model identity rather than inferring it from the hackathon brief.

## 2. Request the published Token Factory credits

The [hackathon resources page](https://nebiusglobalaihackathon.devpost.com/resources) advertised these offers when checked on October 12:

| Offer | Action | Published amount |
| --- | --- | --- |
| Hackathon promotion | Complete the [official promotion form](https://nebius.com/promo-code?utm_promo_activation_code=NEBIUS-DEVPOST-GLOBAL26&utm_promo_code_type=Token_Factory&utm_promo_event_code=2026-devpost-global-ai-hack) with activation code `NEBIUS-DEVPOST-GLOBAL26`. | $25 Token Factory credit |
| Builder Program | Join the [Nebius Builder Program](https://dev.nebius.com/builders), verify your email, and follow its claim instructions. | Another $25 Token Factory credit |

This table records published offers, not which grants this project received or redeemed. Confirm eligibility, the actual account balance and credit expiry before relying on an offer. The promotion form's activation code may start a claim process; follow the issued redemption instructions rather than assuming it is a console voucher.

At that verification date, [Token Factory billing documentation](https://docs.tokenfactory.nebius.com/other-capabilities/billing) said promo codes could be applied without a bank card or billing information. This does not establish AI Cloud's payment requirements. Automatic top-ups are unnecessary for the bounded tests. The [hackathon FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs) directed missing-credit and unsupported-country issues to the [Nebius team on Discord](https://discord.com/invite/eXYTGhgnhK).

## 3. Create a Tavily account

Open the [Tavily platform](https://app.tavily.com/) and copy an API key from the dashboard. When checked on October 12, its [quickstart](https://docs.tavily.com/documentation/quickstart) advertised 1,000 free API credits each month without a credit card. Confirm current eligibility and plan limits before use.

At the same verification date, the [Nebius Builder Program](https://dev.nebius.com/builders) also advertised $25 Tavily credit, subject to eligibility, availability and partner terms. Confirm redemption and expiry in your account; do not assume this stacks automatically with the free plan.

Daily research is an explicit user action: one basic Tavily search retrieves sources for the selected task, then Super proposes actionable steps. Search receives the task title or explicit query, not private task notes or the whole workspace. Cited URLs must match retrieved sources; that check does not prove every claim correct. The older event workspace also supports venue leads after an infeasible room closure. Neither search path has been verified with a real Tavily call.

## 4. Connect the backend and prove live operation

Follow the repository README for the implemented environment variables and startup commands. Set secrets in the backend environment or hosting secret store. A GitHub Pages frontend should contain only the backend's public address and non-secret configuration.

The existing daily evidence records synthetic capture and task-brief requests, actual returned models, usage when supplied, latency, accepted output, failures and human quality findings. It includes two real browser/API runs through a private local backend. Use the [daily evaluation guide](daily-live-evaluation.md) for additional bounded cases; its default run makes no provider calls. Record Tavily source URLs if research is tested. An account key, successful health check, model-list request, mock response or deployed frontend alone does not prove inference.

The optional frontend URL preset only fills the connection dialog. A live or protected connection checks the app access code through `GET /api/session` before reporting success; the code stays in memory and clears on reload. Connecting makes no model call and sends no task text. See the [deployment guide](deployment.md) for configuration.

## 5. Treat Serverless as a separate deployment decision

When checked on October 12, the [hackathon FAQ](https://nebiusglobalaihackathon.devpost.com/details/faqs) described the published promotion grants as Token Factory credits and listed no separate AI Cloud grant. Do not assume a Token Factory balance is transferable to AI Cloud. Hosting requires an actual accessible AI Cloud tenant and project, with account-specific billing, credit eligibility and quotas established. Successful Cloud authentication alone does not complete that setup.

The prepared Serverless Endpoint would host the private API, including synchronous daily assistance. The Serverless Job worker supports the older event-repair queue; daily capture and briefs do not use it. The current account exposes no tenant or project, and no Endpoint, Job or other Cloud resource has been created. Prepared configuration and a tested container are not a deployed service. Resolve onboarding and actual payment or credit eligibility, then confirm regional compute, storage and network costs and a shutdown plan before provisioning.

Use the official [Endpoint quickstart](https://docs.nebius.com/serverless/quickstart/endpoints) and [Job quickstart](https://docs.nebius.com/serverless/quickstart/jobs). Do not assume zero idle cost from the word “serverless.” Keep any endpoint behind appropriate authentication and request limits; test its HTTPS origin from the GitHub Pages frontend. Verify that the backend remains available throughout judging before submitting its URL.

## Cost boundary for this project

- The local daily planner needs no provider or Cloud account.
- Bounded Token Factory inference has been run. The completed calls and timeout are recorded above; provider usage estimates are separate from observed account charges.
- Token Factory access and balance do not establish AI Cloud credit eligibility or satisfy its onboarding and payment requirements. No Cloud resource has been created.
- Keep provider use bounded; automatic top-ups and unrestricted public API access are not part of the tested setup.
- Exhausted or unavailable credits should produce a clear unavailable state, not an automatic paid fallback.
