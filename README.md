# ChatDJCRO

Code for deployment of RAG chatbot for the [Digital Journal of Case Reports in Ophthalmology](https://dukeeyecenter.duke.edu/djcro).

## Overall Architecture

`Frontend <-> CF worker <-> CF AI Gateway <-> LLM`

- Frontend = self-contained static HTML file
- Backend = Cloudflare worker script, which uses Cloudflare AI Gateway to route requests to Claude
  - Cloudflare AI Gateway caching serves stored responses to identical prompts/requests for a configurable period (e.g., 1 month)
  - since RAG knowledgebase is included in the prompt/request, if the knowledgebase is updated, Cloudflare caching will NOT serve a cached/outdated response
- RAG: user-initiated journal indexing (Claude web search) updates local RAG knowledgebase for that user
  - updating the RAG knowledgebase is extremely expensive (~500,000 tokens, $1.50, >60 seconds per instance per user)
  - Cloudflare AI Gateway caching is *skipped* for these requests to ensure the knowledgebase is actually updated
    - Alternatively, we could allow caching for a smaller time period, e.g., 1 day, through a separate Cloudflare AI gateway for these requests
- Security considerations
  - LLM API key is stored in [CF AI Gateway BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)
  - CF worker has CF AI Gateway key in environmental vars
  - Requests could theoretically be sent to our CF worker, leaving us paying for arbitrary requests.
    - Partially mitigated by CF AI Gateway security features, e.g., rate-limiting
    - CORS provides some security & prevents arbitrary backend use from within web browsers, but this can easily be circumvented by building requests outside of a browser
