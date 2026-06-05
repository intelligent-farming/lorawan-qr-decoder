# @intelligent-farming/oui-registry

IEEE OUI (Organizationally Unique Identifier) registry for LoRaWAN device vendor identification. Bundles a snapshot of the MA-L, MA-M, and MA-S allocations (~52,000 entries) and resolves a DevEUI to its registered organization with longest-prefix matching — so MA-S sub-allocations correctly override the broader MA-L block they sit under.

Full API reference: [docs/api-doc.md](docs/api-doc.md). Regenerate with `npm run docs`.

## Install

```sh
npm install @intelligent-farming/oui-registry
```

## Usage

### Node

```ts
import { detectVendor, updateOuis, cachePath } from '@intelligent-farming/oui-registry';

detectVendor('A84041035660E3AA');
// → { oui: 'A84041', name: 'Dragino Technology Co., Limited' }

await updateOuis();   // refresh from IEEE into the cache
cachePath();          // wherever the cache lives
```

### Browser / edge runtime

Import the bundled JSON directly and use the pure `lookup()` function — no `fs` involved:

```ts
import ouis from '@intelligent-farming/oui-registry/data/ouis.json';
import { lookup } from '@intelligent-farming/oui-registry';

lookup(ouis, 'A84041035660E3AA');
// → { oui: 'A84041', name: 'Dragino Technology Co., Limited' }
```

Calling the Node convenience APIs in a browser bundle throws a clear error directing you to the pure-layer alternative.

## How the cache works

The bundled snapshot ships in the package itself. `updateOuis()` downloads the three IEEE CSVs (MA-L, MA-M, MA-S) and writes a merged JSON file to a cache path outside `node_modules`, so refreshes work inside long-running containers without write-permission issues. Reads prefer the cache when it exists, falling back to the bundled snapshot otherwise.

Cache path resolution (first set wins):

1. `OUI_REGISTRY_CACHE`
2. `$XDG_CACHE_HOME/intelligentfarming-oui-registry/ouis.json`
3. `~/.cache/intelligentfarming-oui-registry/ouis.json`

To bake a fresh snapshot into the package itself (maintainer task):

```sh
npm run build-ouis    # downloads from IEEE and writes data/ouis.json
```
