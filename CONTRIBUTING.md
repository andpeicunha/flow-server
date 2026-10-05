# Contributing

This repository is local-first and public. Do not add private flows, profiles,
credentials, sessions, customer information, personal paths, or real run
evidence.

Before opening a pull request, run:

```sh
npm test
npm run check:public
openspec validate local-flow-service-product --strict
```

The first public release also requires a selected license and the release gates
listed in the active OpenSpec change.
