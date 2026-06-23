export default {
  async fetch(request, env, ctx) {
    // ==================================================
    // 1. CONFIGURATION (Pulled from Cloudflare env vars)
    // ==================================================
    const ALLOWED_CORS_ORIGIN = env.ALLOWED_CORS_ORIGIN || "*";
    const ANTHROPIC_VERSION   = env.ANTHROPIC_VERSION || "2023-06-01";
    const CF_BYOK_ALIAS       = env.CF_AIG_BYOK_ALIAS || "default";
    const CF_AIG_PROVIDER     = env.CF_AIG_PROVIDER || "anthropic";
    const CF_ACCOUNT_ID       = env.CF_ACCOUNT_ID;
    const CF_GATEWAY_ID       = env.CF_GATEWAY_ID;
    const CF_GATEWAY_TOKEN    = env.CF_AIG_TOKEN;
    const MODEL_STR           = env.MODEL_STR;

    // Parse header passthrough whitelist from JSON array
    let allowedHeaders = [];
    try {
      const rawWhitelist = env.HEADER_PASSTHROUGH_WHITELIST || '[]';
      const parsedArray = Array.isArray(rawWhitelist) ? rawWhitelist : JSON.parse(rawWhitelist);
      allowedHeaders = parsedArray.map(h => String(h).trim().toLowerCase());
    } catch (e) {
      console.error("Failed to parse HEADER_PASSTHROUGH_WHITELIST as JSON:", e);
    }

    // Build the AI Gateway URL
    const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/${CF_AIG_PROVIDER}/v1/messages`;

    // ==========================================
    // 2. CORS PREFLIGHT HANDLING
    // ==========================================
    if (request.method === "OPTIONS") {
      // Dynamically authorize Content-Type plus any whitelisted headers
      const accessControlAllowHeaders = ["content-type", ...allowedHeaders].join(", ");

      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_CORS_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": accessControlAllowHeaders,
          "Access-Control-Max-Age": "86400", // Cache preflight for 24 hours
        },
      });
    }

    // Reject non-POST traffic
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // ==========================================
    // 3. PROXY REQUEST HANDLING
    // ==========================================
    try {
      const body = await request.json();

      // ── OAI-PMH XML Proxy (With Edge Cache, KV Fallback & Source Tracking) ──
      if (body.proxy_url) {
        if (!body.proxy_url.startsWith("https://djcro.duke.edu")) {
            return new Response("Unauthorized proxy destination.", { status: 403 });
        }

        const kvKey = `oai_backup_${btoa(body.proxy_url)}`;
        // for testing KV fallback without breaking URL
        const isOfflineTest = request.headers.get("x-simulate-offline") === "true";
        try {
          if (isOfflineTest) throw new Error("Triggering simulated offline mode");
          const xmlResponse = await fetch(body.proxy_url, {
            cf: { cacheTtl: 43200, cacheEverything: true }
          });
          if (xmlResponse.ok) {
            const xmlData = await xmlResponse.text();
            if (env.DJCRO_BACKUP) {
              ctx.waitUntil(env.DJCRO_BACKUP.put(kvKey, xmlData));
            }
            // Determine if Cloudflare served this from the CDN cache or a live fetch
            const cacheStatus = xmlResponse.headers.get("CF-Cache-Status");
            const sourceLabel = (cacheStatus === "HIT") ? "CDN-Cached" : "Live-Fetch";
            return new Response(xmlData, {
              status: 200,
              headers: {
                "Content-Type": "text/xml",
                "Access-Control-Allow-Origin": ALLOWED_CORS_ORIGIN,
                "Access-Control-Expose-Headers": "X-Data-Source", // Allows frontend to read it
                "X-Data-Source": sourceLabel
              },
            });
          } else {
            throw new Error(`Duke server status: ${xmlResponse.status}`);
          }
        } catch (fetchError) {
          if (env.DJCRO_BACKUP) {
            const backupXML = await env.DJCRO_BACKUP.get(kvKey);
            if (backupXML) {
              return new Response(backupXML, {
                status: 200,
                headers: {
                  "Content-Type": "text/xml",
                  "Access-Control-Allow-Origin": ALLOWED_CORS_ORIGIN,
                  "Access-Control-Expose-Headers": "X-Data-Source",
                  "X-Data-Source": "KV-Fallback"
                },
              });
            }
          }
          return new Response(JSON.stringify({ error: "Source offline and no backup available" }), {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": ALLOWED_CORS_ORIGIN,
              "Access-Control-Expose-Headers": "X-Data-Source",
              "X-Data-Source": "None-Failed"
            },
          });
        }
      }

      // ── LLM Proxy ──

      // Force model string from env vars to prevent non-authorized model use via frontend
      body.model = MODEL_STR;

      // Base request headers required for the Gateway
      const gatewayHeaders = {
        "cf-aig-authorization": `Bearer ${CF_GATEWAY_TOKEN}`,
        "cf-aig-byok-alias": CF_BYOK_ALIAS,
        "Content-Type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION
      };

      // ── Dynamically append whitelisted headers if present ──
      for (const header of allowedHeaders) {
        if (request.headers.has(header)) {
          gatewayHeaders[header] = request.headers.get(header);
        }
      }

      // Forward request directly to Cloudflare AI Gateway
      const aiResponse = await fetch(gatewayUrl, {
        method: "POST",
        headers: gatewayHeaders,
        body: JSON.stringify(body),
      });

      const responseData = await aiResponse.text();

      // Return response back to frontend with appropriate security headers
      return new Response(responseData, {
        status: aiResponse.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": ALLOWED_CORS_ORIGIN,
        },
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": ALLOWED_CORS_ORIGIN,
        },
      });
    }
  },
};
