# Get an OpenRouter API key

[OpenRouter](https://openrouter.ai) gives you one key for hundreds of models (OpenAI, Anthropic, Google, Meta, Mistral and more) through an **OpenAI-compatible API**, which is what Lode speaks. It's the easiest way to try different models.

## 1. Create an account and a key

1. Sign in at [openrouter.ai](https://openrouter.ai) (Google, GitHub or email).
2. Open **[Settings → Keys](https://openrouter.ai/settings/keys)** and choose **Create Key**.
3. Give it a name (for example `Lode`). You can optionally set a credit limit for this key, which is a good safety net.
4. Copy the key. It starts with `sk-or-v1-` and is shown only once.

## 2. Add credits (for paid models)

Paid models need credits: open **[Settings → Credits](https://openrouter.ai/settings/credits)** and add some. A few dollars lasts a long time for daily notes; Lode shows a token estimate before every run.

Models whose ID ends in **`:free`** cost nothing but are rate limited, and some don't support tool calling (needed for web search).

## 3. Pick a model

Browse **[openrouter.ai/models](https://openrouter.ai/models)**. For web search, the model must support **tool calling**: filter by *Supported parameters → tools*, or open [this filtered list](https://openrouter.ai/models?supported_parameters=tools).

Copy the model ID shown on its page, in `provider/model` form, for example `openai/gpt-5-mini` or `google/gemini-2.5-flash`.

## 4. Set it up in Lode

Open **Settings** in Lode:

| Field | Value |
|---|---|
| Base URL | `https://openrouter.ai/api/v1` |
| Model | the model ID, e.g. `openai/gpt-5-mini` |
| LLM API key | your `sk-or-v1-…` key |

Choose **Save provider**, paste the key and choose **Save**, then **Test connection**. You should see *Connection OK*.

For sourced additions, also add a [Tavily key](tavily.md).

## Troubleshooting

- **401 / authentication failed:** the key was mistyped, deleted, or hit its credit limit. Check [Settings → Keys](https://openrouter.ai/settings/keys).
- **402 / insufficient credits:** add credits, or switch to a `:free` model.
- **Model not found:** use the exact ID from the model's page, including the `provider/` part.
- **No sources in notes:** the model may not support tool calling. Pick one from the [tools filter](https://openrouter.ai/models?supported_parameters=tools).
