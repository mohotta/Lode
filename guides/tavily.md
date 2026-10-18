# Get a Tavily API key (web search)

Lode uses [Tavily](https://tavily.com) for web search. When it's on, the model can look things up while it writes your notes, and **every "also worth knowing" fact and every correction must cite a page that came back from that search**. Without a Tavily key, the model can't cite anything, so its extra facts are dropped (or kept but marked *unsourced*, depending on Settings).

## 1. Create an account and a key

1. Sign up or sign in at **[app.tavily.com](https://app.tavily.com)**.
2. Your API key is on the dashboard (you can create more there). It starts with `tvly-`.
3. Copy it.

The free plan includes **1,000 API credits a month**, no card needed. See [tavily.com/pricing](https://tavily.com/pricing) for current plans.

## 2. Set it up in Lode

1. Open **Settings**, paste the key into **Tavily search key** and choose **Save**.
2. Choose **Test connection** (this runs one search). You should see *Connection OK*.
3. Under **Generation**, make sure **Use web search** is ticked.

Your LLM model must support tool calling for search to work; see the [OpenRouter](openrouter.md) and [Groq](groq.md) guides.

## How Lode uses it

- Searches happen only during **Generate** and **Regenerate**, never while you capture or browse. Digests don't search.
- Each request to the model may run up to **Max searches per request** searches (Settings, default 4). A run with more points than **Points per request** is split into several requests.
- Each search is a basic search returning up to 5 results. Tavily receives only the search queries the model writes (they may mention topics from your points), never your notes or your LLM key.
- The Generate preview says whether search is on, and the run report shows how many searches were used.

To use fewer credits, lower **Max searches per request**, or untick **Use web search** for a run.

## Troubleshooting

- **"no Tavily key saved" in the Generate preview:** save the key in Settings first.
- **401 / authentication failed:** the key was mistyped or revoked; copy it again from [app.tavily.com](https://app.tavily.com).
- **432 / 433 or "usage limit":** the month's credits are used up. Wait for the reset, upgrade, or turn search off.
- **Notes have no sources even with a key:** the model may not support tool calling, or it chose not to search. Try a stronger model.
