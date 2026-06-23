# ChatDJCRO

Code for deployment of RAG chatbot for the [Digital Journal of Case Reports in Ophthalmology](https://dukeeyecenter.duke.edu/djcro).

## Overall Architecture

`Frontend <-> CF worker <-> CF AI Gateway <-> LLM`

- Frontend = self-contained static HTML file
- Backend = Cloudflare worker script, which uses Cloudflare AI Gateway to route requests to Claude
  - Cloudflare AI Gateway caching serves stored responses to identical prompts/requests for a configurable period (e.g., 1 month)
  - since RAG knowledgebase is included in the prompt/request, if the knowledgebase is updated, Cloudflare caching will NOT serve a cached/outdated response
- RAG: use Open Archives Initiative Protocol for Metadata Harvesting (OAI-PMH) data provided by DJCRO to generate index
  - DJCRO uses Open Journal Systems (OJS), which exposes an endpoint for XML metadata (e.g., [here](https://djcro.duke.edu/index.php/djcro/oai?verb=ListRecords&metadataPrefix=oai_dc))
  - We fetch this data through our Cloudflare worker so that we can cache responses for all users for 12 hours - minimizes hits to DJCRO endpoint
  - Replaces use of costly LLM-based web search for generating RAG knowledgebase
  - Cloudflare worker serves requests transparently to frontend; frontend handles OAI-PMH pagination + parsing XML data into JSON/RAG knowledgebase
- Security considerations
  - LLM API key is stored in [CF AI Gateway BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)
  - CF worker has CF AI Gateway key in environmental vars
  - Requests could theoretically be sent to our CF worker, leaving us paying for arbitrary requests.
    - Partially mitigated by CF AI Gateway security features, e.g., rate-limiting
    - CORS provides some security & prevents arbitrary backend use from within web browsers, but this can easily be circumvented by building requests outside of a browser
