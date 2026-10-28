# EasyView DSH adaptation

Upstream: https://github.com/tiantianmanmanzou/EasyView_Md
Pinned commit: 2400d66d2f8458822f895240b5389fee5bd8006d.

The DSH plugin is maintained in apps/dsh-plugin. The original desktop product remains in apps/desktop. Production bundles must include all workspace code and runtime assets and must not resolve source files from a development checkout.

Retain the upstream MIT license and third-party resource notices. Record format-engine and asset versions from the installed lockfile when packaging. Private modifications and their validation are tracked in apps/dsh-plugin/docs/agent-progress.md.
