> English translation of [README.md](README.md). The Chinese file is the normative source; keep both in sync.

# Built-in default configuration

`config/default.json` is the default configuration shipped with the clients and must be kept. Desktop reads it from the packaged file; Web imports it at build time. The built-in values are used when the remote request fails or lacks valid fields.

## Help configuration sources

The new community and feedback entry points request `GET /api/v1/client/configs` on the current endpoint and read `data.configs.feedbackUrl`:

- `community_urls["zh-CN" | "en-US"]`: falls back to the built-in entry for the current language only; never falls back across languages.
- `feedback_url`: a valid remote address wins; otherwise the built-in address is used.
- `feedback_use_external_form`: the remote boolean wins; `false` is also a valid override.

The request carries `app_version`; Desktop additionally sends `platform-arch`, while Web omits the platform parameter.
A successful response is cached in memory for 1 hour only; requests use `cache: no-store`; failures are not cached.

```text
current endpoint client/configs -> valid help fields -> platform entry
                  | missing / failed
                  v
          built-in default.json -> platform entry
```

`default.json` is the built-in default configuration distributed with the clients. Historically it was also distributed via CDN and is kept only for compatibility with older clients; the current version has no request or URL-construction path and relies solely on the built-in file in this directory. The other fields remain unchanged for existing consumers.

For the detailed rules see [community link configuration](../docs/ui/settings-community-link-config.md) (note: the `docs/` directory is not included in the open-source export).
