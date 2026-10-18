# Get a Groq API key

[Groq](https://groq.com) runs open models (Llama, gpt-oss, Qwen and others) very fast, has a free tier, and offers an **OpenAI-compatible API**, which is what Lode speaks.

> Groq (with a "q") is the inference company. It is not xAI's Grok.

## 1. Create an account and a key

1. Sign in to the **[GroqCloud console](https://console.groq.com)**.
2. Open **[API Keys](https://console.groq.com/keys)** and choose **Create API Key**.
3. Name it (for example `Lode`) and copy the key. It starts with `gsk_` and is shown only once.

The free tier needs no card but has per-minute and per-day rate limits; see [Rate limits](https://console.groq.com/docs/rate-limits) for current numbers.

## 2. Pick a model

See the **[model list](https://console.groq.com/docs/models)**. For web search, choose a model that supports **tool use** (see [Tool use](https://console.groq.com/docs/tool-use)); larger models file and explain points more reliably, for example `llama-3.3-70b-versatile` or `openai/gpt-oss-120b`.

Use the model ID exactly as listed.

## 3. Set it up in Lode

Open **Settings** in Lode:

| Field | Value |
|---|---|
| Base URL | `https://api.groq.com/openai/v1` |
| Model | the model ID, e.g. `llama-3.3-70b-versatile` |
| LLM API key | your `gsk_…` key |

Choose **Save provider**, paste the key and choose **Save**, then **Test connection**. You should see *Connection OK*.

Groq models can't browse the web by themselves; add a [Tavily key](tavily.md) so additions get real sources.

## Tips for the free tier

- If a run fails with **429 / rate limit**, lower **Points per request** in Settings (for example to 5–10) so each request is smaller, and lower **Max searches per request**.
- Lode retries briefly on rate limits; if it still fails, nothing is written and you can run Generate again later.

## Troubleshooting

- **401 / authentication failed:** the key was mistyped or revoked. Check [API Keys](https://console.groq.com/keys).
- **Model not found / decommissioned:** Groq retires models from time to time. Pick a current one from the [model list](https://console.groq.com/docs/models).
- **No sources in notes:** the model may not support tool use, or no Tavily key is saved.
