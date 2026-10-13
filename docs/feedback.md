# Provider feedback after live testing

**Status on October 12, 2026: pending.** No real Nebius, NVIDIA-model, or Tavily runtime was tested during the local build. The entries below are prompts for collecting feedback, not findings to submit.

## Collect one useful observation per service used

| Service | Probe in Ripple | Evidence to retain |
| --- | --- | --- |
| Nebius Token Factory | Run a complete repair through the account's available Nano and Super models. Check successful responses and one recoverable failure. | Exact endpoint region, returned model IDs, redacted request/response, provider-reported usage, and the app's outcome. |
| NVIDIA Nemotron models | Compare the extracted incident with the intended target and delay; inspect proposed repairs against independent checks. Exercise Ultra only if the escalation path actually occurs. | Input, actual model identity, structured output, accepted/rejected candidates, and the specific failed constraint. Do not infer model quality from one case. |
| Tavily | Use an infeasible room closure that triggers the resource-search branch. | Search query, returned source URLs, retrieval time, and why a lead was useful or unsuitable. Search results do not confirm venue availability. |
| Nebius Serverless, if used | Complete an Endpoint request and a separate background Job. | Deployment/job identifiers, terminal status, useful output, and any setup or execution friction actually encountered. |

## Copy this entry after an actual run

- **Service / feature:** `[unknown — fill after testing]`
- **Date and time, with timezone:** `[unknown]`
- **Ripple commit and demo/live mode:** `[unknown]`
- **Endpoint region / actual model ID / API version, where available:** `[unknown]`
- **Case and reproducible input:** `[unknown — use fictional or redacted event data]`
- **Expected behavior:** `[unknown]`
- **Observed behavior:** `[unknown — include the specific response or failure]`
- **Effect on the organizer's workflow:** `[unknown]`
- **Evidence file or redacted trace:** `[unknown]`
- **Measurements:** `[not measured — record attempts, timings, and provider-reported usage only if collected]`
- **Suggested improvement and why it helps:** `[unknown — tie it to the observation above]`
- **Retest result, if any:** `[not retested]`

Record documentation observations separately from runtime behavior. Remove credentials and authorization headers from evidence. Keep an unsuccessful attempt as an unsuccessful attempt; a configured integration is not a successful run.

For the final submission, summarize the concrete observation, its effect on Ripple, and one actionable suggestion. Leave services that were not tested marked as untested. See the [validation record](validation.md) and [account setup](resources.md).
